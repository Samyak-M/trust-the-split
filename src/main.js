// main.js - UI logic and event handlers
import { alloc, expenseShares, balances, simplify, shareLabel, moneyFmt, nameById, uid } from './core.js';
import { loadDB, saveDB } from './store.js';

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));

let db = loadDB();
let currentProject = () => db.projects.find(p => p.id === db.current);

// UI State
let modalData = { type: null, data: null };

// Initialize
function init() {
  renderProjectSelect();
  renderNav();
  attachEventListeners();
  renderAll();
}

// Event Listeners
function attachEventListeners() {
  // Navigation
  document.querySelectorAll('.nav').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.dataset.view;
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.getElementById(view)?.classList.add('active');
    });
  });

  // Project select
  document.getElementById('projectSelect')?.addEventListener('change', e => {
    db.current = e.target.value;
    saveDB(db);
    renderAll();
  });

  // Add buttons
  document.getElementById('addTx')?.addEventListener('click', () => openModal('transaction', null));
  document.getElementById('addSettlement')?.addEventListener('click', () => openModal('settlement', null));
  document.getElementById('addPerson')?.addEventListener('click', () => openModal('person', null));
  document.getElementById('addProject')?.addEventListener('click', () => openModal('project', null));

  // Modal controls
  document.getElementById('modalCancel')?.addEventListener('click', closeModal);
  document.getElementById('modalSave')?.addEventListener('click', handleModalSave);
}

// Rendering
function renderProjectSelect() {
  const sel = document.getElementById('projectSelect');
  if (!sel) return;
  sel.innerHTML = db.projects.map(p => `<option value="${p.id}" ${p.id === db.current ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
}

function renderNav() {
  const proj = currentProject();
  document.getElementById('title').textContent = proj?.name || 'No Project';
  document.getElementById('subtitle').textContent = proj?.desc || '';
}

function renderAll() {
  const proj = currentProject();
  if (!proj) return;

  renderNav();
  renderDashboard(proj);
  renderTransactions(proj);
  renderBalances(proj);
  renderSettlements(proj);
  renderPeople(proj);
  renderProjects();
}

function renderDashboard(proj) {
  const people = proj.people || [];
  const bals = balances(proj);
  const simpl = simplify(proj);

  // KPIs
  const deposits = (proj.transactions || []).filter(t => t.type === 'deposit').reduce((s, t) => s + t.amount, 0);
  const expenses = (proj.transactions || []).filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const common = deposits - expenses;

  document.getElementById('kpis').innerHTML = `
    <div class="kpi"><div class="muted">Common fund</div><div class="v">${moneyFmt(common)}</div></div>
    <div class="kpi"><div class="muted">Total deposits</div><div class="v">${moneyFmt(deposits)}</div></div>
    <div class="kpi"><div class="muted">Total expenses</div><div class="v">${moneyFmt(expenses)}</div></div>
  `;

  // Cash holders
  const holders = people.map(p => ({ name: p.name, balance: bals[p.id] || 0 })).sort((a, b) => b.balance - a.balance);
  document.getElementById('cashHolders').innerHTML = holders.map(h =>
    `<div class="flex"><span>${esc(h.name)}</span><span>${moneyFmt(h.balance)}</span></div>`
  ).join('');

  // Debt list
  const debts = simpl.filter(s => s.amount > 0.01);
  document.getElementById('debtList').innerHTML = debts.length === 0
    ? '<p class="muted">Everyone is settled!</p>'
    : debts.map(d => `<div class="flex"><span>${esc(nameById(proj, d.from))} → ${esc(nameById(proj, d.to))}</span><span>${moneyFmt(d.amount)}</span></div>`).join('');

  // Person summary
  const persSum = people.map(p => {
    const dep = (proj.transactions || []).filter(t => t.type === 'deposit' && t.from === p.id).reduce((s, t) => s + t.amount, 0);
    const paid = (proj.transactions || []).filter(t => t.type === 'expense' && t.from === p.id).reduce((s, t) => s + t.amount, 0);
    const share = (expenseShares(proj)[p.id] || 0);
    return { name: p.name, deposit: dep, paid, share, balance: bals[p.id] || 0 };
  });

  document.getElementById('personSummary').innerHTML = persSum.map(p => `
    <tr>
      <td>${esc(p.name)}</td>
      <td>${moneyFmt(p.deposit)}</td>
      <td>${moneyFmt(p.paid)}</td>
      <td>${moneyFmt(p.share)}</td>
      <td>${moneyFmt(p.balance)}</td>
    </tr>
  `).join('');

  // Reconcile
  const currentSnapshot = { date: new Date().toISOString().split('T')[0], commonBalance, personNet: bals };
  const recon = proj.sourceSnapshot || {};
  const reconHtml = `
    <div class="card"><h3>Reconciliation</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div>
          <h4>Current state</h4>
          <p class="muted">As of today</p>
          <div class="flex"><span>Common:</span><span>${moneyFmt(common)}</span></div>
          <div style="margin-top:8px; font-size:0.9em">${
            people.map(p => `<div class="flex"><span>${esc(p.name)}</span><span>${moneyFmt(bals[p.id] || 0)}</span></div>`).join('')
          }</div>
          <button onclick="window.takeSnapshot()" style="margin-top:12px">Take Snapshot</button>
        </div>
        <div>
          <h4>Last snapshot</h4>
          <p class="muted">As of ${esc(recon.date || 'Never')}</p>
          <div class="flex"><span>Common:</span><span>${moneyFmt(recon.commonBalance || 0)}</span></div>
          <div style="margin-top:8px; font-size:0.9em">${
            recon.personNet ? Object.entries(recon.personNet).map(([id, v]) => `<div class="flex"><span>${esc(nameById(proj, id))}</span><span>${moneyFmt(v)}</span></div>`).join('') : '<p class="muted">No snapshot yet</p>'
          }</div>
        </div>
      </div>
    </div>
  `;
  document.getElementById('reconcile').innerHTML = reconHtml;
}

function renderTransactions(proj) {
  const people = proj.people || [];
  const txs = proj.transactions || [];

  document.getElementById('txTable').innerHTML = txs.map((tx, idx) => {
    let paidBy = '';
    if (tx.type === 'expense') {
      if (tx.paymentMode === 'multi' && tx.payers) {
        paidBy = Object.entries(tx.payers).map(([id, amt]) => `${nameById(proj, id)} (${moneyFmt(amt)})`).join(', ');
      } else {
        paidBy = esc(nameById(proj, tx.from));
      }
    } else {
      if (tx.holders?.length > 1) {
        paidBy = tx.holders.map(id => `${nameById(proj, id)}${tx.holderAmts?.[id] ? ` (${moneyFmt(tx.holderAmts[id])})` : ''}`).join(', ');
      } else {
        paidBy = esc(nameById(proj, tx.to));
      }
    }

    return `
      <tr>
        <td>${tx.date}</td>
        <td>${tx.type === 'deposit' ? 'Deposit' : 'Expense'}</td>
        <td>${esc(tx.desc)}</td>
        <td>${moneyFmt(tx.amount)}</td>
        <td>${paidBy}</td>
        <td>${tx.type === 'deposit' ? (tx.holders?.length > 1 ? 'Multiple' : 'Held') : (tx.source === 'common' ? 'Common' : 'Pocket')}</td>
        <td>${tx.type === 'expense' ? shareLabel(tx) : '-'}</td>
        <td><button onclick="window.editTx(${idx})">Edit</button> <button onclick="window.deleteTx(${idx})">Delete</button></td>
      </tr>
    `;
  }).join('');
}

function renderBalances(proj) {
  const simpl = simplify(proj);
  document.getElementById('balancesView').innerHTML = simpl.length === 0
    ? '<p class="muted">Everyone is settled!</p>'
    : simpl.map(s => `
      <div class="flex" style="padding: 8px 0; border-bottom: 1px solid #e0e0e0">
        <span>${esc(nameById(proj, s.from))} pays ${esc(nameById(proj, s.to))}</span>
        <span><b>${moneyFmt(s.amount)}</b></span>
      </div>
    `).join('');
}

function renderSettlements(proj) {
  const settles = proj.settlements || [];
  document.getElementById('settleTable').innerHTML = settles.map((s, idx) => {
    let fromDisplay = '';
    let toDisplay = '';

    if (s.paymentMode === 'multi' && s.payers) {
      fromDisplay = Object.entries(s.payers).map(([id, amt]) => `${nameById(proj, id)} (${moneyFmt(amt)})`).join(', ');
    } else {
      fromDisplay = esc(nameById(proj, s.from));
    }

    if (s.recipients?.length > 1) {
      toDisplay = s.recipients.map(id => `${nameById(proj, id)}${s.recipientAmts?.[id] ? ` (${moneyFmt(s.recipientAmts[id])})` : ''}`).join(', ');
    } else {
      toDisplay = esc(nameById(proj, s.to));
    }

    return `
      <tr>
        <td>${s.date}</td>
        <td>${fromDisplay}</td>
        <td>${toDisplay}</td>
        <td>${moneyFmt(s.amount)}</td>
        <td>${esc(s.note || '')}</td>
        <td><button onclick="window.editSettle(${idx})">Edit</button> <button onclick="window.deleteSettle(${idx})">Delete</button></td>
      </tr>
    `;
  }).join('');
}

function renderPeople(proj) {
  const people = proj.people || [];
  document.getElementById('peopleTable').innerHTML = people.map((p, idx) => `
    <tr>
      <td>${esc(p.name)}</td>
      <td><button onclick="window.editPerson(${idx})">Edit</button> <button onclick="window.deletePerson(${idx})">Delete</button></td>
    </tr>
  `).join('');
}

function renderProjects() {
  document.getElementById('projectTable').innerHTML = db.projects.map((p, idx) => `
    <tr>
      <td>${esc(p.name)}</td>
      <td>${esc(p.desc || '')}</td>
      <td>${(p.people || []).length}</td>
      <td><button onclick="window.editProject(${idx})">Edit</button> <button onclick="window.deleteProject(${idx})">Delete</button></td>
    </tr>
  `).join('');
}

// Modal handling
function openModal(type, idx) {
  const proj = currentProject();
  const people = proj?.people || [];
  let data = null;

  if (type === 'transaction' && idx !== null) data = proj.transactions[idx];
  else if (type === 'settlement' && idx !== null) data = proj.settlements[idx];
  else if (type === 'person' && idx !== null) data = proj.people[idx];
  else if (type === 'project' && idx !== null) data = db.projects[idx];

  modalData = { type, idx };
  const modal = document.getElementById('modal');
  const title = document.getElementById('modalTitle');
  const body = document.getElementById('modalBody');

  title.textContent = {
    transaction: idx !== null ? 'Edit Transaction' : 'Add Transaction',
    settlement: idx !== null ? 'Edit Settlement' : 'Add Settlement',
    person: idx !== null ? 'Edit Person' : 'Add Person',
    project: idx !== null ? 'Edit Project' : 'Add Project'
  }[type] || '';

  if (type === 'transaction') {
    const tx = data || { date: new Date().toISOString().split('T')[0], type: 'expense', desc: '', amount: 0, from: people[0]?.id || '', paymentMode: 'single', payers: {}, to: people[0]?.id || '', source: 'pocket', shareMode: 'equal', shares: {} };
    const paymentMode = tx.paymentMode || (tx.from ? 'single' : 'multi');
    body.innerHTML = `
      <div style="display:grid;gap:14px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label style="font-size:12px;color:#667085">Date</label>
            <input type="date" id="txDate" value="${tx.date}">
          </div>
          <div>
            <label style="font-size:12px;color:#667085">Type</label>
            <select id="txType" onchange="window.updateTxType()">
              <option value="expense" ${tx.type === 'expense' ? 'selected' : ''}>Expense</option>
              <option value="deposit" ${tx.type === 'deposit' ? 'selected' : ''}>Deposit</option>
            </select>
          </div>
        </div>
        <div>
          <label style="font-size:12px;color:#667085">Description</label>
          <input type="text" id="txDesc" value="${esc(tx.desc)}">
        </div>
        <div>
          <label style="font-size:12px;color:#667085">Total Amount</label>
          <input type="number" id="txAmount" value="${tx.amount}" step="0.01" style="font-size:16px;font-weight:bold">
        </div>

        <div id="expenseSection" style="display:${tx.type === 'expense' ? 'block' : 'none'};border:1px solid #e5e7eb;border-radius:10px;padding:12px;background:#f9fafb">
          <label style="font-weight:600;display:block;margin-bottom:8px">💳 Who Paid?</label>
          <div style="display:flex;gap:8px;margin-bottom:12px">
            <button type="button" id="modeSingle" onclick="window.setPaymentMode('single')" style="flex:1;padding:8px;border-radius:6px;border:2px solid #e5e7eb;background:#fff;cursor:pointer;${paymentMode === 'single' ? 'border-color:#2563eb;background:#eff6ff' : ''}">👤 One Person</button>
            <button type="button" id="modeMulti" onclick="window.setPaymentMode('multi')" style="flex:1;padding:8px;border-radius:6px;border:2px solid #e5e7eb;background:#fff;cursor:pointer;${paymentMode === 'multi' ? 'border-color:#2563eb;background:#eff6ff' : ''}">👥 Multiple</button>
          </div>

          <div id="txFromDiv" style="display:${paymentMode === 'single' ? 'block' : 'none'}">
            <select id="txFrom" style="margin-bottom:12px">${people.map(p => `<option value="${p.id}" ${tx.from === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
            <option value="external" ${tx.from === 'external' ? 'selected' : ''}>External / Stall</option></select>
          </div>

          <div id="txPayersDiv" style="display:${paymentMode === 'multi' ? 'block' : 'none'}">
            <div style="background:#fff;border-radius:8px;padding:10px">
              ${people.map(p => `
                <div style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:8px;border-bottom:1px solid #e5e7eb">
                  <label style="cursor:pointer">${esc(p.name)}</label>
                  <input type="number" id="payer_${p.id}" value="${tx.payers?.[p.id] || 0}" step="0.01" placeholder="0" style="width:80px" onchange="window.updateTotalDisplay()">
                </div>
              `).join('')}
            </div>
            <div style="margin-top:8px;padding:8px;background:#dcfce7;border-radius:6px;text-align:right">
              <span style="font-size:12px;color:#666">Total: </span><span id="payerTotal" style="font-weight:bold;color:#15803d">0</span>
            </div>
          </div>
        </div>

        <div id="depositSection" style="display:${tx.type === 'deposit' ? 'block' : 'none'};border:1px solid #e5e7eb;border-radius:10px;padding:12px;background:#f9fafb">
          <label style="font-weight:600;display:block;margin-bottom:8px">🏦 Who Holds the Cash?</label>
          <div style="background:#fff;border-radius:8px;padding:10px">
            ${people.map(p => `
              <div style="display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:8px;border-bottom:1px solid #e5e7eb">
                <input type="checkbox" id="holder_${p.id}" onchange="window.updateHolderTotal()" ${tx.holders?.includes?.(p.id) ? 'checked' : ''}>
                <label style="cursor:pointer">${esc(p.name)}</label>
                <input type="number" id="holderAmt_${p.id}" value="${tx.holderAmts?.[p.id] || 0}" step="0.01" placeholder="0" style="width:80px;${tx.holders?.includes?.(p.id) ? '' : 'opacity:0.5'}" onchange="window.updateHolderTotal()">
              </div>
            `).join('')}
          </div>
          <div style="margin-top:8px;padding:8px;background:#dbeafe;border-radius:6px;text-align:right">
            <span style="font-size:12px;color:#666">Total: </span><span id="holderTotal" style="font-weight:bold;color:#2563eb">0</span>
          </div>
        </div>

        <div id="sourceDiv" style="display:${tx.type === 'expense' ? 'block' : 'none'}">
          <label style="font-size:12px;color:#667085">Payment Source</label>
          <select id="txSource">
            <option value="pocket" ${tx.source === 'pocket' ? 'selected' : ''}>Pocket Money</option>
            <option value="common" ${tx.source === 'common' ? 'selected' : ''}>Common Fund</option>
          </select>
        </div>

        <div id="shareSection" style="display:${tx.type === 'expense' ? 'block' : 'none'};border:1px solid #e5e7eb;border-radius:10px;padding:12px;background:#f9fafb">
          <label style="font-weight:600;display:block;margin-bottom:8px">👥 Who Benefits? (Expense Split)</label>
          <select id="txShareMode" onchange="window.updateShareMode()" style="width:100%;margin-bottom:12px">
            <option value="equal" ${tx.shareMode === 'equal' ? 'selected' : ''}>Equal split (everyone gets equal share)</option>
            <option value="amount" ${tx.shareMode === 'amount' ? 'selected' : ''}>Custom amounts (different amounts per person)</option>
            <option value="share" ${tx.shareMode === 'share' ? 'selected' : ''}>By share / heads (custom ratio)</option>
          </select>
          <div id="shareFields" style="background:#fff;border-radius:8px;padding:10px;margin-top:8px"></div>
        </div>
      </div>
    `;

    window.setPaymentMode = (mode) => {
      document.getElementById('modeSingle').style.cssText = mode === 'single' ? 'flex:1;padding:8px;border-radius:6px;border:2px solid #2563eb;background:#eff6ff;cursor:pointer' : 'flex:1;padding:8px;border-radius:6px;border:2px solid #e5e7eb;background:#fff;cursor:pointer';
      document.getElementById('modeMulti').style.cssText = mode === 'multi' ? 'flex:1;padding:8px;border-radius:6px;border:2px solid #2563eb;background:#eff6ff;cursor:pointer' : 'flex:1;padding:8px;border-radius:6px;border:2px solid #e5e7eb;background:#fff;cursor:pointer';
      document.getElementById('txFromDiv').style.display = mode === 'single' ? 'block' : 'none';
      document.getElementById('txPayersDiv').style.display = mode === 'multi' ? 'block' : 'none';
      if (mode === 'multi') window.updateTotalDisplay();
    };

    window.updateTotalDisplay = () => {
      let total = 0;
      people.forEach(p => {
        total += Number(document.getElementById(`payer_${p.id}`)?.value || 0);
      });
      document.getElementById('payerTotal').textContent = moneyFmt(total);
    };

    window.updateHolderTotal = () => {
      let total = 0;
      people.forEach(p => {
        if (document.getElementById(`holder_${p.id}`).checked) {
          total += Number(document.getElementById(`holderAmt_${p.id}`)?.value || 0);
        }
      });
      document.getElementById('holderTotal').textContent = moneyFmt(total);
    };

    window.updateTxType = () => {
      const typ = document.getElementById('txType').value;
      document.getElementById('expenseSection').style.display = typ === 'expense' ? 'block' : 'none';
      document.getElementById('depositSection').style.display = typ === 'deposit' ? 'block' : 'none';
      document.getElementById('sourceDiv').style.display = typ === 'expense' ? 'block' : 'none';
      document.getElementById('shareSection').style.display = typ === 'expense' ? 'block' : 'none';
    };

    window.updateShareMode = () => {
      const mode = document.getElementById('txShareMode').value;
      const shareDiv = document.getElementById('shareFields');
      if (mode === 'equal') {
        shareDiv.innerHTML = '<p style="color:#667085;font-size:13px">Split equally among all participants</p>';
      } else {
        shareDiv.innerHTML = people.map(p => `
          <div style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:8px;border-bottom:1px solid #e5e7eb">
            <label>${esc(p.name)}</label>
            <input type="number" id="share_${p.id}" value="${tx.shares?.[p.id] || 0}" step="0.01" style="width:80px" placeholder="0">
          </div>
        `).join('');
      }
    };

    window.updateShareMode();
  } else if (type === 'settlement') {
    const s = data || { date: new Date().toISOString().split('T')[0], from: people[0]?.id || '', paymentMode: 'single', payers: {}, to: people[1]?.id || people[0]?.id || '', amount: 0, note: '' };
    const paymentMode = s.paymentMode || (s.from ? 'single' : 'multi');
    body.innerHTML = `
      <div style="display:grid;gap:14px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label style="font-size:12px;color:#667085">Date</label>
            <input type="date" id="settleDate" value="${s.date}">
          </div>
          <div>
            <label style="font-size:12px;color:#667085">Total Amount</label>
            <input type="number" id="settleAmount" value="${s.amount}" step="0.01" style="font-size:16px;font-weight:bold">
          </div>
        </div>

        <div style="border:1px solid #e5e7eb;border-radius:10px;padding:12px;background:#f9fafb">
          <label style="font-weight:600;display:block;margin-bottom:8px">💳 Who is Paying?</label>
          <div style="display:flex;gap:8px;margin-bottom:12px">
            <button type="button" id="settlModeSingle" onclick="window.setSettleMode('single')" style="flex:1;padding:8px;border-radius:6px;border:2px solid #e5e7eb;background:#fff;cursor:pointer;${paymentMode === 'single' ? 'border-color:#2563eb;background:#eff6ff' : ''}">👤 One Person</button>
            <button type="button" id="settlModeMulti" onclick="window.setSettleMode('multi')" style="flex:1;padding:8px;border-radius:6px;border:2px solid #e5e7eb;background:#fff;cursor:pointer;${paymentMode === 'multi' ? 'border-color:#2563eb;background:#eff6ff' : ''}">👥 Multiple</button>
          </div>

          <div id="settleFromDiv" style="display:${paymentMode === 'single' ? 'block' : 'none'}">
            <select id="settleFrom" style="width:100%">${people.map(p => `<option value="${p.id}" ${s.from === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
          </div>

          <div id="settlePayersDiv" style="display:${paymentMode === 'multi' ? 'block' : 'none'}">
            <div style="background:#fff;border-radius:8px;padding:10px">
              ${people.map(p => `
                <div style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:8px;border-bottom:1px solid #e5e7eb">
                  <label style="cursor:pointer">${esc(p.name)}</label>
                  <input type="number" id="settlepayer_${p.id}" value="${s.payers?.[p.id] || 0}" step="0.01" placeholder="0" style="width:80px" onchange="window.updateSettlePayerTotal()">
                </div>
              `).join('')}
            </div>
            <div style="margin-top:8px;padding:8px;background:#dcfce7;border-radius:6px;text-align:right">
              <span style="font-size:12px;color:#666">Total: </span><span id="settlepayerTotal" style="font-weight:bold;color:#15803d">0</span>
            </div>
          </div>
        </div>

        <div style="border:1px solid #e5e7eb;border-radius:10px;padding:12px;background:#f9fafb">
          <label style="font-weight:600;display:block;margin-bottom:8px">💰 Who is Receiving?</label>
          <div style="background:#fff;border-radius:8px;padding:10px">
            ${people.map(p => `
              <div style="display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:8px;border-bottom:1px solid #e5e7eb">
                <input type="checkbox" id="settlerec_${p.id}" onchange="window.updateSettleRecTotal()" ${s.recipients?.includes?.(p.id) ? 'checked' : ''}>
                <label style="cursor:pointer">${esc(p.name)}</label>
                <input type="number" id="settlerecAmt_${p.id}" value="${s.recipientAmts?.[p.id] || 0}" step="0.01" placeholder="0" style="width:80px;${s.recipients?.includes?.(p.id) ? '' : 'opacity:0.5'}">
              </div>
            `).join('')}
          </div>
          <div style="margin-top:8px;padding:8px;background:#dbeafe;border-radius:6px;text-align:right">
            <span style="font-size:12px;color:#666">Total: </span><span id="settlerecTotal" style="font-weight:bold;color:#2563eb">0</span>
          </div>
        </div>

        <div>
          <label style="font-size:12px;color:#667085">Note</label>
          <input type="text" id="settleNote" value="${esc(s.note || '')}" placeholder="e.g., Cash payment, Bank transfer...">
        </div>
      </div>
    `;

    window.setSettleMode = (mode) => {
      document.getElementById('settlModeSingle').style.cssText = mode === 'single' ? 'flex:1;padding:8px;border-radius:6px;border:2px solid #2563eb;background:#eff6ff;cursor:pointer' : 'flex:1;padding:8px;border-radius:6px;border:2px solid #e5e7eb;background:#fff;cursor:pointer';
      document.getElementById('settlModeMulti').style.cssText = mode === 'multi' ? 'flex:1;padding:8px;border-radius:6px;border:2px solid #2563eb;background:#eff6ff;cursor:pointer' : 'flex:1;padding:8px;border-radius:6px;border:2px solid #e5e7eb;background:#fff;cursor:pointer';
      document.getElementById('settleFromDiv').style.display = mode === 'single' ? 'block' : 'none';
      document.getElementById('settlePayersDiv').style.display = mode === 'multi' ? 'block' : 'none';
      if (mode === 'multi') window.updateSettlePayerTotal();
    };

    window.updateSettlePayerTotal = () => {
      let total = 0;
      people.forEach(p => {
        total += Number(document.getElementById(`settlepayer_${p.id}`)?.value || 0);
      });
      document.getElementById('settlepayerTotal').textContent = moneyFmt(total);
    };

    window.updateSettleRecTotal = () => {
      let total = 0;
      people.forEach(p => {
        if (document.getElementById(`settlerec_${p.id}`).checked) {
          total += Number(document.getElementById(`settlerecAmt_${p.id}`)?.value || 0);
        }
      });
      document.getElementById('settlerecTotal').textContent = moneyFmt(total);
    };
  } else if (type === 'person') {
    const p = data || { name: '' };
    body.innerHTML = `
      <div style="display:grid;gap:12px">
        <div><label>Name</label><input type="text" id="personName" value="${esc(p.name)}"></div>
      </div>
    `;
  } else if (type === 'project') {
    const pr = data || { name: '', desc: '' };
    body.innerHTML = `
      <div style="display:grid;gap:12px">
        <div><label>Project name</label><input type="text" id="projectName" value="${esc(pr.name)}"></div>
        <div><label>Description</label><input type="text" id="projectDesc" value="${esc(pr.desc || '')}"></div>
      </div>
    `;
  }

  modal.style.display = 'flex';
}

function closeModal() {
  document.getElementById('modal').style.display = 'none';
  modalData = { type: null, data: null };
}

function handleModalSave() {
  const { type, idx } = modalData;
  const proj = currentProject();

  if (type === 'transaction') {
    const txType = document.getElementById('txType').value;
    const paymentMode = document.getElementById('txPaymentMode')?.value || 'single';

    const tx = {
      date: document.getElementById('txDate').value,
      type: txType,
      desc: document.getElementById('txDesc').value,
      amount: Number(document.getElementById('txAmount').value)
    };

    if (txType === 'expense') {
      tx.paymentMode = paymentMode;
      if (paymentMode === 'single') {
        tx.from = document.getElementById('txFrom').value;
      } else {
        tx.payers = {};
        proj.people.forEach(p => {
          const val = Number(document.getElementById(`payer_${p.id}`)?.value || 0);
          if (val > 0) tx.payers[p.id] = val;
        });
        tx.from = Object.keys(tx.payers)[0] || proj.people[0]?.id;
      }
      tx.source = document.getElementById('txSource').value;
      tx.shareMode = document.getElementById('txShareMode').value;
      tx.shares = {};
      if (tx.shareMode === 'amount' || tx.shareMode === 'share') {
        proj.people.forEach(p => {
          const val = document.getElementById(`share_${p.id}`)?.value;
          if (val) tx.shares[p.id] = Number(val);
        });
      }
    } else if (txType === 'deposit') {
      const holderChecked = proj.people.filter(p => document.getElementById(`holder_${p.id}`)?.checked);
      if (holderChecked.length > 1) {
        tx.holders = holderChecked.map(p => p.id);
        tx.holderAmts = {};
        holderChecked.forEach(p => {
          const amt = Number(document.getElementById(`holderAmt_${p.id}`)?.value || 0);
          if (amt > 0) tx.holderAmts[p.id] = amt;
        });
        tx.from = document.getElementById('txFrom').value || 'external';
        tx.to = null;
      } else {
        tx.from = document.getElementById('txFrom').value || 'external';
        tx.to = holderChecked[0]?.id || proj.people[0]?.id;
      }
    }

    if (idx !== null) {
      proj.transactions[idx] = tx;
    } else {
      proj.transactions.push(tx);
    }
  } else if (type === 'settlement') {
    const paymentMode = document.getElementById('settlModeSingle') ? (document.getElementById('settlModeSingle').style.borderColor === 'rgb(37, 99, 235)' ? 'single' : 'multi') : 'single';
    const s = {
      date: document.getElementById('settleDate').value,
      amount: Number(document.getElementById('settleAmount').value),
      paymentMode: paymentMode,
      note: document.getElementById('settleNote').value
    };

    if (paymentMode === 'single') {
      s.from = document.getElementById('settleFrom').value;
      s.to = null;
    } else {
      s.payers = {};
      people.forEach(p => {
        const val = Number(document.getElementById(`settlepayer_${p.id}`)?.value || 0);
        if (val > 0) s.payers[p.id] = val;
      });
      s.from = Object.keys(s.payers)[0] || proj.people[0]?.id;
    }

    const recipients = [];
    const recipientAmts = {};
    people.forEach(p => {
      if (document.getElementById(`settlerec_${p.id}`)?.checked) {
        recipients.push(p.id);
        const amt = Number(document.getElementById(`settlerecAmt_${p.id}`)?.value || 0);
        if (amt > 0) recipientAmts[p.id] = amt;
      }
    });
    if (recipients.length === 1) {
      s.to = recipients[0];
    } else if (recipients.length > 1) {
      s.recipients = recipients;
      s.recipientAmts = recipientAmts;
    }

    if (idx !== null) {
      proj.settlements[idx] = s;
    } else {
      proj.settlements.push(s);
    }
  } else if (type === 'person') {
    const existing = proj.people[idx];
    const p = { id: existing?.id || uid(), name: document.getElementById('personName').value };
    if (idx !== null) {
      proj.people[idx] = p;
    } else {
      proj.people.push(p);
    }
  } else if (type === 'project') {
    const existing = db.projects[idx];
    const pr = { id: existing?.id || uid(), name: document.getElementById('projectName').value, desc: document.getElementById('projectDesc').value, people: existing?.people || [], transactions: existing?.transactions || [], settlements: existing?.settlements || [] };
    if (idx !== null) {
      db.projects[idx] = pr;
    } else {
      db.projects.push(pr);
    }
  }

  saveDB(db);
  renderAll();
  closeModal();
}

// Window functions for onclick handlers
window.editTx = (idx) => openModal('transaction', idx);
window.deleteTx = (idx) => { currentProject().transactions.splice(idx, 1); saveDB(db); renderAll(); };
window.editSettle = (idx) => openModal('settlement', idx);
window.deleteSettle = (idx) => { currentProject().settlements.splice(idx, 1); saveDB(db); renderAll(); };
window.editPerson = (idx) => openModal('person', idx);
window.deletePerson = (idx) => { currentProject().people.splice(idx, 1); saveDB(db); renderAll(); };
window.editProject = (idx) => openModal('project', idx);
window.deleteProject = (idx) => { db.projects.splice(idx, 1); if (db.current === db.projects[idx]?.id) db.current = db.projects[0]?.id; saveDB(db); renderAll(); };
window.takeSnapshot = () => {
  const proj = currentProject();
  const bals = balances(proj);
  const deposits = (proj.transactions || []).filter(t => t.type === 'deposit').reduce((s, t) => s + t.amount, 0);
  const expenses = (proj.transactions || []).filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  proj.sourceSnapshot = { date: new Date().toISOString().split('T')[0], commonBalance: deposits - expenses, personNet: bals };
  saveDB(db);
  renderAll();
};

init();
