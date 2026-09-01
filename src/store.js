import { uid } from "./core.js";

export const KEY = "stallSplit_v5";
export const LEGACY_KEY = "stallSplit_v4";

const people = [
  { id: "sunanda", name: "Sunanda" },
  { id: "mantu", name: "Mantu di" },
  { id: "payel", name: "Payel Sarkar" }
];

function tx(partial) {
  return { id: uid(), currency: "INR", ...partial };
}

/** Seed only what the spec states. Other source-sheet rows are included as editable expenses. */
export function baseProject() {
  return {
    id: uid(),
    name: "Bongo Mela",
    desc: "Food stall — deposits, expenses, and settlements",
    people: people.map(x => ({ ...x })),
    transactions: [
      tx({
        date: "2026-08-28",
        type: "deposit",
        desc: "Advance — Sunanda",
        category: "misc",
        amount: 5000,
        payers: { sunanda: 5000 },
        holders: { payel: 5000 }
      }),
      tx({
        date: "2026-08-28",
        type: "deposit",
        desc: "Advance — Mantu di",
        category: "misc",
        amount: 5000,
        payers: { mantu: 5000 },
        holders: { payel: 5000 }
      }),
      tx({
        date: "2026-08-28",
        type: "deposit",
        desc: "Advance — Payel Sarkar",
        category: "misc",
        amount: 5000,
        payers: { payel: 5000 },
        holders: { payel: 5000 }
      }),
      tx({
        date: "2026-08-28",
        type: "expense",
        desc: "Groceries",
        category: "groceries",
        amount: 9525,
        payers: { payel: 9525 },
        source: "common",
        shareMode: "equal",
        shares: {}
      }),
      tx({
        date: "2026-08-28",
        type: "expense",
        desc: "Potato and onions",
        category: "groceries",
        amount: 740,
        payers: { sunanda: 740 },
        source: "pocket",
        shareMode: "equal",
        shares: {}
      }),
      tx({
        date: "2026-08-28",
        type: "expense",
        desc: "Table deposits",
        category: "misc",
        amount: 10000,
        payers: { payel: 10000 },
        source: "pocket",
        shareMode: "equal",
        shares: {}
      }),
      tx({
        date: "2026-08-29",
        type: "expense",
        desc: "Capsicum 1.2kg",
        category: "groceries",
        amount: 60,
        payers: { sunanda: 60 },
        source: "pocket",
        shareMode: "equal",
        shares: {}
      }),
      tx({
        date: "2026-08-31",
        type: "expense",
        desc: "Breadcrumbs",
        category: "groceries",
        amount: 160,
        payers: { sunanda: 160 },
        source: "pocket",
        shareMode: "equal",
        shares: {}
      }),
      tx({
        date: "2026-08-31",
        type: "expense",
        desc: "Taler pulp ator milk etc",
        category: "groceries",
        amount: 1908,
        payers: { sunanda: 1908 },
        source: "pocket",
        shareMode: "equal",
        shares: {}
      }),
      tx({
        date: "2026-09-01",
        type: "expense",
        desc: "Rapido for Taler pulp",
        category: "food",
        amount: 119,
        payers: { payel: 119 },
        source: "pocket",
        shareMode: "equal",
        shares: {}
      })
    ],
    settlements: [],
    sourceSnapshot: {
      date: "2026-09-01",
      note: "Source sheet snapshot — reconcile against, do not force the books to match if the sheet omitted payer/share details.",
      personNet: { sunanda: -997, mantu: -876, payel: 1873 }
    }
  };
}

function emptyDb() {
  const p = baseProject();
  return { projects: [p], current: p.id };
}

function migrateTx(t) {
  const tx = { ...t, id: t.id || uid(), currency: t.currency || "INR" };
  if (tx.type === "deposit") {
    if (!tx.payers) tx.payers = t.from ? { [t.from]: t.amount } : {};
    if (!tx.holders || Array.isArray(tx.holders)) {
      if (t.to) tx.holders = { [t.to]: t.amount };
      else if (Array.isArray(t.holders)) {
        const h = {};
        t.holders.forEach(id => { h[id] = t.holderAmts?.[id] || t.amount / t.holders.length; });
        tx.holders = h;
      }
    }
  }
  if (tx.type === "expense" && !tx.payers && t.from) {
    tx.payers = { [t.from]: t.amount };
  }
  return tx;
}

function migrateDb(db) {
  if (!db || !Array.isArray(db.projects)) return emptyDb();
  db.projects.forEach(p => {
    p.people = (p.people || []).map(person => ({
      ...person,
      name: person.name === "Samyak" ? "Sunanda" : person.name,
      id: person.id === "samyak" ? "sunanda" : person.id
    }));
    p.transactions = (p.transactions || []).map(migrateTx);
    p.settlements = (p.settlements || []).map(s => ({ ...s, id: s.id || uid() }));
  });
  if (!db.projects.some(p => p.id === db.current)) db.current = db.projects[0]?.id;
  return db;
}

export function loadLocalDB() {
  const raw = localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY);
  if (!raw) {
    const db = emptyDb();
    saveLocalDB(db);
    return db;
  }
  try {
    const db = migrateDb(JSON.parse(raw));
    saveLocalDB(db);
    return db;
  } catch {
    const db = emptyDb();
    saveLocalDB(db);
    return db;
  }
}

export function saveLocalDB(db) {
  localStorage.setItem(KEY, JSON.stringify(db));
}
