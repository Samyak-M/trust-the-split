import { uid, round2 } from "./core.js";

const XLSX_ESM = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm";

const COLUMN_ALIASES = {
  date: ["date", "transaction date", "txn date", "trans date", "dt", "when", "day"],
  type: ["type", "transaction type", "txn type", "movement", "txn"],
  description: ["description", "desc", "details", "note", "memo", "particulars", "narration", "item", "name", "title", "remarks", "purpose"],
  amount: ["amount", "value", "total", "sum", "amt", "price", "cost", "debit", "credit", "money", "rupees", "rs", "inr"],
  category: ["category", "cat", "group", "tag", "expense type"],
  paidBy: ["paid by", "paid_by", "payer", "who paid", "paid", "from", "member", "person", "by", "spender", "paidby"],
  heldBy: ["held by", "held_by", "holder", "received by", "received", "holds", "to", "heldby", "beneficiary"],
  source: ["source", "funding", "fund", "paid from", "payment source"],
  shareMode: ["share", "split", "sharing", "share_mode", "split mode", "split type"]
};

const TYPE_MAP = {
  deposit: "deposit",
  advance: "deposit",
  contribution: "deposit",
  expense: "expense",
  payment: "expense",
  spend: "expense",
  spent: "expense",
  transfer: "transfer",
  "cash move": "transfer",
  move: "transfer"
};

function norm(s) {
  return String(s ?? "").trim().toLowerCase();
}

function parseCSVLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if ((c === "," || c === "\t") && !inQ) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

export function parseCSV(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(l => l.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const headers = parseCSVLine(lines[0]);
  const rows = lines.slice(1).map(line => {
    const cells = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cells[i] ?? ""; });
    return obj;
  });
  return { headers, rows };
}

export async function parseFile(file) {
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".tsv") || file.type === "text/csv") {
    const text = await file.text();
    return parseCSV(text);
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || file.type.includes("spreadsheet") || file.type.includes("excel")) {
    const buf = await file.arrayBuffer();
    const XLSX = await import(XLSX_ESM);
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    if (!data.length) return { headers: [], rows: [] };
    const headers = Object.keys(data[0]);
    return { headers, rows: data };
  }
  throw new Error("Unsupported file. Use CSV or Excel (.xlsx, .xls).");
}

function normHeader(s) {
  return String(s ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function headerScore(header, aliases) {
  const h = normHeader(header);
  if (!h) return 0;
  let best = 0;
  for (const alias of aliases) {
    if (h === alias) best = Math.max(best, 100);
    else if (h.includes(alias) || alias.includes(h)) best = Math.max(best, 85);
    else {
      const hw = h.split(" ");
      const aw = alias.split(" ");
      if (hw.some(w => aw.includes(w) && w.length > 2)) best = Math.max(best, 70);
    }
  }
  return best;
}

function looksLikeDate(v) {
  const s = String(v ?? "").trim();
  if (!s) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return true;
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(s)) return true;
  return !isNaN(Date.parse(s));
}

function looksLikeAmount(v) {
  const n = Number(String(v).replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) && n > 0;
}

function inferFromContent(headers, rows) {
  const sample = rows.slice(0, Math.min(20, rows.length));
  const map = {};
  const scores = {};

  headers.forEach(h => {
    const vals = sample.map(r => r[h]);
    const dateHits = vals.filter(looksLikeDate).length;
    const amtHits = vals.filter(looksLikeAmount).length;
    const textHits = vals.filter(v => String(v).trim().length > 2 && !looksLikeAmount(v) && !looksLikeDate(v)).length;

    if (dateHits >= sample.length * 0.4) scores.date = { h, score: dateHits };
    if (amtHits >= sample.length * 0.4) scores.amount = { h, score: amtHits };
    if (textHits >= sample.length * 0.4) scores.description = { h, score: textHits };
    // Short name-like values for paid by
    const nameHits = vals.filter(v => {
      const s = String(v).trim();
      return s.length > 1 && s.length < 40 && !looksLikeAmount(v) && !looksLikeDate(v);
    }).length;
    if (nameHits >= sample.length * 0.4) scores.paidBy = { h, score: nameHits };
  });

  for (const [field, { h }] of Object.entries(scores)) {
    if (!map[field]) map[field] = h;
  }
  return map;
}

/** Positional fallback for headerless or generic exports (col1, col2, …). */
function positionalFallback(headers) {
  if (headers.length < 2) return {};
  const generic = headers.every(h => /^(column|col|field|unnamed|field\d*)$/i.test(normHeader(h)) || /^_\d+$/.test(h));
  if (!generic && headers.some(h => headerScore(h, COLUMN_ALIASES.amount) > 0)) return {};
  const map = {};
  if (headers[0]) map.date = headers[0];
  if (headers[1]) map.description = headers[1];
  if (headers[2]) map.amount = headers[2];
  if (headers[3]) map.category = headers[3];
  if (headers[4]) map.paidBy = headers[4];
  if (headers[5]) map.heldBy = headers[5];
  return map;
}

export function detectColumns(headers, rows = []) {
  const map = {};
  const used = new Set();

  // Pass 1: alias matching (best score wins per field)
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    let bestH = null;
    let bestScore = 0;
    for (const h of headers) {
      if (used.has(h)) continue;
      const score = headerScore(h, aliases);
      if (score > bestScore) { bestScore = score; bestH = h; }
    }
    if (bestH && bestScore >= 70) {
      map[field] = bestH;
      used.add(bestH);
    }
  }

  // Pass 2: infer from cell content
  const inferred = inferFromContent(headers, rows);
  for (const [field, h] of Object.entries(inferred)) {
    if (!map[field] && !used.has(h)) {
      map[field] = h;
      used.add(h);
    }
  }

  // Pass 3: positional fallback
  const pos = positionalFallback(headers);
  for (const [field, h] of Object.entries(pos)) {
    if (!map[field]) map[field] = h;
  }

  return map;
}

export function canAutoImport(columnMap) {
  return Boolean(columnMap.amount);
}

export function columnMapSummary(columnMap) {
  const labels = {
    date: "Date", type: "Type", description: "Description", amount: "Amount",
    category: "Category", paidBy: "Paid by", heldBy: "Held by", source: "Source", shareMode: "Sharing"
  };
  return Object.entries(columnMap)
    .map(([k, v]) => `${labels[k] || k}: "${v}"`)
    .join(" · ");
}

function parseType(raw) {
  const t = norm(raw);
  if (!t) return "expense";
  return TYPE_MAP[t] || "expense";
}

function parseAmount(raw) {
  const n = Number(String(raw).replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? round2(n) : 0;
}

function parseDate(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return new Date().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function splitEvenly(map, total) {
  const ids = Object.keys(map);
  if (!ids.length) return;
  const hasAmounts = ids.some(id => map[id] > 0);
  if (hasAmounts) return;
  const each = round2(total / ids.length);
  ids.forEach((id, i) => {
    map[id] = i === ids.length - 1 ? round2(total - each * (ids.length - 1)) : each;
  });
}

function personIdByName(people, name, create) {
  const n = String(name ?? "").trim();
  if (!n) return null;
  const found = people.find(p => norm(p.name) === norm(n));
  if (found) return found.id;
  if (create) {
    const id = uid();
    people.push({ id, name: n });
    return id;
  }
  return null;
}

function parsePersonField(raw, people, create) {
  const names = String(raw ?? "").split(/[,;&+]/).map(s => s.trim()).filter(Boolean);
  if (!names.length) return {};
  const map = {};
  const each = parseAmount(raw) > 0 && names.length === 1;
  if (each) {
    const id = personIdByName(people, names[0], create);
    if (id) map[id] = parseAmount(raw);
    return map;
  }
  names.forEach(name => {
    const id = personIdByName(people, name, create);
    if (id) map[id] = 0;
  });
  return map;
}

export function extractPeopleFromRows(rows, columnMap) {
  const names = new Set();
  const paidCol = columnMap.paidBy;
  const heldCol = columnMap.heldBy;
  for (const row of rows) {
    for (const col of [paidCol, heldCol]) {
      if (!col) continue;
      String(row[col] ?? "").split(/[,;&+]/).forEach(n => {
        const t = n.trim();
        if (t) names.add(t);
      });
    }
  }
  return [...names];
}

export function rowsToTransactions(rows, columnMap, people, { createPeople = true } = {}) {
  const peopleCopy = people.map(p => ({ ...p }));
  const txs = [];
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const amount = parseAmount(columnMap.amount ? row[columnMap.amount] : 0);
    if (amount <= 0) continue;

    const type = parseType(columnMap.type ? row[columnMap.type] : "");
    const desc = columnMap.description ? String(row[columnMap.description] ?? "").trim() : `Imported row ${i + 2}`;
    const date = parseDate(columnMap.date ? row[columnMap.date] : "");
    const category = columnMap.category ? String(row[columnMap.category] ?? "other").trim() || "other" : "other";

    const tx = {
      id: uid(),
      date,
      type,
      desc: desc || "Imported transaction",
      category,
      currency: "INR",
      amount
    };

    if (type === "deposit") {
      const payers = parsePersonField(columnMap.paidBy ? row[columnMap.paidBy] : "", peopleCopy, createPeople);
      const holders = parsePersonField(columnMap.heldBy ? row[columnMap.heldBy] : "", peopleCopy, createPeople);
      const payIds = Object.keys(payers);
      const holdIds = Object.keys(holders);
      if (!payIds.length || !holdIds.length) {
        errors.push(`Row ${i + 2}: deposit needs paid by and held by.`);
        continue;
      }
      splitEvenly(payers, amount);
      splitEvenly(holders, amount);
      tx.payers = payers;
      tx.holders = holders;
    } else if (type === "transfer") {
      const fromName = columnMap.paidBy ? row[columnMap.paidBy] : "";
      const toName = columnMap.heldBy ? row[columnMap.heldBy] : "";
      const from = personIdByName(peopleCopy, fromName, createPeople);
      const to = personIdByName(peopleCopy, toName, createPeople);
      if (!from || !to) {
        errors.push(`Row ${i + 2}: transfer needs from and to people.`);
        continue;
      }
      tx.from = from;
      tx.to = to;
    } else {
      const payers = parsePersonField(columnMap.paidBy ? row[columnMap.paidBy] : "", peopleCopy, createPeople);
      const payIds = Object.keys(payers);
      if (!payIds.length) {
        errors.push(`Row ${i + 2}: expense needs who paid.`);
        continue;
      }
      splitEvenly(payers, amount);
      tx.payers = payers;
      const src = norm(columnMap.source ? row[columnMap.source] : "pocket");
      tx.source = src.includes("common") || src.includes("fund") ? "common" : "pocket";
      const sm = norm(columnMap.shareMode ? row[columnMap.shareMode] : "equal");
      if (sm.includes("percent") || sm.includes("%")) tx.shareMode = "percent";
      else if (sm.includes("share") || sm.includes("head")) tx.shareMode = "share";
      else if (sm.includes("unequal") || sm.includes("amount")) tx.shareMode = "amount";
      else tx.shareMode = "equal";
      tx.shares = {};
    }
    txs.push(tx);
  }

  return { transactions: txs, people: peopleCopy, errors };
}

export const IMPORT_TEMPLATE = `date,type,description,amount,category,paid by,held by,source,sharing
2026-08-28,deposit,Advance - Sunanda,5000,misc,Sunanda,Payel,,
2026-08-28,deposit,Advance - Mantu,5000,misc,Mantu,Payel,,
2026-08-28,expense,Groceries,9525,groceries,Payel,,common,equal
2026-08-28,expense,Potato and onions,740,groceries,Sunanda,,pocket,equal
`;

export function downloadTemplate() {
  const blob = new Blob([IMPORT_TEMPLATE], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "stallsplit-import-template.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}
