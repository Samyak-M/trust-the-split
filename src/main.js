// main.js - wires the UI, imports core logic and store
import { alloc, expenseShares, balances, simplify, shareLabel, moneyFmt, nameById } from './core.js';
import { loadDB, saveDB } from './store.js';

// small helper (escape) used in templates
const esc = s => String(s ?? "").replace(/[&<>\