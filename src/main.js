import {
  uid, moneyFmt, nameById, shareLabel, payerMap, holderMap,
  totals, participantRows, simplify,
  validateTransaction, validateSettlement, personUsage, nearEq, round2
} from "./core.js";
import { loadLocalDB, saveLocalDB } from "./store.js";
import {
  getRemoteConfig, setRemoteConfig, isConfigured, getSession, signInWithEmail,
  signOut, fetchRemoteProjects, upsertRemoteProject, deleteRemoteProject,
  inviteToProject, subscribeProjects
} from "./remote.js";
import { SUPABASE } from "./config.js";
import {
  parseFile, detectColumns, rowsToTransactions, extractPeopleFromRows,
  canAutoImport
} from "./import.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const CATEGORIES = ["groceries", "food", "misc", "transport", "supplies", "other"];

let db = loadLocalDB();
let session = null;
let modal = { type: null, idx: null };
let importState = { rows: [], headers: [], columnMap: {}, target: "project" };
let unsub = () => {};
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
    } else if (db.projects.length) {
      for (const p of db.projects) await upsertRemoteProject(p);
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
}

function attach() {
  document.querySelectorAll(".nav").forEach(btn => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });
  $("projectSelect").addEventListener("change", e => {
    db.current = e.target.value;
    persist();
    renderAll();
  });
  $("addTx").addEventListener("click", () => openModal("transaction", null));
  $("addTxEmpty")?.addEventListener("click", () => openModal("transaction", null));
  $("addSettlement").addEventListener("click", () => openModal("settlement", null));
  $("addPerson").addEventListener("click", () => openModal("person", null));
  $("addProject").addEventListener("click", () => openModal("project", null));
  $("importTx").addEventListener("click", () => startImport("current"));
  $("importTxEmpty")?.addEventListener("click", () => startImport("current"));
  $("importProject").addEventListener("click", () => startImport("new"));
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

  $("fileInput").addEventListener("change", onFileSelected);
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
  const sel = $("projectSelect");
  sel.innerHTML = db.projects.map(p =>
    `<option value="${esc(p.id)}" ${p.id === db.current ? "selected" : ""}>${esc(p.name)}</option>`
  ).join("");
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

function renderDashboard(p) {
  const t = totals(p);
  const rows = participantRows(p);
  const debts = simplify(p);
  $("kpis").innerHTML = `
    <div class="kpi"><div class="muted">Total deposits</div><div class="v">${moneyFmt(t.deposits)}</div></div>
    <div class="kpi"><div class="muted">Total expenditure</div><div class="v">${moneyFmt(t.expenses)}</div></div>
    <div class="kpi"><div class="muted">Common cash remaining</div><div class="v">${moneyFmt(t.commonCash)}</div></div>
    <div class="kpi"><div class="muted">Pocket spending</div><div class="v">${moneyFmt(t.pocketSpend)}</div></div>`;

  const holders = (p.people || []).map(person => ({
    name: person.name,
    amt: t.holdings[person.id] || 0
  }));
  $("cashHolders").innerHTML = holders.map(h =>
    `<div class="flex rowline"><span>${esc(h.name)}</span><span>${moneyFmt(h.amt)}</span></div>`
  ).join("") + `<div class="flex rowline total"><span>Total common cash</span><span>${moneyFmt(t.commonCash)}</span></div>`;

  $("debtList").innerHTML = debts.length
    ? debts.map(d => `<div class="flex rowline"><span>${esc(nameById(p, d.from))} → ${esc(nameById(p, d.to))}</span><span>${moneyFmt(d.amount)}</span></div>`).join("")
    : '<p class="muted">No outstanding payments. Everyone is settled.</p>';

  $("personSummary").innerHTML = rows.map(r => `
    <tr>
      <td>${esc(r.name)}</td>
      <td>${moneyFmt(r.deposited)}</td>
      <td>${moneyFmt(r.pocketPaid)}</td>
      <td>${moneyFmt(r.contributed)}</td>
      <td>${moneyFmt(r.share)}</td>
      <td class="${netClass(r.net)}">${moneyFmt(r.net)}</td>
    </tr>`).join("");

  const snap = p.sourceSnapshot;
  if (!snap?.personNet) { $("reconcile").innerHTML = ""; return; }
  const computed = Object.fromEntries(rows.map(r => [r.id, r.net]));
  $("reconcile").innerHTML = `
    <div class="card">
      <h2>Source sheet snapshot (for reconciliation)</h2>
      <p class="muted">${esc(snap.note || "")} As of ${esc(snap.date)}.</p>
      <div class="table"><table><thead><tr><th>Person</th><th>Sheet</th><th>This app</th></tr></thead><tbody>
        ${Object.keys(snap.personNet).map(id => {
          const sheet = snap.personNet[id];
          const app = computed[id] ?? 0;
          const ok = nearEq(sheet, app);
          return `<tr><td>${esc(nameById(p, id))}</td><td>${moneyFmt(sheet)}</td><td class="${ok ? "pos" : "neg"}">${moneyFmt(app)}${ok ? "" : " (differs)"}</td></tr>`;
        }).join("")}
      </tbody></table></div>
    </div>`;
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

function renderTransactions(p) {
  const txs = p.transactions || [];
  const empty = !txs.length;
  $("txTable").closest(".table").hidden = empty;
  $("txEmpty").hidden = !empty;

  $("txTable").innerHTML = txs.map((tx, idx) => `
    <tr>
      <td>${esc(tx.date)}</td>
      <td><span class="pill type-${tx.type}">${typeLabel(tx)}</span></td>
      <td>${esc(tx.desc)}</td>
      <td>${esc(tx.category || "—")}</td>
      <td>${moneyFmt(tx.amount, tx.currency)}</td>
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
  const debts = simplify(p);
  $("balancesView").innerHTML = debts.length
    ? debts.map(d => `
      <div class="debt">
        <div>${esc(nameById(p, d.from))}</div>
        <div>→</div>
        <div>${esc(nameById(p, d.to))}</div>
        <div class="neg">${moneyFmt(d.amount)}</div>
      </div>`).join("")
    : '<p class="muted good-msg">Everyone is settled.</p>';
}

function renderSettlements(p) {
  $("settleTable").innerHTML = (p.settlements || []).map((s, idx) => `
    <tr>
      <td>${esc(s.date)}</td>
      <td>${esc(nameById(p, s.from))}</td>
      <td>${esc(nameById(p, s.to))}</td>
      <td>${moneyFmt(s.amount)}</td>
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

function amountFields(people, map, prefix, { checkboxes = false } = {}) {
  return people.map(p => `
    <div class="amtrow">
      ${checkboxes ? `<input type="checkbox" id="${prefix}chk_${p.id}" ${map[p.id] ? "checked" : ""}>` : ""}
      <label for="${prefix}${p.id}">${esc(p.name)}</label>
      <input type="number" min="0" step="0.01" id="${prefix}${p.id}" value="${map[p.id] || ""}" placeholder="0">
    </div>`).join("");
}

function collectMap(people, prefix) {
  const m = {};
  people.forEach(p => {
    const chk = document.getElementById(prefix + "chk_" + p.id);
    if (chk && !chk.checked) return;
    const n = Number(document.getElementById(prefix + p.id)?.value || 0);
    if (n > 0) m[p.id] = round2(n);
  });
  return m;
}

/* ── Import flow ── */

function startImport(target) {
  importState = { rows: [], headers: [], columnMap: {}, target };
  $("fileInput").value = "";
  $("fileInput").click();
}

async function onFileSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const { headers, rows } = await parseFile(file);
    if (!rows.length) {
      showBanner("No data rows found in the file.", true);
      return;
    }
    const columnMap = detectColumns(headers, rows);
    if (!canAutoImport(columnMap)) {
      showBanner("Couldn't read your file — make sure it has an Amount column (or similar: cost, total, debit).", true);
      return;
    }
    importState = {
      target: importState.target,
      rows,
      headers,
      columnMap,
      fileName: file.name
    };
    applyImport({ createPeople: true });
  } catch (err) {
    showBanner(err.message || "Could not read file", true);
  }
}

function applyImport({ createPeople = true } = {}) {
  const isNew = importState.target === "new";
  const existingPeople = isNew ? [] : (project().people || []);
  const { transactions, people, errors } = rowsToTransactions(
    importState.rows, importState.columnMap, existingPeople, { createPeople }
  );

  if (!transactions.length) {
    showBanner(errors[0] || "No valid transactions found in the file.", true);
    return;
  }

  if (isNew) {
    const name = importState.fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
    const desc = `Imported from ${importState.fileName}`;
    const np = { id: uid(), name, desc, people, transactions, settlements: [] };
    db.projects.push(np);
    db.current = np.id;
  } else {
    const p = project();
    if (createPeople) {
      const existingIds = new Set(p.people.map(x => x.id));
      people.forEach(person => {
        if (!existingIds.has(person.id)) p.people.push(person);
      });
    }
    p.transactions.push(...transactions);
  }

  const peopleNames = extractPeopleFromRows(importState.rows, importState.columnMap);
  let msg = `Imported ${transactions.length} transaction(s) from ${importState.fileName}.`;
  if (peopleNames.length) msg += ` People: ${peopleNames.join(", ")}.`;
  if (errors.length) msg += ` ${errors.length} row(s) skipped.`;
  showBanner(msg, errors.length > 0);

  persist();
  renderAll();
  closeModal();
  if (isNew) setView("transactions");
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
          <div class="box-title">Who received / holds it?</div>
          ${amountFields(people, holders, "hold_")}
        </div>

        <div id="boxExpense" class="box">
          <div class="box-title">Who paid? Sum must equal the amount.</div>
          ${amountFields(people, payers, "expay_")}
          <label>Funding source
            <select id="txSource">
              <option value="common" ${tx.source === "common" ? "selected" : ""}>Common fund</option>
              <option value="pocket" ${tx.source !== "common" ? "selected" : ""}>Pocket (on top of deposits)</option>
            </select>
          </label>
          <label>Sharing for this expense
            <select id="txShareMode">
              <option value="equal" ${tx.shareMode === "equal" ? "selected" : ""}>Equal</option>
              <option value="amount" ${tx.shareMode === "amount" ? "selected" : ""}>Unequal ₹ (must sum to amount)</option>
              <option value="percent" ${tx.shareMode === "percent" ? "selected" : ""}>Percentages (normalized)</option>
              <option value="share" ${tx.shareMode === "share" ? "selected" : ""}>Shares / head-count (e.g. 2 : 3 : 1)</option>
            </select>
          </label>
          <div id="shareBox">${amountFields(people, tx.shares || {}, "share_")}</div>
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
    const sync = () => {
      const kind = $("txType").value;
      $("boxDeposit").style.display = kind === "deposit" ? "block" : "none";
      $("boxExpense").style.display = kind === "expense" ? "block" : "none";
      $("boxTransfer").style.display = kind === "transfer" ? "block" : "none";
      const mode = $("txShareMode")?.value;
      $("shareBox").style.display = mode && mode !== "equal" ? "block" : "none";
    };
    $("txType").addEventListener("change", sync);
    $("txShareMode").addEventListener("change", sync);
    sync();
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
        ${idx == null ? `
          <div class="choice-cards">
            <p class="muted">Or import your existing spreadsheet instead:</p>
            <button type="button" class="choice-card" id="projectImportBtn">
              <span class="choice-icon">📄</span>
              <span><strong>Import from CSV / Excel</strong><br><span class="muted">Bring in people and transactions from a spreadsheet</span></span>
            </button>
          </div>` : ""}
      </div>`;
    $("projectImportBtn")?.addEventListener("click", () => {
      closeModal();
      startImport("new");
    });
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
  if (modal.type === "import") return applyImport();

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
  try {
    session = await getSession();
  } catch {
    session = null;
  }
  unsub();
  if (session) {
    await loadFromRemote();
    unsub = await subscribeProjects(() => {
      if (modal.type) return;
      loadFromRemote();
    });
  }
  renderAuthArea();
  renderSettings();
}

window.db = db;
window.render = renderAll;

applyBuiltinConfig();
attach();
refreshAuth().then(() => renderAll());
