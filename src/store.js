// store.js - persistence and sample data
import { uid } from './core.js';

const KEY = "stallSplit_v4";

const initialPeople = [
  { id: "sunanda", name: "Sunanda" },
  { id: "mantu", name: "Mantu di" },
  { id: "payel", name: "Payel Sarkar" }
];

function baseProject() {
  return {
    id: uid(),
    name: "Bongo Mela",
    desc: "Stall finance",
    people: initialPeople.map(x => ({ ...x })),
    transactions: [
      { date: "2026-08-28", type: "expense", desc: "Groceries", amount: 9525, from: "payel", source: "common", shareMode: "equal", shares: {} },
      { date: "2026-08-28", type: "deposit", desc: "Advance for groceries", amount: 15000, from: "payel", to: "payel", source: "deposit", shareMode: "equal", shares: {} },
      { date: "2026-08-28", type: "expense", desc: "Potato and onions", amount: 740, from: "sunanda", source: "pocket", shareMode: "share", shares: { sunanda: 2/3, mantu: 1/6, payel: 1/6 } },
      { date: "2026-08-28", type: "deposit", desc: "Table deposits", amount: 10000, from: "external", to: "payel", source: "deposit", shareMode: "equal", shares: {} },
      { date: "2026-08-29", type: "expense", desc: "Capsicum 1.2kg", amount: 60, from: "sunanda", source: "pocket", shareMode: "share", shares: { sunanda: 2/3, mantu: 1/6, payel: 1/6 } },
      { date: "2026-08-31", type: "expense", desc: "Breadcrumbs", amount: 160, from: "sunanda", source: "pocket", shareMode: "share", shares: { sunanda: 2/3, mantu: 1/6, payel: 1/6 } },
      { date: "2026-08-31", type: "expense", desc: "Taler pulp ator milk etc", amount: 1908, from: "sunanda", source: "pocket", shareMode: "share", shares: { sunanda: 2/3, mantu: 1/6, payel: 1/6 } },
      { date: "2026-09-01", type: "expense", desc: "Rapido for Taler pulp", amount: 119, from: "payel", source: "pocket", shareMode: "equal", shares: {} }
    ],
    settlements: [],
    sourceSnapshot: { date: "2026-09-01", commonBalance: 1873, personNet: { sunanda: -997, mantu: -876, payel: 0 } }
  };
}

export function loadDB() {
  const raw = localStorage.getItem(KEY);
  if (!raw) {
    const p = baseProject();
    const db = { projects: [p], current: p.id };
    saveDB(db);
    return db;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    const p = baseProject();
    const db = { projects: [p], current: p.id };
    saveDB(db);
    return db;
  }
}

export function saveDB(db) {
  localStorage.setItem(KEY, JSON.stringify(db));
}
