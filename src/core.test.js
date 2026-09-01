import {
  nearEq, totals, cashHoldings, expenseShares, depositedBy, pocketPaidBy,
  balances, simplify, validateTransaction, validateSettlement, alloc
} from "./core.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const people = [
  { id: "sunanda", name: "Sunanda" },
  { id: "mantu", name: "Mantu di" },
  { id: "payel", name: "Payel Sarkar" }
];

const groceryProject = {
  people,
  transactions: [
    { type: "deposit", amount: 5000, payers: { sunanda: 5000 }, holders: { payel: 5000 } },
    { type: "deposit", amount: 5000, payers: { mantu: 5000 }, holders: { payel: 5000 } },
    { type: "deposit", amount: 5000, payers: { payel: 5000 }, holders: { payel: 5000 } },
    { type: "expense", amount: 9525, payers: { payel: 9525 }, source: "common", shareMode: "equal", shares: {} }
  ],
  settlements: []
};

{
  const t = totals(groceryProject);
  assert(nearEq(t.deposits, 15000), "deposits 15000");
  assert(nearEq(t.commonCash, 5475), "common remaining 5475");
  assert(nearEq(cashHoldings(groceryProject).payel, 5475), "Payel holds 5475");
  assert(nearEq(cashHoldings(groceryProject).sunanda, 0), "Sunanda holds 0");
  const dep = depositedBy(groceryProject);
  assert(nearEq(dep.sunanda, 5000) && nearEq(dep.mantu, 5000) && nearEq(dep.payel, 5000), "each deposited 5000");
  const sh = expenseShares(groceryProject);
  assert(nearEq(sh.sunanda, 3175) && nearEq(sh.payel, 3175), "equal grocery share");
  const b = balances(groceryProject);
  assert(nearEq(b.sunanda, 1825), "net unused deposit");
  assert(simplify(groceryProject).length === 0, "no debts while leftover is common cash");
}

{
  const tx = { date: "2026-08-28", type: "expense", amount: 1000, payers: { sunanda: 500, mantu: 300, payel: 200 }, source: "pocket", shareMode: "amount", shares: { sunanda: 500, mantu: 300, payel: 200 } };
  assert(!validateTransaction({ people, transactions: [] }, tx), "valid multi payer + amount shares");
  const bad = { ...tx, payers: { sunanda: 500, mantu: 300, payel: 100 } };
  assert(validateTransaction({ people, transactions: [] }, bad), "payer mismatch rejected");
  const badShare = { ...tx, shares: { sunanda: 400, mantu: 300, payel: 200 } };
  assert(validateTransaction({ people, transactions: [] }, badShare), "share mismatch rejected");
}

{
  const a = alloc(people, { shareMode: "share", shares: { sunanda: 2, mantu: 3, payel: 1 } });
  assert(nearEq(a.sunanda, 2 / 6) && nearEq(a.mantu, 0.5) && nearEq(a.payel, 1 / 6), "2:3:1 weights");
}

{
  const p = {
    people,
    transactions: [
      { type: "expense", amount: 300, payers: { payel: 300 }, source: "pocket", shareMode: "equal", shares: {} }
    ],
    settlements: []
  };
  const debts = simplify(p);
  assert(debts.length === 2, "two people pay Payel");
  const s = { date: "2026-09-02", from: "sunanda", to: "payel", amount: 10000 };
  const v = validateSettlement(p, s);
  assert(v && v.overpay, "overpayment flagged");
  assert(!validateSettlement(p, s, { allowOverpay: true }), "overpayment allowed when confirmed");
}

{
  const moved = {
    ...groceryProject,
    transactions: [
      ...groceryProject.transactions,
      { type: "transfer", from: "payel", to: "mantu", amount: 2000 }
    ]
  };
  const h = cashHoldings(moved);
  assert(nearEq(h.payel, 3475) && nearEq(h.mantu, 2000), "transfer moves holdings only");
  assert(nearEq(balances(moved).sunanda, balances(groceryProject).sunanda), "transfer does not change net");
}

{
  const pocket = { type: "expense", amount: 740, payers: { sunanda: 740 }, source: "pocket", shareMode: "equal", shares: {} };
  const p = { ...groceryProject, transactions: [...groceryProject.transactions, pocket] };
  assert(nearEq(pocketPaidBy(p).sunanda, 740), "pocket is extra on top of deposit");
  assert(nearEq(totals(p).commonCash, 5475), "pocket does not reduce common cash");
}

console.log("core tests ok");
