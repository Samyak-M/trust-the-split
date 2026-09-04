import {
  nameById, shareLabel, payerMap, holderMap,
  totals, enrichedParticipantRows, simplify, expenseBreakdown, round2
} from "./core.js";

const XLSX_ESM = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm";

function typeLabel(tx) {
  if (tx.type === "deposit") return "Deposit";
  if (tx.type === "transfer") return "Cash move";
  return "Expense";
}

function mapLabel(project, map) {
  return Object.entries(map)
    .map(([id, amt]) => `${nameById(project, id)} (${round2(amt)})`)
    .join(", ");
}

function paidByLabel(project, tx) {
  return mapLabel(project, payerMap(tx)) || "—";
}

function heldLabel(project, tx) {
  if (tx.type === "deposit") return mapLabel(project, holderMap(tx)) || "—";
  if (tx.type === "transfer") return `${nameById(project, tx.from)} → ${nameById(project, tx.to)}`;
  return tx.source === "common" ? "Common fund" : "Pocket";
}

function splitDetail(project, tx) {
  if (tx.type !== "expense") return "";
  const splits = expenseBreakdown(project, tx);
  if (!splits.length) return shareLabel(tx);
  return splits.map(s => `${s.name}: ${round2(s.share)}`).join(", ");
}

function balanceStatus(net) {
  if (net > 0.005) return "Gets back";
  if (net < -0.005) return "Owes";
  return "Settled";
}

function summaryRows(project) {
  const t = totals(project);
  const totalSettled = round2((project.settlements || []).reduce((s, x) => s + Number(x.amount || 0), 0));
  const generated = new Date().toLocaleString();
  return [
    ["StallSplit — Project Report"],
    [],
    ["Project", project.name],
    ["Description", project.description || project.desc || ""],
    ["Generated", generated],
    [],
    ["Summary"],
    ["Total group spending", t.expenses],
    ["Total deposited", t.deposits],
    ["Common cash on hand", t.commonCash],
    ["Repayments recorded", totalSettled],
    ["People", (project.people || []).length],
    ["Transactions", (project.transactions || []).length],
    ["Settlements", (project.settlements || []).length]
  ];
}

function transactionRows(project) {
  const header = [
    "Date", "Type", "Description", "Category", "Amount", "Currency",
    "Paid by", "Held by / fund", "Sharing", "Split detail"
  ];
  const rows = (project.transactions || []).map(tx => [
    tx.date,
    typeLabel(tx),
    tx.desc || "",
    tx.category || "",
    round2(tx.amount),
    tx.currency || "INR",
    paidByLabel(project, tx),
    heldLabel(project, tx),
    shareLabel(tx),
    splitDetail(project, tx)
  ]);
  return [header, ...rows];
}

function peopleRows(project) {
  const header = [
    "Person", "Deposited", "Paid for expenses", "Their share",
    "Repaid others", "Received repayments", "Net balance", "Status", "Holding cash"
  ];
  const rows = enrichedParticipantRows(project).map(r => [
    r.name,
    r.deposited,
    r.expensePaid,
    r.share,
    r.settledOut,
    r.settledIn,
    round2(r.net),
    balanceStatus(r.net),
    r.holding
  ]);
  return [header, ...rows];
}

function settlementRows(project) {
  const header = ["Date", "From", "To", "Amount", "Note"];
  const rows = (project.settlements || []).map(s => [
    s.date,
    nameById(project, s.from),
    nameById(project, s.to),
    round2(s.amount),
    s.note || ""
  ]);
  return [header, ...rows];
}

function settleUpRows(project) {
  const header = ["From", "To", "Amount"];
  const debts = simplify(project);
  if (!debts.length) return [header, ["Everyone is settled up", "", ""]];
  const rows = debts.map(d => [
    nameById(project, d.from),
    nameById(project, d.to),
    round2(d.amount)
  ]);
  return [header, ...rows];
}

function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function safeFilename(name) {
  return String(name || "project")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60) || "project";
}

export async function exportProjectReport(project) {
  if (!project) throw new Error("No project selected.");
  const XLSX = await import(XLSX_ESM);
  const wb = XLSX.utils.book_new();

  const sheets = [
    ["Summary", summaryRows(project)],
    ["Transactions", transactionRows(project)],
    ["People", peopleRows(project)],
    ["Settlements", settlementRows(project)],
    ["Settle up", settleUpRows(project)]
  ];

  sheets.forEach(([name, rows]) => {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  });

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const date = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `${safeFilename(project.name)}-report-${date}.xlsx`);
}
