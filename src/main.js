import {
  uid, moneyFmt, nameById, shareLabel, payerMap, holderMap,
  totals, enrichedParticipantRows, simplify,
  validateTransaction, validateSettlement, personUsage, nearEq, round2,
  alloc, sumMap
} from "./core.js";
import { loadLocalDB, saveLocalDB } from "./store.js";
import {
  getRemoteConfig, setRemoteConfig, isConfigured, resolveSession, signInWithEmail,
  signOut, fetchRemoteProjects, upsertRemoteProject, deleteRemoteProject,
  inviteToProject, subscribeProjects, subscribeAuth
} from "./remote.js";
import { SUPABASE } from "./config.js";
import { exportProjectReport } from "./export.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const CATEGORIES = ["groceries", "food", "misc", "transport", "supplies", "other"];

let db = loadLocalDB();
let session = null;
let modal = { type: null, idx: null };
let unsub = () => {};
let unsubAuth = () => {};
let persistTimer = 0;

const $ = id => document.getElementById(id);
const project = () => db.projects.find(p => p.id === db.current) || db.projects[0];

function applyBuiltinConfig() {
  if (SUPABASE.url && SUPABASE.anonKey && !getRemoteConfig().url) {
    setRemoteConfig(SUPABASE.url, SUPABASE.anonKey);
  }
}

function persist(opts = {}) {
  saveLocalDB(db);
  if (opts.remote === false) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    const p = project();
    if (!p || !session) return;
    try {
      await upsertRemoteProject(p);
    } catch (e) {
      showBanner(e.message || "Could not save to cloud", true);
    }
  }, 400);
}

async function loadFromRemote() {
  if (!session) return;
  try {
    const remote = await fetchRemoteProjects();
    if (!remote) return;
    if (remote.length) {
      const keep = db.current;
      db.projects = remote;
      db.current = remote.some(p => p.id === keep) ? keep : remote[0].id;
      saveLocalDB(db);
      showBanner(`Synced ${remote.length} project(s) from cloud.`);
    } else if (db.projects.length) {
      for (const p of db.projects) await upsertRemoteProject(p);
      showBanner("Your local projects were uploaded to the cloud.");
    }
    renderAll();
  } catch (e) {
    showBanner(e.message || "Could not load from cloud", true);
  }
}

function showBanner(text, bad = false) {
  const el = $("banner");
  if (!text) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = text;
  el.className = "banner" + (bad ? " bad-banner" : "");
}

function setView(name) {
  document.querySelectorAll(".nav").forEach(b => b.classList.toggle("active", b.dataset.view === name));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === name));
  window.scrollTo(0, 0);
}

function attach() {
  document.querySelectorAll(".nav").forEach(btn => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });
  $("projectSelect").addEventListener("change", e => onProjectChange(e.target.value));
  $("projectSelectMobile")?.addEventListener("change", e => onProjectChange(e.target.value));
  $("addTx").addEventListener("click", () => openModal("transaction", null));
  $("addTxEmpty")?.addEventListener("click", () => openModal("transaction", null));
  $("addSettlement").addEventListener("click", () => openModal("settlement", null));
  $("addPerson").addEventListener("click", () => openModal("person", null));
  $("addProject").addEventListener("click", () => openModal("project", null));
  $("exportReport")?.addEventListener("click", handleExport);
  $("exportTx")?.addEventListener("click", handleExport);
  $("txFilterPerson")?.addEventListener("change", () => renderTransactions(project()));
  $("txFilterCategory")?.addEventListener("change", () => renderTransactions(project()));
  $("modalCancel").addEventListener("click", closeModal);
  $("modalSave").addEventListener("click", saveModal);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

  $("saveRemote").addEventListener("click", async () => {
    setRemoteConfig($("sbUrl").value, $("sbKey").value);
    showBanner("Connection saved. Send a sign-in link to sync.");
    await refreshAuth();
    renderSettings();
  });
  $("clearRemote").addEventListener("click", async () => {
    setRemoteConfig("", "");
    session = null;
    showBanner("This browser only. Other devices will not see changes.");
    renderSettings();
    renderAuthArea();
  });
  $("sendMagic").addEventListener("click", sendMagicLink);
  $("inviteBtn").addEventListener("click", async () => {
    try {
      await inviteToProject(project().id, $("inviteEmail").value);
      $("authStatus").textContent = "Invite sent! They should sign in with that email.";
      $("inviteEmail").value = "";
    } catch (e) {
      $("authStatus").textContent = e.message;
    }
  });

  $("dashTabs")?.addEventListener("click", e => {
    const tab = e.target.closest("[data-dash]");
    if (!tab) return;
    document.querySelectorAll(".dash-tabs .tab").forEach(t => t.classList.toggle("active", t === tab));
    $("dashOverview").hidden = tab.dataset.dash !== "overview";
    $("dashPeople").hidden = tab.dataset.dash !== "people";
  });
}

async function sendMagicLink() {
  try {
    if (!isConfigured()) {
      $("authStatus").textContent = "Set up cloud sync first (see Advanced below), or add credentials to src/config.js.";
      $("advancedSettings").open = true;
      return;
    }
    await signInWithEmail($("authEmail").value);
    $("authStatus").textContent = "Check your email for the sign-in link.";
  } catch (e) {
    $("authStatus").textContent = e.message;
  }
}

function renderAuthArea() {
  const el = $("authArea");
  if (session?.user?.email) {
    el.innerHTML = `
      <div class="auth-chip signed-in">
        <span class="dot online"></span>
        <span>${esc(session.user.email)}</span>
        <button type="button" class="secondary small-btn" id="topSignOut">Sign out</button>
      </div>`;
    $("topSignOut").addEventListener("click", async () => {
      await signOut();
      session = null;
      renderAuthArea();
      renderSettings();
    });
  } else if (isConfigured()) {
    el.innerHTML = `
      <div class="auth-chip">
        <span class="dot"></span>
        <span>Not signed in</span>
        <button type="button" class="small-btn" id="topSignIn">Sign in</button>
      </div>`;
    $("topSignIn").addEventListener("click", () => {
      setView("settings");
      $("authEmail").focus();
    });
  } else {
    el.innerHTML = `<div class="auth-chip local"><span class="dot offline"></span><span>Local only</span></div>`;
  }
}

function renderProjectSelect() {
  const html = db.projects.map(p =>
    `<option value="${esc(p.id)}" ${p.id === db.current ? "selected" : ""}>${esc(p.name)}</option>`
  ).join("");
  const sel = $("projectSelect");
  const mobile = $("projectSelectMobile");
  if (sel) sel.innerHTML = html;
  if (mobile) mobile.innerHTML = html;
}

function onProjectChange(id) {
  db.current = id;
  if ($("projectSelect")) $("projectSelect").value = id;
  if ($("projectSelectMobile")) $("projectSelectMobile").value = id;
  persist();
  renderAll();
}

function renderAll() {
  const p = project();
  if (!p) return;
  renderProjectSelect();
  $("title").textContent = p.name;
  $("subtitle").textContent = p.desc || "";
  renderDashboard(p);
  renderTransactions(p);
  renderBalances(p);
  renderSettlements(p);
  renderPeople(p);
  renderProjects();
  renderSettings();
  renderAuthArea();
}

function netClass(n) {
  if (n > 0.005) return "pos";
  if (n < -0.005) return "neg";
  return "";
}

function balanceLabel(net) {
  if (net > 0.005) return { text: "gets back", cls: "pos" };
  if (net < -0.005) return { text: "owes", cls: "neg" };
  return { text: "settled", cls: "settled" };
}

function commonFundPaid(r) {
  return round2(Math.max(0, r.expensePaid - (r.pocketPaid || 0)));
}

function paidVsShareLabel(r) {
  const diff = round2(r.expensePaid - r.share);
  if (nearEq(diff, 0)) return { text: "Even", cls: "settled", diff: 0 };
  if (diff > 0) return { text: `Paid ${moneyFmt(diff)} extra`, cls: "pos", diff };
  return { text: `${moneyFmt(Math.abs(diff))} less`, cls: "neg", diff };
}

function txInvolvesPerson(p, tx, personId) {
  if (!personId) return true;
  if (tx.type === "transfer") return tx.from === personId || tx.to === personId;
  if (tx.type === "deposit") {
    return personId in payerMap(tx) || personId in holderMap(tx);
  }
  if (tx.type === "expense") return personId in payerMap(tx);
  return false;
}

function collectCategories(p) {
  const cats = new Set();
  (p.transactions || []).forEach(tx => {
    const c = (tx.category || "").trim();
    if (c) cats.add(c);
  });
  return [...cats].sort((a, b) => a.localeCompare(b));
}

function renderTxFilters(p) {
  const personSel = $("txFilterPerson");
  const catSel = $("txFilterCategory");
  if (!personSel || !catSel) return;

  const personVal = personSel.value;
  const catVal = catSel.value;

  personSel.innerHTML = `<option value="">All people</option>` +
    (p.people || []).map(pe => `<option value="${esc(pe.id)}">${esc(pe.name)}</option>`).join("");
  catSel.innerHTML = `<option value="">All categories</option>` +
    collectCategories(p).map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");

  personSel.value = personVal;
  if (!personSel.value && personVal) personSel.value = "";
  catSel.value = catVal;
  if (!catSel.value && catVal) catSel.value = "";
}

function renderDebtList(p, debts, elId) {
  const el = $(elId);
  if (!debts.length) {
    el.innerHTML = '<p class="good-msg">🎉 Everyone is settled up!</p>';
    return;
  }
  el.innerHTML = debts.map(d => `
    <div class="debt-card">
      <div class="debt-person">${esc(nameById(p, d.from))}</div>
      <div class="debt-arrow">pays</div>
      <div class="debt-person">${esc(nameById(p, d.to))}</div>
      <div class="debt-amt neg">${moneyFmt(d.amount)}</div>
    </div>`).join("");
}

function renderDashboard(p) {
  const t = totals(p);
  const rows = enrichedParticipantRows(p);
  const debts = simplify(p);
  const totalSettled = round2((p.settlements || []).reduce((s, x) => s + Number(x.amount || 0), 0));

  $("kpis").innerHTML = `
    <div class="kpi kpi-spend"><div class="muted">Total group spending</div><div class="v neg">${moneyFmt(t.expenses)}</div></div>
    <div class="kpi kpi-credit"><div class="muted">Total deposited</div><div class="v pos">${moneyFmt(t.deposits)}</div></div>
    <div class="kpi"><div class="muted">Common cash on hand</div><div class="v pos">${moneyFmt(t.commonCash)}</div></div>
    <div class="kpi"><div class="muted">Repayments recorded</div><div class="v">${moneyFmt(totalSettled)}</div></div>`;

  renderDebtList(p, debts, "debtList");

  const holders = (p.people || []).map(person => ({
    name: person.name,
    amt: t.holdings[person.id] || 0
  }));
  $("cashHolders").innerHTML = holders.map(h =>
    `<div class="flex rowline"><span>${esc(h.name)}</span><span class="pos">${moneyFmt(h.amt)}</span></div>`
  ).join("") + `<div class="flex rowline total"><span>Total</span><span class="pos">${moneyFmt(t.commonCash)}</span></div>`;

  const recentSettle = (p.settlements || []).slice(-5).reverse();
  $("dashSettlements").innerHTML = recentSettle.length
    ? recentSettle.map(s => `
      <div class="flex rowline">
        <span>${esc(nameById(p, s.from))} → ${esc(nameById(p, s.to))}</span>
        <span class="neg">${moneyFmt(s.amount)}</span>
      </div>`).join("")
    : '<p class="muted">No repayments recorded yet.</p>';

  $("personCards").innerHTML = rows.map(r => {
    const bal = balanceLabel(r.net);
    const vs = paidVsShareLabel(r);
    const commonPaid = commonFundPaid(r);
    return `
      <div class="person-card">
        <div class="person-card-name">${esc(r.name)}</div>
        <div class="person-card-balance ${bal.cls}">
          ${r.status === "settled" ? "Settled up" : `${moneyFmt(Math.abs(r.net))} ${bal.text}`}
        </div>
        <div class="person-card-stats">
          <div class="stat-block">
            <span class="stat-label">Advance deposited</span>
            <span class="stat-hint">Put into common pot</span>
            <strong class="pos">${moneyFmt(r.deposited)}</strong>
          </div>
          <div class="stat-block">
            <span class="stat-label">Paid from pocket</span>
            <span class="stat-hint">Own money for bills</span>
            <strong class="neg">${moneyFmt(r.pocketPaid || 0)}</strong>
          </div>
          <div class="stat-block">
            <span class="stat-label">Paid via common fund</span>
            <span class="stat-hint">Bills from shared cash</span>
            <strong class="neg">${moneyFmt(commonPaid)}</strong>
          </div>
          <div class="stat-block">
            <span class="stat-label">Fair share of spending</span>
            <span class="stat-hint">Their portion of all expenses</span>
            <strong class="neg">${moneyFmt(r.share)}</strong>
          </div>
          <div class="stat-block">
            <span class="stat-label">Extra / less on bills</span>
            <span class="stat-hint">Paid vs fair share</span>
            <strong class="${vs.cls}">${vs.text}</strong>
          </div>
          <div class="stat-block">
            <span class="stat-label">Holding cash</span>
            <span class="stat-hint">Common cash in hand</span>
            <strong class="pos">${moneyFmt(r.holding)}</strong>
          </div>
        </div>
      </div>`;
  }).join("") || '<p class="muted">Add people to see individual spending.</p>';

  $("personSummary").innerHTML = rows.map(r => {
    const bal = balanceLabel(r.net);
    const vs = paidVsShareLabel(r);
    const commonPaid = commonFundPaid(r);
    return `
    <tr>
      <td><strong>${esc(r.name)}</strong></td>
      <td class="pos">${moneyFmt(r.deposited)}</td>
      <td class="neg">${moneyFmt(r.pocketPaid || 0)}</td>
      <td class="neg">${moneyFmt(commonPaid)}</td>
      <td class="neg">${moneyFmt(r.share)}</td>
      <td class="${vs.cls}">${vs.text}</td>
      <td class="neg">${moneyFmt(r.settledOut)}</td>
      <td class="pos">${moneyFmt(r.settledIn)}</td>
      <td class="${bal.cls}">${r.status === "settled" ? "—" : `${moneyFmt(Math.abs(r.net))} ${bal.text}`}</td>
      <td class="pos">${moneyFmt(r.holding)}</td>
    </tr>`;
  }).join("");
}

function paidByLabel(p, tx) {
  return Object.entries(payerMap(tx)).map(([id, amt]) => `${nameById(p, id)} ${moneyFmt(amt)}`).join(", ") || "—";
}

function heldLabel(p, tx) {
  if (tx.type === "deposit") {
    return Object.entries(holderMap(tx)).map(([id, amt]) => `${nameById(p, id)} ${moneyFmt(amt)}`).join(", ") || "—";
  }
  if (tx.type === "transfer") return `${nameById(p, tx.from)} → ${nameById(p, tx.to)}`;
  return tx.source === "common" ? "Common fund" : "Pocket";
}

function typeLabel(tx) {
  if (tx.type === "deposit") return "Deposit";
  if (tx.type === "transfer") return "Cash move";
  return "Expense";
}

function amountClass(tx) {
  if (tx.type === "deposit") return "pos";
  if (tx.type === "expense") return "neg";
  return "";
}

function renderTransactions(p) {
  renderTxFilters(p);
  const txs = p.transactions || [];
  const personId = $("txFilterPerson")?.value || "";
  const category = $("txFilterCategory")?.value || "";
  const filtered = txs
    .map((tx, idx) => ({ tx, idx }))
    .filter(({ tx }) => txInvolvesPerson(p, tx, personId))
    .filter(({ tx }) => !category || (tx.category || "").trim() === category);

  const empty = !txs.length;
  const noMatches = txs.length > 0 && !filtered.length;
  $("txTable").closest(".table").hidden = empty || noMatches;
  $("txEmpty").hidden = !empty;
  const status = $("txFilterStatus");
  if (status) {
    if (noMatches) {
      status.hidden = false;
      status.textContent = "No transactions match these filters.";
    } else if (personId || category) {
      status.hidden = false;
      status.textContent = `Showing ${filtered.length} of ${txs.length} transaction(s).`;
    } else {
      status.hidden = true;
      status.textContent = "";
    }
  }

  $("txTable").innerHTML = filtered.map(({ tx, idx }) => `
    <tr>
      <td>${esc(tx.date)}</td>
      <td><span class="pill type-${tx.type}">${typeLabel(tx)}</span></td>
      <td>${esc(tx.desc)}</td>
      <td>${esc(tx.category || "—")}</td>
      <td class="${amountClass(tx)}">${moneyFmt(tx.amount, tx.currency)}</td>
      <td>${esc(paidByLabel(p, tx))}</td>
      <td>${esc(heldLabel(p, tx))}</td>
      <td>${esc(shareLabel(tx))}</td>
      <td class="actions">
        <button type="button" class="secondary small-btn" data-edit-tx="${idx}">Edit</button>
        <button type="button" class="danger small-btn" data-del-tx="${idx}">Delete</button>
      </td>
    </tr>`).join("");
  $("txTable").onclick = e => {
    const edit = e.target.closest("[data-edit-tx]");
    const del = e.target.closest("[data-del-tx]");
    if (edit) openModal("transaction", Number(edit.dataset.editTx));
    if (del && confirm("Delete this transaction? Totals will recalculate.")) {
      p.transactions.splice(Number(del.dataset.delTx), 1);
      persist();
      renderAll();
    }
  };
}

function renderBalances(p) {
  renderDebtList(p, simplify(p), "balancesView");
}

function renderSettlements(p) {
  $("settleTable").innerHTML = (p.settlements || []).map((s, idx) => `
    <tr>
      <td>${esc(s.date)}</td>
      <td>${esc(nameById(p, s.from))}</td>
      <td>${esc(nameById(p, s.to))}</td>
      <td class="neg">${moneyFmt(s.amount)}</td>
      <td>${esc(s.note || "")}</td>
      <td class="actions">
        <button type="button" class="secondary small-btn" data-edit-s="${idx}">Edit</button>
        <button type="button" class="danger small-btn" data-del-s="${idx}">Delete</button>
      </td>
    </tr>`).join("");
  $("settleTable").onclick = e => {
    const edit = e.target.closest("[data-edit-s]");
    const del = e.target.closest("[data-del-s]");
    if (edit) openModal("settlement", Number(edit.dataset.editS));
    if (del && confirm("Delete this settlement?")) {
      p.settlements.splice(Number(del.dataset.delS), 1);
      persist();
      renderAll();
    }
  };
}

function renderPeople(p) {
  $("peopleTable").innerHTML = (p.people || []).map((person, idx) => `
    <tr>
      <td>${esc(person.name)}</td>
      <td class="actions">
        <button type="button" class="secondary small-btn" data-edit-pe="${idx}">Edit</button>
        <button type="button" class="danger small-btn" data-del-pe="${idx}">Delete</button>
      </td>
    </tr>`).join("");
  $("peopleTable").onclick = e => {
    const edit = e.target.closest("[data-edit-pe]");
    const del = e.target.closest("[data-del-pe]");
    if (edit) openModal("person", Number(edit.dataset.editPe));
    if (del) {
      const idx = Number(del.dataset.delPe);
      const used = personUsage(p, p.people[idx].id);
      if (used.length) {
        alert(`${p.people[idx].name} is on ${used.length} record(s). Reassign or delete those transactions/settlements first.`);
        return;
      }
      if (confirm("Remove this person?")) {
        p.people.splice(idx, 1);
        persist();
        renderAll();
      }
    }
  };
}

function renderProjects() {
  $("projectTable").innerHTML = db.projects.map((pr, idx) => `
    <tr>
      <td>${esc(pr.name)}</td>
      <td>${esc(pr.desc || "")}</td>
      <td>${(pr.people || []).length}</td>
      <td>${(pr.transactions || []).length}</td>
      <td class="actions">
        <button type="button" class="secondary small-btn" data-open-pr="${idx}">Open</button>
        <button type="button" class="secondary small-btn" data-edit-pr="${idx}">Edit</button>
        <button type="button" class="danger small-btn" data-del-pr="${idx}">Delete</button>
      </td>
    </tr>`).join("");
  $("projectTable").onclick = async e => {
    const open = e.target.closest("[data-open-pr]");
    const edit = e.target.closest("[data-edit-pr]");
    const del = e.target.closest("[data-del-pr]");
    if (open) {
      db.current = db.projects[Number(open.dataset.openPr)].id;
      persist();
      renderAll();
      setView("dashboard");
    }
    if (edit) openModal("project", Number(edit.dataset.editPr));
    if (del) {
      if (db.projects.length < 2) { alert("Keep at least one project."); return; }
      const idx = Number(del.dataset.delPr);
      if (!confirm(`Delete "${db.projects[idx].name}" and all of its books?`)) return;
      const id = db.projects[idx].id;
      db.projects.splice(idx, 1);
      if (db.current === id) db.current = db.projects[0].id;
      persist({ remote: false });
      try { await deleteRemoteProject(id); } catch { /* local still updated */ }
      persist();
      renderAll();
    }
  };
}

function renderSettings() {
  const cfg = getRemoteConfig();
  $("sbUrl").value = cfg.url || "";
  $("sbKey").value = cfg.anonKey || "";

  const configured = isConfigured();
  const signedIn = Boolean(session?.user?.email);

  if (configured) {
    $("syncStatus").innerHTML = `
      <div class="sync-banner good">
        <span class="sync-icon">☁️</span>
        <div>
          <strong>Cloud sync enabled</strong>
          <p class="muted">${signedIn ? "Your changes sync automatically with your group." : "Sign in below to start syncing."}</p>
        </div>
      </div>`;
    $("advancedSettings").hidden = Boolean(SUPABASE.url && SUPABASE.anonKey);
  } else {
    $("syncStatus").innerHTML = `
      <div class="sync-banner warn">
        <span class="sync-icon">💾</span>
        <div>
          <strong>Local only</strong>
          <p class="muted">Data stays in this browser. Set up cloud sync below to share with others.</p>
        </div>
      </div>`;
    $("advancedSettings").hidden = false;
  }

  $("signInCard").hidden = signedIn;
  $("inviteCard").hidden = !signedIn;
  if (signedIn) $("inviteProjectName").textContent = project()?.name || "this project";
}

function amountFields(people, map, prefix) {
  return people.map(p => `
    <div class="amtrow">
      <label for="${prefix}${p.id}">${esc(p.name)}<span class="amt-calc muted" id="${prefix}calc_${p.id}"></span></label>
      <input type="number" min="0" step="0.01" id="${prefix}${p.id}" value="${map[p.id] ?? ""}" placeholder="0" class="amt-input" data-prefix="${prefix}">
    </div>`).join("");
}

function collectMap(people, prefix) {
  const m = {};
  people.forEach(p => {
    const n = Number(document.getElementById(prefix + p.id)?.value || 0);
    if (n > 0) m[p.id] = round2(n);
  });
  return m;
}

function txModalAmount() {
  return Number($("txAmount")?.value || 0);
}

function amountHintHtml(sum, total, unit = "₹") {
  const rem = round2(total - sum);
  const balanced = nearEq(rem, 0);
  const remCls = balanced ? "pos" : rem < 0 ? "neg" : "pending";
  const remLabel = balanced
    ? "Balanced ✓"
    : rem > 0
      ? `Remaining: ${unit === "%" ? rem + "%" : moneyFmt(rem)}`
      : `Over by: ${unit === "%" ? Math.abs(rem) + "%" : moneyFmt(Math.abs(rem))}`;
  const sumCls = sum > total && total > 0 ? "neg" : "";
  const sumLabel = unit === "%" ? `${round2(sum)}%` : moneyFmt(sum);
  const totalLabel = unit === "%" ? "100%" : moneyFmt(total);
  return `<div class="amount-hint">Assigned <span class="${sumCls}">${sumLabel}</span> / ${totalLabel} · <span class="${remCls}">${remLabel}</span></div>`;
}

function readShareInputs(people) {
  const m = {};
  people.forEach(p => {
    const n = Number(document.getElementById("share_" + p.id)?.value || 0);
    if (n > 0) m[p.id] = round2(n);
  });
  return m;
}

function autoFillShareFields(people, mode, force = false) {
  if (!people.length || mode === "equal" || mode === "amount") return;
  if (mode === "percent" && force) {
    const each = round2(100 / people.length);
    people.forEach((p, i) => {
      const el = document.getElementById("share_" + p.id);
      if (!el) return;
      const pct = i === people.length - 1 ? round2(100 - each * (people.length - 1)) : each;
      el.value = pct > 0 ? pct : "";
    });
    return;
  }
  if (mode === "share" && force) {
    people.forEach(p => {
      const el = document.getElementById("share_" + p.id);
      if (el && !el.value) el.value = 1;
    });
  }
}

function renderEqualSharePreview(people, total) {
  const el = $("shareEqualPreview");
  if (!el) return;
  if (!total || !people.length) {
    el.innerHTML = '<p class="muted">Enter an amount to see the split.</p>';
    return;
  }
  const each = round2(total / people.length);
  el.innerHTML = people.map((p, i) => {
    const amt = i === people.length - 1 ? round2(total - each * (people.length - 1)) : each;
    return `<div class="flex rowline"><span>${esc(p.name)}</span><span class="neg">${moneyFmt(amt)}</span></div>`;
  }).join("");
}

function updateShareCalcLabels(people, mode, total) {
  const shares = readShareInputs(people);
  if (!total || mode === "amount" || mode === "equal") {
    people.forEach(p => {
      const calc = document.getElementById("share_calc_" + p.id);
      if (calc) { calc.textContent = ""; calc.className = "amt-calc muted"; }
    });
    return;
  }
  const fractions = alloc(people, { shareMode: mode, shares });
  people.forEach(p => {
    const calc = document.getElementById("share_calc_" + p.id);
    if (!calc) return;
    const rupees = round2(total * (fractions[p.id] || 0));
    const hasInput = (shares[p.id] || 0) > 0;
    calc.textContent = hasInput ? `= ${moneyFmt(rupees)}` : "";
    calc.className = "amt-calc neg";
  });
}

function updateTxModalHints(people) {
  const total = txModalAmount();
  const kind = $("txType")?.value;

  if (kind === "deposit") {
    const paySum = sumMap(collectMap(people, "pay_"));
    const holdSum = sumMap(collectMap(people, "hold_"));
    const payHint = $("payHint");
    const holdHint = $("holdHint");
    if (payHint) payHint.innerHTML = total > 0 ? amountHintHtml(paySum, total) : "";
    if (holdHint) holdHint.innerHTML = total > 0 ? amountHintHtml(holdSum, total) : "";
  }

  if (kind === "expense") {
    const paySum = sumMap(collectMap(people, "expay_"));
    const payHint = $("expayHint");
    if (payHint) payHint.innerHTML = total > 0 ? amountHintHtml(paySum, total) : "";

    const mode = $("txShareMode")?.value || "equal";
    if (mode === "equal") {
      renderEqualSharePreview(people, total);
    } else {
      const shares = readShareInputs(people);
      let assigned = 0;
      let unit = "₹";
      if (mode === "amount") assigned = sumMap(shares);
      else if (mode === "percent") { assigned = sumMap(shares); unit = "%"; }
      else if (mode === "share" && sumMap(shares) > 0) assigned = total;
      const shareHint = $("shareHint");
      if (shareHint) {
        if (mode === "share") {
          shareHint.innerHTML = total > 0
            ? `<div class="amount-hint">Weights total <strong>${round2(sumMap(shares))}</strong> · Amounts below update from shares</div>`
            : "";
        } else {
          shareHint.innerHTML = total > 0 ? amountHintHtml(assigned, mode === "percent" ? 100 : total, unit) : "";
        }
      }
      updateShareCalcLabels(people, mode, total);
    }
  }
}

function syncTxModalVisibility() {
  const kind = $("txType")?.value;
  $("boxDeposit").style.display = kind === "deposit" ? "block" : "none";
  $("boxExpense").style.display = kind === "expense" ? "block" : "none";
  $("boxTransfer").style.display = kind === "transfer" ? "block" : "none";
  const mode = $("txShareMode")?.value || "equal";
  const isEqual = mode === "equal";
  if ($("shareEqualWrap")) $("shareEqualWrap").style.display = isEqual ? "block" : "none";
  if ($("shareFields")) $("shareFields").style.display = isEqual ? "none" : "block";
  if ($("shareHint")) $("shareHint").style.display = isEqual ? "none" : "block";
}

function autoFillSinglePayer(people, prefix, total) {
  if (people.length !== 1 || !total) return;
  const el = document.getElementById(prefix + people[0].id);
  if (el && !Number(el.value)) el.value = total;
}

function clearShareFields(people) {
  people.forEach(p => {
    const el = document.getElementById("share_" + p.id);
    if (el) el.value = "";
  });
}

function wireTxModal(people) {
  const onAmountChange = () => {
    const total = txModalAmount();
    const kind = $("txType")?.value;
    if (kind === "deposit") {
      autoFillSinglePayer(people, "pay_", total);
      autoFillSinglePayer(people, "hold_", total);
    }
    if (kind === "expense") {
      autoFillSinglePayer(people, "expay_", total);
    }
    updateTxModalHints(people);
  };

  $("txAmount")?.addEventListener("input", onAmountChange);

  $("txType")?.addEventListener("change", () => {
    syncTxModalVisibility();
    updateTxModalHints(people);
  });

  $("txShareMode")?.addEventListener("change", () => {
    const mode = $("txShareMode").value;
    if (mode === "amount") clearShareFields(people);
    else autoFillShareFields(people, mode, true);
    syncTxModalVisibility();
    updateTxModalHints(people);
  });

  $("modalBody")?.addEventListener("input", e => {
    if (e.target.matches(".amt-input")) updateTxModalHints(people);
  });

  autoFillShareFields(people, $("txShareMode")?.value || "equal", false);
  syncTxModalVisibility();
  updateTxModalHints(people);
}

async function handleExport() {
  const p = project();
  if (!p) return;
  showBanner("Preparing Excel report…");
  try {
    await exportProjectReport(p);
    showBanner(`Report downloaded for ${p.name}.`);
  } catch (e) {
    showBanner(e.message || "Could not export report", true);
  }
}

/* ── Modals ── */

function openModal(type, idx) {
  const p = project();
  const people = p.people || [];
  modal = { type, idx };
  const titles = {
    transaction: idx == null ? "Add transaction" : "Edit transaction",
    settlement: idx == null ? "Record settlement" : "Edit settlement",
    person: idx == null ? "Add person" : "Edit name",
    project: idx == null ? "New project" : "Edit project"
  };
  $("modalTitle").textContent = titles[type];
  $("modalError").hidden = true;
  const body = $("modalBody");

  if (type === "transaction") {
    if (!people.length) {
      alert("Add at least one person before recording a transaction.");
      return;
    }
    const tx = idx != null ? p.transactions[idx] : {
      date: today(), type: "expense", desc: "", category: "groceries", currency: "INR",
      amount: "", payers: {}, holders: {}, source: "pocket", shareMode: "equal", shares: {}
    };
    const payers = payerMap(tx);
    const holders = holderMap(tx);
    body.innerHTML = `
      <div class="stack">
        <div class="formgrid">
          <label>Date<input type="date" id="txDate" value="${esc(tx.date)}"></label>
          <label>Type
            <select id="txType">
              <option value="deposit" ${tx.type === "deposit" ? "selected" : ""}>Deposit (advance)</option>
              <option value="expense" ${tx.type === "expense" ? "selected" : ""}>Expense</option>
              <option value="transfer" ${tx.type === "transfer" ? "selected" : ""}>Move common cash</option>
            </select>
          </label>
          <label>Description<input id="txDesc" value="${esc(tx.desc || "")}"></label>
          <label>Category
            <input id="txCat" list="catlist" value="${esc(tx.category || "")}">
            <datalist id="catlist">${CATEGORIES.map(c => `<option value="${c}">`).join("")}</datalist>
          </label>
          <label>Amount<input type="number" min="0" step="0.01" id="txAmount" value="${tx.amount || ""}"></label>
          <label>Currency<input id="txCur" value="${esc(tx.currency || "INR")}"></label>
        </div>

        <div id="boxDeposit" class="box">
          <div class="box-title">Who paid? (can be more than one)</div>
          ${amountFields(people, payers, "pay_")}
          <div id="payHint"></div>
          <div class="box-title">Who received / holds it?</div>
          ${amountFields(people, holders, "hold_")}
          <div id="holdHint"></div>
        </div>

        <div id="boxExpense" class="box">
          <div class="box-title">Who paid? Sum must equal the amount.</div>
          ${amountFields(people, payers, "expay_")}
          <div id="expayHint"></div>
          <label>Funding source
            <select id="txSource">
              <option value="common" ${tx.source === "common" ? "selected" : ""}>Common fund</option>
              <option value="pocket" ${tx.source !== "common" ? "selected" : ""}>Pocket (on top of deposits)</option>
            </select>
          </label>
          <label>Sharing for this expense
            <select id="txShareMode">
              <option value="equal" ${tx.shareMode === "equal" ? "selected" : ""}>Equal</option>
              <option value="amount" ${tx.shareMode === "amount" ? "selected" : ""}>Unequal ₹ (enter each person's share)</option>
              <option value="percent" ${tx.shareMode === "percent" ? "selected" : ""}>Percentages (normalized)</option>
              <option value="share" ${tx.shareMode === "share" ? "selected" : ""}>Shares / head-count (e.g. 2 : 3 : 1)</option>
            </select>
          </label>
          <div id="shareBox">
            <div id="shareEqualWrap">
              <div class="box-title">Equal split preview</div>
              <div id="shareEqualPreview" class="share-preview"></div>
            </div>
            <div id="shareFields">${amountFields(people, tx.shares || {}, "share_")}</div>
            <div id="shareHint"></div>
          </div>
        </div>

        <div id="boxTransfer" class="box">
          <div class="formgrid">
            <label>From (currently holding)
              <select id="trFrom">${people.map(x => `<option value="${x.id}" ${tx.from === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
            </label>
            <label>To
              <select id="trTo">${people.map(x => `<option value="${x.id}" ${tx.to === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
            </label>
          </div>
        </div>
      </div>`;
    wireTxModal(people);
  } else if (type === "settlement") {
    if (!people.length) {
      alert("Add people before recording a settlement.");
      return;
    }
    const s = idx != null ? p.settlements[idx] : { date: today(), from: people[0]?.id, to: people[1]?.id || people[0]?.id, amount: "", note: "", allowOverpay: false };
    const opts = people.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join("");
    body.innerHTML = `
      <div class="stack">
        <div class="formgrid">
          <label>Date<input type="date" id="sDate" value="${esc(s.date)}"></label>
          <label>Amount<input type="number" min="0" step="0.01" id="sAmount" value="${s.amount || ""}"></label>
          <label>From<select id="sFrom">${opts}</select></label>
          <label>To<select id="sTo">${opts}</select></label>
        </div>
        <label>Note<input id="sNote" value="${esc(s.note || "")}" placeholder="Paid back cash"></label>
        <label class="check"><input type="checkbox" id="sOver" ${s.allowOverpay ? "checked" : ""}> Allow overpayment</label>
      </div>`;
    $("sFrom").value = s.from;
    $("sTo").value = s.to;
  } else if (type === "person") {
    const person = idx != null ? p.people[idx] : { name: "" };
    body.innerHTML = `<label>Name<input id="personName" value="${esc(person.name)}"></label>`;
  } else if (type === "project") {
    const pr = idx != null ? db.projects[idx] : { name: "", desc: "" };
    body.innerHTML = `
      <div class="stack">
        <label>Name<input id="projectName" value="${esc(pr.name)}"></label>
        <label>Description<input id="projectDesc" value="${esc(pr.desc || "")}"></label>
      </div>`;
  }

  $("modal").classList.add("show");
  $("modal").style.display = "flex";
}

function closeModal() {
  $("modal").classList.remove("show");
  $("modal").style.display = "none";
  modal = { type: null, idx: null };
}

function err(msg) {
  $("modalError").hidden = false;
  $("modalError").textContent = typeof msg === "string" ? msg : msg.message;
}

function saveModal() {
  const p = project();
  const { type, idx } = modal;
  $("modalError").hidden = true;

  if (type === "transaction") {
    const kind = $("txType").value;
    const amount = Number($("txAmount").value);
    const tx = {
      id: idx != null ? p.transactions[idx].id : uid(),
      date: $("txDate").value,
      type: kind,
      desc: $("txDesc").value.trim(),
      category: $("txCat").value.trim(),
      currency: $("txCur").value.trim() || "INR",
      amount
    };
    if (kind === "deposit") {
      tx.payers = collectMap(p.people, "pay_");
      tx.holders = collectMap(p.people, "hold_");
    } else if (kind === "expense") {
      tx.payers = collectMap(p.people, "expay_");
      tx.source = $("txSource").value;
      tx.shareMode = $("txShareMode").value;
      tx.shares = tx.shareMode === "equal" ? {} : collectMap(p.people, "share_");
    } else {
      tx.from = $("trFrom").value;
      tx.to = $("trTo").value;
    }
    const v = validateTransaction({
      ...p,
      transactions: (p.transactions || []).map((t, i) => i === idx ? tx : t)
    }, tx);
    if (v) return err(v);
    if (idx != null) p.transactions[idx] = tx;
    else p.transactions.push(tx);
  } else if (type === "settlement") {
    const s = {
      id: idx != null ? p.settlements[idx].id : uid(),
      date: $("sDate").value,
      from: $("sFrom").value,
      to: $("sTo").value,
      amount: Number($("sAmount").value),
      note: $("sNote").value.trim(),
      allowOverpay: $("sOver").checked
    };
    const v = validateSettlement({
      ...p,
      settlements: (p.settlements || []).filter((_, i) => i !== idx)
    }, s, { allowOverpay: s.allowOverpay });
    if (v) return err(v);
    if (idx != null) p.settlements[idx] = s;
    else p.settlements.push(s);
  } else if (type === "person") {
    const name = $("personName").value.trim();
    if (!name) return err("Enter a name.");
    if (idx != null) p.people[idx] = { ...p.people[idx], name };
    else p.people.push({ id: uid(), name });
  } else if (type === "project") {
    const name = $("projectName").value.trim();
    if (!name) return err("Enter a project name.");
    const desc = $("projectDesc").value.trim();
    if (idx != null) {
      db.projects[idx] = { ...db.projects[idx], name, desc };
    } else {
      const np = { id: uid(), name, desc, people: [], transactions: [], settlements: [] };
      db.projects.push(np);
      db.current = np.id;
    }
  }

  persist();
  renderAll();
  closeModal();
}

async function refreshAuth() {
  unsubAuth();
  try {
    const { session: s, authError } = await resolveSession();
    session = s;
    if (authError) {
      if (session) {
        showBanner("That sign-in link was already used. You're still signed in.");
      } else {
        showBanner(`${authError} Request a new link from Share.`, true);
      }
    }

    unsub();
    if (session) {
      try {
        await loadFromRemote();
        unsub = await subscribeProjects(() => {
          if (modal.type) return;
          loadFromRemote();
        });
      } catch (e) {
        showBanner(e.message || "Could not sync with cloud", true);
      }
    }

    unsubAuth = await subscribeAuth(async (s) => {
      const wasOut = !session && s;
      session = s;
      if (!s) {
        unsub();
        unsub = () => {};
      } else if (wasOut) {
        try {
          await loadFromRemote();
          unsub = await subscribeProjects(() => {
            if (modal.type) return;
            loadFromRemote();
          });
        } catch { /* ignore */ }
      }
      renderAuthArea();
      renderSettings();
      renderAll();
    });
  } catch {
    session = null;
  } finally {
    renderAuthArea();
    renderSettings();
  }
}

window.db = db;
window.render = renderAll;

applyBuiltinConfig();
attach();
renderAll();
refreshAuth().then(() => renderAll()).catch(() => renderAll());
