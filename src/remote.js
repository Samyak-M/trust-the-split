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
let authUnsub = null;

export function cleanAuthUrl() {
  const url = new URL(window.location.href);
  const hash = url.hash.replace(/^#/, "");
  const params = new URLSearchParams(url.search);
  const hashParams = new URLSearchParams(hash);
  const hasAuth =
    hash.includes("access_token") || hash.includes("error") ||
    params.has("code") || params.has("error");
  if (!hasAuth) return;
  url.hash = "";
  ["code", "error", "error_description", "error_code"].forEach(k => params.delete(k));
  const qs = params.toString();
  window.history.replaceState({}, "", url.pathname + (qs ? `?${qs}` : ""));
  return hashParams.get("error_description") || hashParams.get("error") ||
    params.get("error_description") || params.get("error") || null;
}

/** Wait for magic-link / OAuth callback, then return session (keeps existing login on reused links). */
export async function resolveSession() {
  const sb = await getClient();
  if (!sb) return { session: null, authError: null };

  const { data: { session: existing } } = await sb.auth.getSession();
  let authError = null;
  const url = new URL(window.location.href);
  const hash = url.hash.replace(/^#/, "");

  const code = url.searchParams.get("code");
  if (code) {
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (error) authError = error.message;
    cleanAuthUrl();
  } else if (hash) {
    const hp = new URLSearchParams(hash);
    if (hp.get("error") || hp.get("error_code")) {
      authError = hp.get("error_description") || hp.get("error") || "Sign-in link invalid or already used.";
      cleanAuthUrl();
      if (existing) return { session: existing, authError };
    } else if (hp.get("access_token") && hp.get("refresh_token")) {
      const { error } = await sb.auth.setSession({
        access_token: hp.get("access_token"),
        refresh_token: hp.get("refresh_token")
      });
      if (error) {
        authError = error.message;
        if (existing) return { session: existing, authError };
      }
      cleanAuthUrl();
    }
  }

  const { data: { session } } = await sb.auth.getSession();
  return { session: session || existing, authError };
}

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
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: window.localStorage
    }
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

export function subscribeAuth(onChange) {
  if (authUnsub) authUnsub();
  authUnsub = null;
  return getClient().then(sb => {
    if (!sb) return () => {};
    const { data: { subscription } } = sb.auth.onAuthStateChange((_event, sess) => {
      onChange(sess);
    });
    authUnsub = () => subscription.unsubscribe();
    return authUnsub;
  });
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
