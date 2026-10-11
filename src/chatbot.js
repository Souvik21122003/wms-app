// Built-in assistant: understands common warehouse questions and answers from the stored data.
// Optional AI mode sends a data snapshot to /api/chat (Vercel function) instead.
import { today, daysAgo, summarize } from "./store.js";
import { lowStock, idleStock, topProducts, dayDiff, isLow } from "./analytics.js";
import { money, num, signed } from "./format.js";

const STOP = new Set(("how much many what whats is are the of do does we have has had in on at to a an for and my our me any all " +
  "show tell give list stock stocks quantity qty available left cost costs price rate value values total current currently " +
  "there it its was were when did last with by from since this that please can you i about unit units").split(" "));
const stem = (w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const words = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const ptokens = (p) => new Set(words(`${p.name} ${p.type} ${p.category}`).filter((w) => w.length >= 3 && !STOP.has(w)).map(stem));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pad = (n) => String(n).padStart(2, "0");
const sum = (arr, f) => arr.reduce((t, x) => t + f(x), 0);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

// ----- understanding the question -----
function findProducts(state, q) {
  const ql = q.toLowerCase();
  const qt = new Set(words(q).filter((w) => !STOP.has(w)).map(stem));
  let best = 0;
  const scored = state.products.map((p) => {
    let score = 0;
    const bc = p.barcode.toLowerCase();
    if (bc.length >= 3 && new RegExp(`(^|[^a-z0-9])${esc(bc)}($|[^a-z0-9])`).test(ql)) score += 10;
    if (ql.includes(p.name.toLowerCase())) score += 10;
    ptokens(p).forEach((t) => { if (qt.has(t)) score++; });
    best = Math.max(best, score);
    return { p, score };
  });
  return best > 0 ? scored.filter((x) => x.score === best).map((x) => x.p) : [];
}

function parseRange(ql) {
  const t = today();
  let m;
  if ((m = ql.match(/\b(\d{4}-\d{2}-\d{2})\b/))) return { from: m[1], to: m[1], label: `on ${m[1]}` };
  if ((m = ql.match(/\b(?:last|past|previous)\s+(\d+)\s+days?\b/))) return { from: daysAgo(+m[1] - 1), to: t, label: `in the last ${m[1]} days` };
  if (/\btoday\b/.test(ql)) return { from: t, to: t, label: "today" };
  if (/\byesterday\b/.test(ql)) return { from: daysAgo(1), to: daysAgo(1), label: "yesterday" };
  const dow = (new Date().getDay() + 6) % 7; // Monday = 0
  if (/\bthis week\b/.test(ql)) return { from: daysAgo(dow), to: t, label: "this week" };
  if (/\blast week\b/.test(ql)) return { from: daysAgo(dow + 7), to: daysAgo(dow + 1), label: "last week" };
  const [Y, M] = t.split("-").map(Number);
  if (/\bthis month\b/.test(ql)) return { from: `${Y}-${pad(M)}-01`, to: t, label: "this month" };
  if (/\blast month\b/.test(ql)) {
    const [py, pm] = M === 1 ? [Y - 1, 12] : [Y, M - 1];
    return { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(new Date(py, pm, 0).getDate())}`, label: "last month" };
  }
  if (/\bthis year\b/.test(ql)) return { from: `${Y}-01-01`, to: t, label: "this year" };
  return null;
}

const OP_WORDS = [
  ["WASTE", /\b(wast\w*|loss|losses|lost|damag\w*|scrap\w*|spoil\w*|write[- ]?off)\b/],
  ["IN", /\b(arriv\w*|receiv\w*|inbound|incoming|purchas\w*|bought|restock\w*)\b/],
  ["OUT", /\b(dispatch\w*|disburs\w*|outbound|outgoing|shipped|sold|delivered|issued|sales)\b/],
  ["CORRECTION", /\b(recount\w*|correction\w*|adjust\w*)\b/],
];
const opType = (ql) => (OP_WORDS.find(([, re]) => re.test(ql)) || [])[0] || null;

// ----- helpers for building answers -----
function selectOps(state, { type, range, ids }) {
  return state.history
    .filter((o) => (!type || o.operationType === type) &&
      (!range || (o.operationDate >= range.from && o.operationDate <= range.to)) &&
      (!ids || ids.has(o.productId)))
    .sort((a, b) => b.operationDate.localeCompare(a.operationDate) || b.id - a.id);
}
const byUnit = (ops, f) => {
  const m = {};
  ops.forEach((o) => { m[o.unit] = (m[o.unit] || 0) + f(o); });
  return Object.entries(m).map(([u, v]) => `${num(v)} ${u}`).join(" + ") || "0";
};
const label = (ps) => (ps.length <= 3 ? ps.map((p) => p.name).join(", ") : `${ps.length} products`);
const ago = (d) => { const n = dayDiff(d, today()); return n === 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`; };

const EXAMPLES = [
  "What's the total inventory value?",
  "How much steel do we have?",
  "Which items are low on stock?",
  "What was wasted this month?",
  "What arrived in the last 7 days?",
  "When was Wireless Mouse last dispatched?",
  "Show idle stock",
  "Most valuable products",
  "History of USB-C Cable 1m",
];
export const suggestions = (state) => {
  const p = state.products[0];
  return [EXAMPLES[0], p ? `How much ${p.name} do we have?` : EXAMPLES[1], EXAMPLES[2], EXAMPLES[3], EXAMPLES[4], EXAMPLES[6], EXAMPLES[7]];
};
const HELP = "I answer from the data stored in this app. You can ask things like:\n• " + EXAMPLES.join("\n• ") +
  "\n\nI understand products (name or barcode), categories, dates like “today”, “last 30 days”, “this month”, and words like arrived, dispatched, wasted.";

// ----- answers -----
function stockAns(ps) {
  if (ps.length === 1) {
    const p = ps[0];
    const lines = [
      `${p.name} (${p.barcode}): ${num(p.quantity)} ${p.unit} in stock.`,
      `Unit cost ${money(p.unitCost)} · stock value ${money(p.quantity * p.unitCost)}.`,
      `Last arrival: ${p.lastArrivalDate ? `${p.lastArrivalDate} (${ago(p.lastArrivalDate)})` : "none"} · last disbursal: ${p.lastDisbursalDate ? `${p.lastDisbursalDate} (${ago(p.lastDisbursalDate)})` : "none"}.`,
    ];
    if (isLow(p)) lines.push(p.quantity <= 0 ? "⚠ Out of stock." : `⚠ Low stock: at or below the reorder level of ${num(p.reorderLevel)} ${p.unit}.`);
    return { text: lines.join("\n") };
  }
  const units = new Set(ps.map((p) => p.unit));
  const totalQty = units.size === 1 ? `${num(sum(ps, (p) => p.quantity))} ${ps[0].unit}, ` : "";
  return {
    text: `${ps.length} matching products: ${totalQty}total value ${money(sum(ps, (p) => p.quantity * p.unitCost))}.`,
    table: { headers: ["Product", "Stock", "Unit cost", "Value"], rows: ps.map((p) => [p.name, `${num(p.quantity)} ${p.unit}`, money(p.unitCost), money(p.quantity * p.unitCost)]) },
  };
}

function lowStockAns(state) {
  const low = lowStock(state);
  const tracked = state.products.filter((p) => p.reorderLevel > 0).length;
  if (!low.length) {
    return { text: tracked ? "Nothing is at or below its reorder level right now. 👍" : "No product is out of stock. Set reorder levels (Products → Level) to get low-stock alerts." };
  }
  return {
    text: `${plural(low.length, "product")} ${low.length === 1 ? "needs" : "need"} attention:`,
    table: { headers: ["Product", "Stock", "Reorder level"], rows: low.map((p) => [p.name, `${num(p.quantity)} ${p.unit}`, p.reorderLevel > 0 ? `${num(p.reorderLevel)} ${p.unit}` : "—"]) },
  };
}

function idleAns(state, ql) {
  const m = ql.match(/(\d+)\s*\+?\s*days?/);
  const days = m ? +m[1] : 30;
  const idle = idleStock(state, days);
  if (!idle.length) return { text: `Every product with stock has moved in the last ${days} days.` };
  return {
    text: `${plural(idle.length, "product")} ${idle.length === 1 ? "hasn't" : "haven't"} been dispatched for ${days}+ days, tying up ${money(sum(idle, (r) => r.value))}:`,
    table: { headers: ["Product", "Idle for", "Stock", "Value"], rows: idle.map((r) => [r.product.name, `${r.days} days${r.neverMoved ? " (never dispatched)" : ""}`, `${num(r.product.quantity)} ${r.product.unit}`, money(r.value)]) },
  };
}

function lastDatesAns(ps, op) {
  const field = op === "IN" ? "lastArrivalDate" : "lastDisbursalDate";
  const word = op === "IN" ? "arrival" : "disbursal";
  const lines = ps.map((p) => (p[field] ? `${p.name}: last ${word} on ${p[field]} (${ago(p[field])}).` : `${p.name}: no ${word} recorded.`));
  return { text: lines.join("\n") };
}

function opsTable(ops, limit = 8) {
  return {
    headers: ["Date", "Operation", "Product", "Change", "Balance", "Note"],
    rows: ops.slice(0, limit).map((o) => [o.operationDate, o.operationType.replace("_", " "), o.productName,
      o.quantityChange === 0 ? "—" : `${signed(o.quantityChange)} ${o.unit}`, `${num(o.balanceAfter)} ${o.unit}`, o.note]),
  };
}

function wasteAns(state, range, ps) {
  const ops = selectOps(state, { type: "WASTE", range, ids: ps.length ? new Set(ps.map((p) => p.id)) : null });
  const where = `${range ? ` ${range.label}` : ""}${ps.length ? ` for ${label(ps)}` : ""}`;
  if (!ops.length) return { text: `No waste recorded${where}.` };
  return {
    text: `Waste${where}: ${byUnit(ops, (o) => -o.quantityChange)}, a loss of ${money(-sum(ops, (o) => o.valueImpact))} across ${plural(ops.length, "entry").replace("entrys", "entries")}.`,
    table: { headers: ["Date", "Product", "Lost", "Loss", "Reason"], rows: ops.slice(0, 8).map((o) => [o.operationDate, o.productName, `${num(-o.quantityChange)} ${o.unit}`, money(-o.valueImpact), o.note]) },
  };
}

function flowAns(state, op, range, ps) {
  const ops = selectOps(state, { type: op, range, ids: ps.length ? new Set(ps.map((p) => p.id)) : null });
  const noun = op === "IN" ? "arrival" : "dispatch";
  const where = `${range ? ` ${range.label}` : ""}${ps.length ? ` for ${label(ps)}` : ""}`;
  if (!ops.length) return { text: `No ${noun}s recorded${where}.` };
  return {
    text: `${plural(ops.length, noun)}${where}: ${byUnit(ops, (o) => Math.abs(o.quantityChange))}, worth ${money(Math.abs(sum(ops, (o) => o.valueImpact)))}.`,
    table: { headers: ["Date", "Product", "Quantity", "Value", "Note"], rows: ops.slice(0, 8).map((o) => [o.operationDate, o.productName, `${num(Math.abs(o.quantityChange))} ${o.unit}`, money(Math.abs(o.valueImpact)), o.note]) },
  };
}

function totalAns(state) {
  const total = sum(state.products, (p) => p.quantity * p.unitCost);
  const cats = new Set(state.products.map((p) => p.category)).size;
  return {
    text: `Total inventory value is ${money(total)} across ${plural(state.products.length, "product")} in ${plural(cats, "category").replace("categorys", "categories")}.`,
    table: { headers: ["Category", "Type", "Stock", "Value"], rows: summarize(state).map((r) => [r.category, r.type, `${num(r.totalQuantity)} ${r.unit}`, money(r.totalValue)]) },
  };
}

// ----- main entry -----
export function answer(state, question) {
  const q = question.trim();
  const ql = q.toLowerCase();
  if (!q) return { text: "Ask me something about your stock." };
  if (!state.products.length) return { text: "There are no products yet. Register one first, then ask me about it." };

  const range = parseRange(ql);
  const op = opType(ql);
  const ps = findProducts(state, q);

  if (/^(hi|hello|hey|namaste)\b/.test(ql) && ql.length < 25) return { text: "Hello! Ask me about stock levels, costs, arrivals, dispatches, waste or low-stock items. Type “help” for examples." };
  if (/\bhelp\b|what can you (do|answer)|\bexamples?\b/.test(ql)) return { text: HELP };
  if (/\blow\b|running out|reorder|shortage|out of stock|need to (order|buy)/.test(ql)) return lowStockAns(state);
  if (/\bidle\b|slow[- ]?moving|dead stock|not (been )?(moved|sold|dispatched|moving)|unsold|sitting/.test(ql)) return idleAns(state, ql);
  if (ps.length && /\b(when|last|latest)\b/.test(ql) && (op === "IN" || op === "OUT")) return lastDatesAns(ps, op);
  if (op === "WASTE") return wasteAns(state, range, ps);
  if (op === "IN" || op === "OUT") return flowAns(state, op, range, ps);
  if (/history|activity|transactions?|operations?|\blog\b|what happened|recent|latest|movements?/.test(ql)) {
    const ops = selectOps(state, { type: op, range, ids: ps.length ? new Set(ps.map((p) => p.id)) : null });
    if (!ops.length) return { text: "No matching operations found." };
    return { text: `${plural(ops.length, "operation")}${range ? ` ${range.label}` : ""}${ps.length ? ` for ${label(ps)}` : ""}. Latest ${Math.min(8, ops.length)}:`, table: opsTable(ops) };
  }
  if (ps.length && /\b(cost|price|rate)\b/.test(ql)) {
    return { text: "Current unit cost (weighted average of all arrivals):", table: { headers: ["Product", "Unit cost"], rows: ps.map((p) => [p.name, `${money(p.unitCost)} / ${p.unit}`]) } };
  }
  if (/(most|top|highest|biggest|largest|best)\b.*(valu|stock|inventory|quantit)|most valuable/.test(ql)) {
    const top = topProducts(state, 5);
    const total = sum(state.products, (p) => p.quantity * p.unitCost) || 1;
    return { text: "Top products by stock value:", table: { headers: ["Product", "Stock", "Value", "Share"], rows: top.map((r) => [r.name, `${num(r.quantity)} ${r.unit}`, money(r.value), `${((r.value / total) * 100).toFixed(1)}%`]) } };
  }
  if (!ps.length && /(total|overall|entire|whole|all)\b.*(valu|worth)|inventory value|stock value|worth/.test(ql)) return totalAns(state);
  if (/how many (products|items|skus)|number of (products|items)|list (all )?(products|items)|what (products|items)|all products/.test(ql)) {
    return { text: `You have ${plural(state.products.length, "product")}:`, table: { headers: ["Barcode", "Product", "Category / Type", "Stock"], rows: state.products.slice(0, 15).map((p) => [p.barcode, p.name, `${p.category} / ${p.type}`, `${num(p.quantity)} ${p.unit}`]) } };
  }
  if (/by (category|type)|breakdown|summary|categories|overview/.test(ql)) return totalAns(state);
  if (ps.length) return stockAns(ps);

  return {
    text: "I couldn't match that to your data. Try naming a product, category or barcode, or ask about low stock, waste, arrivals, dispatches or total value.\n\nProducts I know: " +
      state.products.slice(0, 6).map((p) => p.name).join(", ") + (state.products.length > 6 ? ", …" : "") + "\nType “help” for examples.",
  };
}

// ----- optional AI mode (calls the Vercel function in /api/chat) -----
export function buildContext(state) {
  const ops = [...state.history]
    .sort((a, b) => b.operationDate.localeCompare(a.operationDate) || b.id - a.id)
    .slice(0, 200)
    .map((o) => ({ date: o.operationDate, type: o.operationType, product: o.productName, barcode: o.barcode,
      qtyChange: o.quantityChange, unit: o.unit, balanceAfter: o.balanceAfter, unitCost: o.unitCost, valueImpact: o.valueImpact, note: o.note }));
  return {
    today: today(),
    currency: "INR",
    products: state.products.map((p) => ({ barcode: p.barcode, name: p.name, category: p.category, type: p.type, unit: p.unit,
      quantity: p.quantity, unitCost: p.unitCost, value: Math.round(p.quantity * p.unitCost), reorderLevel: p.reorderLevel || 0,
      lastArrivalDate: p.lastArrivalDate, lastDisbursalDate: p.lastDisbursalDate })),
    summaryByCategoryType: summarize(state),
    recentOperations: ops,
    totalOperationsRecorded: state.history.length,
  };
}

export async function askAI(state, question, prior, passcode) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, history: prior, context: buildContext(state), passcode }),
  });
  const data = (res.headers.get("content-type") || "").includes("application/json") ? await res.json() : {};
  if (!res.ok || !data.answer) {
    const e = new Error(data.error || "AI endpoint not available here (deploy to Vercel or run `vercel dev`)");
    e.status = res.status;
    throw e;
  }
  return data.answer;
}
