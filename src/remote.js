const CFG_KEY = "stallSplit_supabase";
const SB_ESM = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export function getRemoteConfig() {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { url: "", anonKey: "" };
}

export function setRemoteConfig(url, anonKey) {
  const cfg = { url: (url || "").trim(), anonKey: (anonKey || "").trim() };
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  return cfg;
}

export function isConfigured(cfg = getRemoteConfig()) {
  return Boolean(cfg.url && cfg.anonKey);
}

let client = null;
let clientKey = "";

export async function getClient() {
  const cfg = getRemoteConfig();
  if (!isConfigured(cfg)) {
    client = null;
    clientKey = "";
    return null;
  }
  const key = cfg.url + "|" + cfg.anonKey;
  if (client && clientKey === key) return client;
  const { createClient } = await import(SB_ESM);
  client = createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  clientKey = key;
  return client;
}

export async function getSession() {
  const sb = await getClient();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session || null;
}

export async function signInWithEmail(email) {
  const sb = await getClient();
  if (!sb) throw new Error("Connect Supabase first.");
  const redirectTo = window.location.origin + window.location.pathname;
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
  if (error) throw error;
}

export async function signOut() {
  const sb = await getClient();
  if (sb) await sb.auth.signOut();
}

export async function fetchRemoteProjects() {
  const sb = await getClient();
  const session = await getSession();
  if (!sb || !session) return null;
  await sb.rpc("claim_project_invites").catch(() => {});
  const { data, error } = await sb
    .from("projects")
    .select("id, name, description, payload, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(row => ({
    id: row.id,
    name: row.name,
    desc: row.description || "",
    updatedAt: row.updated_at,
    ...(row.payload || { people: [], transactions: [], settlements: [] })
  }));
}

export async function upsertRemoteProject(project) {
  const sb = await getClient();
  const session = await getSession();
  if (!sb || !session) return { skipped: true };
  const row = {
    id: project.id,
    name: project.name,
    description: project.desc || "",
    payload: {
      people: project.people || [],
      transactions: project.transactions || [],
      settlements: project.settlements || [],
      sourceSnapshot: project.sourceSnapshot || null
    },
    updated_at: new Date().toISOString()
  };
  const { error } = await sb.from("projects").upsert(row);
  if (error) throw error;
  await sb.from("project_members").upsert({
    project_id: project.id,
    user_id: session.user.id,
    role: "owner"
  }).catch(() => {});
  return { skipped: false };
}

export async function deleteRemoteProject(id) {
  const sb = await getClient();
  if (!sb) return;
  const { error } = await sb.from("projects").delete().eq("id", id);
  if (error) throw error;
}

export async function inviteToProject(projectId, email) {
  const sb = await getClient();
  if (!sb) throw new Error("Connect Supabase first.");
  const { error } = await sb.from("project_invites").insert({
    project_id: projectId,
    email: email.trim().toLowerCase()
  });
  if (error) throw error;
}

export async function subscribeProjects(onChange) {
  const sb = await getClient();
  if (!sb) return () => {};
  const ch = sb.channel("projects-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, () => onChange())
    .subscribe();
  return () => { sb.removeChannel(ch); };
}
