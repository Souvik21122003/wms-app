// Pure functions that turn the stored state into dashboard data.
import { today, daysAgo, summarize } from "./store.js";

export const RANGES = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "All time", days: 0 },
];

const pad = (n) => String(n).padStart(2, "0");
const fmtLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => { const [y, m, d] = s.split("-").map(Number); return fmtLocal(new Date(y, m - 1, d + n)); };
export const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const fromOf = (days) => (days ? daysAgo(days - 1) : "");
const sum = (arr, f) => arr.reduce((t, x) => t + f(x), 0);
const inRange = (state, days) => { const f = fromOf(days); return state.history.filter((o) => !f || o.operationDate >= f); };

export const isLow = (p) => p.quantity <= 0 || (p.reorderLevel > 0 && p.quantity <= p.reorderLevel);

export function lowStock(state) {
  const ratio = (p) => (p.reorderLevel > 0 ? p.quantity / p.reorderLevel : 0);
  return state.products.filter(isLow).sort((a, b) => ratio(a) - ratio(b));
}

export function idleStock(state, idleDays = 30) {
  const t = today();
  return state.products
    .filter((p) => p.quantity > 0)
    .map((p) => {
      const since = p.lastDisbursalDate || p.lastArrivalDate || t;
      return { product: p, days: dayDiff(since, t), value: p.quantity * p.unitCost, neverMoved: !p.lastDisbursalDate };
    })
    .filter((r) => r.days >= idleDays)
    .sort((a, b) => b.value - a.value);
}

export function kpis(state, days) {
  const ops = inRange(state, days);
  const of = (t) => ops.filter((o) => o.operationType === t);
  return {
    totalValue: sum(state.products, (p) => p.quantity * p.unitCost),
    products: state.products.length,
    lowStock: lowStock(state).length,
    inbound: sum(of("IN"), (o) => o.valueImpact),
    outbound: -sum(of("OUT"), (o) => o.valueImpact),
    waste: -sum(of("WASTE"), (o) => o.valueImpact),
    ops: ops.length,
  };
}

export const valueByCategory = (state) => {
  const m = new Map();
  state.products.forEach((p) => m.set(p.category, (m.get(p.category) || 0) + p.quantity * p.unitCost));
  return [...m].map(([name, value]) => ({ name, value })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
};

export const topProducts = (state, n = 8) =>
  state.products.map((p) => ({ name: p.name, value: p.quantity * p.unitCost, quantity: p.quantity, unit: p.unit }))
    .sort((a, b) => b.value - a.value).slice(0, n);

export function flowByDay(state, days) {
  const ops = inRange(state, days).filter((o) => o.operationType === "IN" || o.operationType === "OUT");
  const end = today();
  let from = fromOf(days) || (ops.length ? ops.map((o) => o.operationDate).sort()[0] : end);
  if (dayDiff(from, end) > 365) from = addDays(end, -365);
  const rows = new Map();
  for (let d = from; d <= end; d = addDays(d, 1)) rows.set(d, { date: d, Inbound: 0, Outbound: 0 });
  ops.forEach((o) => {
    const r = rows.get(o.operationDate);
    if (!r) return;
    if (o.operationType === "IN") r.Inbound += o.valueImpact; else r.Outbound -= o.valueImpact;
  });
  return [...rows.values()];
}

export function wasteByProduct(state, days) {
  const m = new Map();
  inRange(state, days).filter((o) => o.operationType === "WASTE").forEach((o) => {
    const r = m.get(o.productName) || { name: o.productName, value: 0, qty: 0, unit: o.unit };
    r.value -= o.valueImpact; r.qty -= o.quantityChange;
    m.set(o.productName, r);
  });
  return [...m.values()].sort((a, b) => b.value - a.value);
}

export function opsByType(state, days) {
  const m = new Map();
  inRange(state, days).forEach((o) => m.set(o.operationType, (m.get(o.operationType) || 0) + 1));
  return [...m].map(([name, count]) => ({ name: name.replace("_", " "), count })).sort((a, b) => b.count - a.count);
}

// Inventory value over time = running total of every operation's value impact.
export function valueTrend(state, days) {
  const byDate = new Map();
  state.history.forEach((o) => byDate.set(o.operationDate, (byDate.get(o.operationDate) || 0) + o.valueImpact));
  let run = 0;
  const f = fromOf(days);
  return [...byDate.keys()].sort().map((date) => { run += byDate.get(date); return { date, value: Math.round(run) }; })
    .filter((r) => !f || r.date >= f);
}

export { summarize };
