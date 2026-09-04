// Pure money-movement accounting. No I/O.

export const EPS = 0.005;

export function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function nearEq(a, b, eps = EPS) {
  return Math.abs(round2(a) - round2(b)) <= eps;
}

export function moneyFmt(n, currency = "INR") {
  const v = round2(n || 0);
  if (currency === "INR" || !currency) {
    return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(v);
  } catch {
    return currency + " " + v.toFixed(2);
  }
}

export function nameById(project, id) {
  if (!id) return "—";
  if (id === "external") return "External / stall";
  return (project.people || []).find(p => p.id === id)?.name || "Unknown";
}

export function shareLabel(tx) {
  if (!tx || tx.type !== "expense") return "—";
  if (tx.shareMode === "equal" || !tx.shareMode) return "Equal";
  if (tx.shareMode === "amount") return "Unequal ₹";
  if (tx.shareMode === "percent") return "By %";
  return "By share / heads";
}

export function sumMap(map) {
  return Object.values(map || {}).reduce((s, v) => s + Number(v || 0), 0);
}

/** Who physically paid an expense or contributed a deposit. */
export function payerMap(tx) {
  if (tx?.payers && typeof tx.payers === "object" && !Array.isArray(tx.payers)) {
    const out = {};
    Object.entries(tx.payers).forEach(([id, amt]) => {
      if (Number(amt) > 0) out[id] = round2(amt);
    });
    return out;
  }
  if (tx?.from && Number(tx.amount) > 0) return { [tx.from]: round2(tx.amount) };
  return {};
}

/** Who received / holds common cash for a deposit. */
export function holderMap(tx) {
  if (tx?.holders && typeof tx.holders === "object" && !Array.isArray(tx.holders)) {
    const out = {};
    Object.entries(tx.holders).forEach(([id, amt]) => {
      if (Number(amt) > 0) out[id] = round2(amt);
    });
    return out;
  }
  if (Array.isArray(tx?.holders) && tx.holders.length) {
    const out = {};
    tx.holders.forEach(id => {
      const amt = tx.holderAmts?.[id] ?? (tx.amount / tx.holders.length);
      if (Number(amt) > 0) out[id] = round2(amt);
    });
    return out;
  }
  if (tx?.to && Number(tx.amount) > 0) return { [tx.to]: round2(tx.amount) };
  return {};
}

export function alloc(people, tx) {
  const list = people || [];
  if (!list.length) return {};
  const equal = () => Object.fromEntries(list.map(p => [p.id, 1 / list.length]));
  if (!tx || tx.shareMode === "equal" || !tx.shareMode) return equal();
  const raw = tx.shares || {};
  const vals = list.map(u => Number(raw[u.id]) || 0);
  const s = vals.reduce((a, v) => a + v, 0);
  if (!s) return equal();
  return Object.fromEntries(list.map((u, i) => [u.id, vals[i] / s]));
}

export function expenseShares(project) {
  const people = project.people || [];
  const out = Object.fromEntries(people.map(p => [p.id, 0]));
  (project.transactions || []).filter(t => t.type === "expense").forEach(tx => {
    const a = alloc(people, tx);
    people.forEach(p => {
      out[p.id] = round2(out[p.id] + Number(tx.amount) * (a[p.id] || 0));
    });
  });
  return out;
}

export function depositedBy(project) {
  const people = project.people || [];
  const out = Object.fromEntries(people.map(p => [p.id, 0]));
  (project.transactions || []).filter(t => t.type === "deposit").forEach(tx => {
    Object.entries(payerMap(tx)).forEach(([id, amt]) => {
      if (out[id] !== undefined) out[id] = round2(out[id] + amt);
    });
  });
  return out;
}

export function pocketPaidBy(project) {
  const people = project.people || [];
  const out = Object.fromEntries(people.map(p => [p.id, 0]));
  (project.transactions || []).filter(t => t.type === "expense" && t.source !== "common").forEach(tx => {
    Object.entries(payerMap(tx)).forEach(([id, amt]) => {
      if (out[id] !== undefined) out[id] = round2(out[id] + amt);
    });
  });
  return out;
}

export function contributedBy(project) {
  const d = depositedBy(project);
  const p = pocketPaidBy(project);
  const out = {};
  (project.people || []).forEach(person => {
    out[person.id] = round2((d[person.id] || 0) + (p[person.id] || 0));
  });
  return out;
}

/** Common cash location from recorded deposits, common-fund expenses, and transfers. */
export function cashHoldings(project) {
  const people = project.people || [];
  const h = Object.fromEntries(people.map(p => [p.id, 0]));
  (project.transactions || []).forEach(tx => {
    if (tx.type === "deposit") {
      Object.entries(holderMap(tx)).forEach(([id, amt]) => {
        if (h[id] !== undefined) h[id] = round2(h[id] + amt);
      });
    } else if (tx.type === "expense" && tx.source === "common") {
      Object.entries(payerMap(tx)).forEach(([id, amt]) => {
        if (h[id] !== undefined) h[id] = round2(h[id] - amt);
      });
    } else if (tx.type === "transfer") {
      const from = tx.from;
      const to = tx.to;
      const amt = round2(tx.amount);
      if (h[from] !== undefined) h[from] = round2(h[from] - amt);
      if (h[to] !== undefined) h[to] = round2(h[to] + amt);
    }
  });
  return h;
}

export function totals(project) {
  const txs = project.transactions || [];
  const deposits = round2(txs.filter(t => t.type === "deposit").reduce((s, t) => s + Number(t.amount || 0), 0));
  const expenses = round2(txs.filter(t => t.type === "expense").reduce((s, t) => s + Number(t.amount || 0), 0));
  const commonSpend = round2(txs.filter(t => t.type === "expense" && t.source === "common").reduce((s, t) => s + Number(t.amount || 0), 0));
  const pocketSpend = round2(txs.filter(t => t.type === "expense" && t.source !== "common").reduce((s, t) => s + Number(t.amount || 0), 0));
  const holdings = cashHoldings(project);
  const commonCash = round2(sumMap(holdings));
  return { deposits, expenses, commonSpend, pocketSpend, commonCash, holdings };
}

/**
 * Net = deposited + pocket paid − expense share + settlement paid − settlement received.
 * Positive = should receive; negative = should pay.
 */
export function balances(project) {
  const people = project.people || [];
  const contrib = contributedBy(project);
  const shares = expenseShares(project);
  const b = Object.fromEntries(people.map(p => [p.id, round2((contrib[p.id] || 0) - (shares[p.id] || 0))]));
  (project.settlements || []).forEach(s => {
    if (b[s.from] !== undefined) b[s.from] = round2(b[s.from] + Number(s.amount || 0));
    if (b[s.to] !== undefined) b[s.to] = round2(b[s.to] - Number(s.amount || 0));
  });
  return b;
}

export function simplify(project) {
  const people = project.people || [];
  const bMap = balances(project);
  const debt = [];
  const cred = [];
  people.forEach(p => {
    const v = bMap[p.id] || 0;
    if (v < -EPS) debt.push({ id: p.id, v: -v });
    if (v > EPS) cred.push({ id: p.id, v });
  });
  debt.sort((a, b) => b.v - a.v);
  cred.sort((a, b) => b.v - a.v);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < debt.length && j < cred.length) {
    const a = Math.min(debt[i].v, cred[j].v);
    out.push({ from: debt[i].id, to: cred[j].id, amount: round2(a) });
    debt[i].v -= a;
    cred[j].v -= a;
    if (debt[i].v < EPS) i++;
    if (cred[j].v < EPS) j++;
  }
  return out.filter(x => x.amount > EPS);
}

export function owedBy(project, personId) {
  return round2(simplify(project).filter(x => x.from === personId).reduce((s, x) => s + x.amount, 0));
}

export function personUsage(project, personId) {
  const hits = [];
  (project.transactions || []).forEach((tx, i) => {
    const payers = payerMap(tx);
    const holders = holderMap(tx);
    if (payers[personId] || holders[personId] || tx.from === personId || tx.to === personId) {
      hits.push({ kind: "transaction", index: i, desc: tx.desc });
    }
  });
  (project.settlements || []).forEach((s, i) => {
    if (s.from === personId || s.to === personId) hits.push({ kind: "settlement", index: i, desc: s.note });
  });
  return hits;
}

export function validateShare(people, tx) {
  if (tx.type !== "expense") return null;
  const amt = Number(tx.amount);
  if (!(amt > 0)) return "Enter a transaction amount greater than zero.";
  if (tx.shareMode === "amount") {
    const s = sumMap(tx.shares);
    if (!nearEq(s, amt)) {
      return `Share amounts (${moneyFmt(s)}) must equal the expense (${moneyFmt(amt)}).`;
    }
  }
  if (tx.shareMode === "percent") {
    const s = sumMap(tx.shares);
    if (s <= 0) return "Enter at least one percentage.";
  }
  if (tx.shareMode === "share") {
    const s = sumMap(tx.shares);
    if (s <= 0) return "Enter at least one share / head-count weight.";
  }
  const a = alloc(people, tx);
  const rebuilt = round2((people || []).reduce((sum, p) => sum + amt * (a[p.id] || 0), 0));
  if (!nearEq(rebuilt, amt)) return "Normalized shares do not add up to the expense amount.";
  return null;
}

export function validateTransaction(project, tx) {
  const amt = Number(tx.amount);
  if (!tx.date) return "Choose a date.";
  if (!(amt > 0)) return "Amount must be greater than zero.";
  const payers = payerMap(tx);
  if (tx.type === "deposit") {
    const holders = holderMap(tx);
    const paySum = sumMap(payers);
    const holdSum = sumMap(holders);
    if (paySum <= 0) return "Choose who paid the deposit.";
    if (holdSum <= 0) return "Choose who received / holds the money.";
    if (!nearEq(paySum, amt)) return `Payer amounts (${moneyFmt(paySum)}) must equal the deposit (${moneyFmt(amt)}).`;
    if (!nearEq(holdSum, amt)) return `Holder amounts (${moneyFmt(holdSum)}) must equal the deposit (${moneyFmt(amt)}).`;
    return null;
  }
  if (tx.type === "transfer") {
    if (!tx.from || !tx.to) return "Choose who is sending and who is receiving the common cash.";
    if (tx.from === tx.to) return "A cash move needs two different people.";
    const holdings = cashHoldings({
      ...project,
      transactions: (project.transactions || []).filter(t => t.id !== tx.id)
    });
    const have = holdings[tx.from] || 0;
    if (amt - have > EPS) {
      return `${nameById(project, tx.from)} is only holding ${moneyFmt(have)} of common cash.`;
    }
    return null;
  }
  if (tx.type === "expense") {
    const paySum = sumMap(payers);
    if (paySum <= 0) return "Choose who paid.";
    if (!nearEq(paySum, amt)) return `Payer amounts (${moneyFmt(paySum)}) must equal the expense (${moneyFmt(amt)}).`;
    if (tx.source !== "common" && tx.source !== "pocket") return "Choose a funding source: common fund or pocket.";
    if (tx.source === "common") {
      const holdings = cashHoldings({
        ...project,
        transactions: (project.transactions || []).filter(t => t.id !== tx.id)
      });
      for (const [id, paid] of Object.entries(payers)) {
        if (id === "external") continue;
        const have = holdings[id] || 0;
        if (paid - have > EPS) {
          return `${nameById(project, id)} is only holding ${moneyFmt(have)} of common cash, but would pay ${moneyFmt(paid)} from the common fund.`;
        }
      }
    }
    return validateShare(project.people, tx);
  }
  return "Unknown transaction type.";
}

export function validateSettlement(project, s, { allowOverpay = false } = {}) {
  const amt = Number(s.amount);
  if (!s.date) return "Choose a date.";
  if (!s.from || !s.to) return "Choose who paid and who received.";
  if (s.from === s.to) return "A settlement needs two different people.";
  if (!(amt > 0)) return "Amount must be greater than zero.";
  const others = (project.settlements || []).filter(x => x.id !== s.id);
  const projected = { ...project, settlements: others };
  const owed = owedBy(projected, s.from);
  if (!allowOverpay && amt - owed > EPS) {
    return {
      overpay: true,
      message: `${nameById(project, s.from)} currently owes ${moneyFmt(owed)}. Recording ${moneyFmt(amt)} is an overpayment. Tick “allow overpayment” to save it anyway.`
    };
  }
  return null;
}

export function expensePaidBy(project) {
  const people = project.people || [];
  const out = Object.fromEntries(people.map(p => [p.id, 0]));
  (project.transactions || []).filter(t => t.type === "expense").forEach(tx => {
    Object.entries(payerMap(tx)).forEach(([id, amt]) => {
      if (out[id] !== undefined) out[id] = round2(out[id] + amt);
    });
  });
  return out;
}

export function settlementTotals(project) {
  const people = project.people || [];
  const paid = Object.fromEntries(people.map(p => [p.id, 0]));
  const received = Object.fromEntries(people.map(p => [p.id, 0]));
  (project.settlements || []).forEach(s => {
    const amt = round2(s.amount);
    if (paid[s.from] !== undefined) paid[s.from] = round2(paid[s.from] + amt);
    if (received[s.to] !== undefined) received[s.to] = round2(received[s.to] + amt);
  });
  return { paid, received };
}

export function expenseBreakdown(project, tx) {
  if (!tx || tx.type !== "expense") return [];
  const people = project.people || [];
  const a = alloc(people, tx);
  return people
    .map(p => ({ id: p.id, name: p.name, share: round2(Number(tx.amount) * (a[p.id] || 0)) }))
    .filter(x => x.share > EPS);
}

export function enrichedParticipantRows(project) {
  const holdings = cashHoldings(project);
  const paid = expensePaidBy(project);
  const st = settlementTotals(project);
  return participantRows(project).map(r => ({
    ...r,
    expensePaid: paid[r.id] || 0,
    holding: holdings[r.id] || 0,
    settledOut: st.paid[r.id] || 0,
    settledIn: st.received[r.id] || 0,
    status: r.net > EPS ? "gets" : r.net < -EPS ? "owes" : "settled"
  }));
}

export function participantRows(project) {
  const dep = depositedBy(project);
  const pocket = pocketPaidBy(project);
  const share = expenseShares(project);
  const net = balances(project);
  return (project.people || []).map(p => ({
    id: p.id,
    name: p.name,
    deposited: dep[p.id] || 0,
    pocketPaid: pocket[p.id] || 0,
    contributed: round2((dep[p.id] || 0) + (pocket[p.id] || 0)),
    share: share[p.id] || 0,
    net: net[p.id] || 0
  }));
}
