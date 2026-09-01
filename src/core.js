// core.js - pure functions for calculations
export function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function moneyFmt(n) {
  return "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Get allocation map for a single transaction
// people: array of person objects [{id,name}]
// tx: transaction object
export function alloc(people, tx) {
  if (!tx) return {};
  if (tx.shareMode === "equal" || !tx.shareMode) {
    return Object.fromEntries(people.map(p => [p.id, 1 / people.length]));
  }
  const a = tx.shares || {};
  const vals = people.map(u => Number(a[u.id]) || 0);
  const s = vals.reduce((acc, v) => acc + v, 0);
  if (!s) return Object.fromEntries(people.map(u => [u.id, 1 / people.length]));
  return Object.fromEntries(people.map((u, i) => [u.id, vals[i] / s]));
}

// Expense shares aggregated per person
export function expenseShares(project) {
  const people = project.people || [];
  const out = Object.fromEntries(people.map(p => [p.id, 0]));
  (project.transactions || []).filter(t => t.type === "expense").forEach(tx => {
    const a = alloc(people, tx);
    people.forEach(p => {
      out[p.id] += tx.amount * (a[p.id] || 0);
    });
  });
  return out;
}

// Balances aggregated per person (positive = person is owed money)
export function balances(project) {
  const people = project.people || [];
  const b = Object.fromEntries(people.map(p => [p.id, 0]));
  const txs = project.transactions || [];

  // deposits and expense payouts
  txs.forEach(x => {
    if (x.type === "deposit") {
      if (b[x.from] !== undefined) b[x.from] -= x.amount;
      if (x.holders?.length > 1) {
        // Multi-holder deposit
        x.holders.forEach(holder => {
          const amt = x.holderAmts?.[holder] || (x.amount / x.holders.length);
          if (b[holder] !== undefined) b[holder] += amt;
        });
      } else if (b[x.to] !== undefined) {
        b[x.to] += x.amount;
      }
    } else if (x.type === "expense") {
      // Handle multi-payer expenses
      if (x.payers && typeof x.payers === "object") {
        Object.entries(x.payers).forEach(([payerId, amt]) => {
          if (b[payerId] !== undefined) b[payerId] += amt;
        });
      } else if (b[x.from] !== undefined) {
        // Single payer expense
        b[x.from] += x.amount;
      }
    }
  });

  // subtract each person's expense share
  const ex = expenseShares(project);
  Object.keys(ex).forEach(id => {
    if (b[id] !== undefined) b[id] -= ex[id];
  });

  // settlements (repayments)
  (project.settlements || []).forEach(s => {
    // Handle multi-payer settlements
    if (s.payers && typeof s.payers === "object") {
      Object.entries(s.payers).forEach(([payerId, amt]) => {
        if (b[payerId] !== undefined) b[payerId] += amt;
      });
    } else if (b[s.from] !== undefined) {
      b[s.from] += s.amount;
    }

    // Handle multi-recipient settlements
    if (s.recipients?.length > 1) {
      s.recipients.forEach(recId => {
        const amt = s.recipientAmts?.[recId] || (s.amount / s.recipients.length);
        if (b[recId] !== undefined) b[recId] -= amt;
      });
    } else if (b[s.to] !== undefined) {
      b[s.to] -= s.amount;
    }
  });

  return b;
}

// Simplify balances into repayments (greedy algorithm)
export function simplify(project) {
  const people = project.people || [];
  const bMap = balances(project);
  const debt = [], cred = [];
  people.forEach(p => {
    const v = bMap[p.id] || 0;
    if (v < -0.005) debt.push({ id: p.id, v: -v });
    if (v > 0.005) cred.push({ id: p.id, v: v });
  });
  debt.sort((a, b) => b.v - a.v);
  cred.sort((a, b) => b.v - a.v);
  const out = [];
  let i = 0, j = 0;
  while (i < debt.length && j < cred.length) {
    const a = Math.min(debt[i].v, cred[j].v);
    out.push({ from: debt[i].id, to: cred[j].id, amount: a });
    debt[i].v -= a; cred[j].v -= a;
    if (debt[i].v < 0.005) i++;
    if (cred[j].v < 0.005) j++;
  }
  return out;
}

export function shareLabel(tx) {
  if (!tx) return "";
  if (tx.shareMode === "equal") return "Equal";
  if (tx.shareMode === "amount") return "Unequal ₹";
  return "By share / heads";
}

export function nameById(project, id) {
  if (id === "external") return "External / Stall";
  return (project.people || []).find(p => p.id === id)?.name || "Unknown";
}
