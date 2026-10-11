// All warehouse logic + localStorage persistence (replaces the Spring Boot backend).
import { useEffect, useState } from "react";

const KEY = "wms:v1";
const r4 = (n) => Math.round(n * 1e4) / 1e4;
const fmt = (n) => String(r4(n));
const bad = (m) => { throw new Error(m); };
const blank = (s) => s == null || String(s).trim() === "";
export const ymd = (ms) => new Date(ms - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const today = () => ymd(Date.now());
export const daysAgo = (n) => ymd(Date.now() - n * 864e5);

// ---------- operation log ----------
function log(s, p, type, change, unitCost, value, date, note) {
  const o = {
    id: s.nextOpId++, productId: p.id, barcode: p.barcode, productName: p.name,
    category: p.category, type: p.type, unit: p.unit,
    operationType: type, quantityChange: r4(change), balanceAfter: p.quantity,
    unitCost, valueImpact: r4(value), operationDate: date, note: note || "",
    createdAt: new Date().toISOString(),
  };
  s.history.push(o);
  return o;
}

const findById = (s, id) => s.products.find((p) => p.id === id) ?? bad("Product not found");

// ---------- actions (each mutates the draft state `s` and returns the logged operation) ----------
export function register(s, r) {
  if ([r.barcode, r.name, r.category, r.type, r.unit].some(blank))
    bad("Barcode, name, category, type and unit are required");
  const qty = Number(r.quantity) || 0, cost = Number(r.unitCost) || 0;
  if (qty < 0 || cost < 0) bad("Quantity and cost cannot be negative");
  const barcode = r.barcode.trim();
  if (s.products.some((p) => p.barcode === barcode)) bad("Barcode already registered");

  const date = r.arrivalDate || today();
  const p = {
    id: s.nextProductId++, barcode, name: r.name.trim(), category: r.category.trim(),
    type: r.type.trim(), unit: r.unit.trim(), quantity: r4(qty), unitCost: cost,
    lastArrivalDate: qty > 0 ? date : null, lastDisbursalDate: null,
    reorderLevel: Math.max(0, Number(r.reorderLevel) || 0),
  };
  s.products.push(p);
  return log(s, p, "REGISTER", qty, cost, qty * cost, date, blank(r.note) ? "Opening stock" : r.note.trim());
}

export function scan(s, r) {
  const code = (r.barcode || "").trim();
  const p = s.products.find((x) => x.barcode === code)
    ?? bad(`Unknown barcode: ${code}. Register the product first.`);
  const q = Number(r.quantity);
  if (!(q > 0)) bad("Quantity must be greater than 0");
  const date = r.date || today();
  const note = blank(r.note) ? "" : r.note.trim();

  if (r.action === "IN") {
    const inCost = r.unitCost != null && r.unitCost !== "" ? Number(r.unitCost) : p.unitCost;
    if (inCost < 0) bad("Cost cannot be negative");
    const newQty = r4(p.quantity + q);
    p.unitCost = r4((p.quantity * p.unitCost + q * inCost) / newQty); // weighted average
    p.quantity = newQty;
    if (!p.lastArrivalDate || date > p.lastArrivalDate) p.lastArrivalDate = date;
    return log(s, p, "IN", q, inCost, q * inCost, date, note);
  }
  if (r.action === "OUT") {
    if (p.quantity < q) bad(`Insufficient stock for ${p.name} (available: ${fmt(p.quantity)} ${p.unit})`);
    p.quantity = r4(p.quantity - q);
    if (!p.lastDisbursalDate || date > p.lastDisbursalDate) p.lastDisbursalDate = date;
    return log(s, p, "OUT", -q, p.unitCost, -q * p.unitCost, date, note);
  }
  return bad("Action must be IN or OUT");
}

export function adjust(s, id, r) {
  const p = findById(s, id);
  if (blank(r.reason)) bad("A reason is required");
  const q = Number(r.quantity);
  if (!(q >= 0)) bad("Quantity cannot be negative");
  const date = r.date || today();
  let change, note;

  if (r.kind === "WASTE") {
    if (q === 0) bad("Quantity lost must be greater than 0");
    if (p.quantity < q) bad(`Cannot waste more than available (${fmt(p.quantity)} ${p.unit})`);
    change = -q;
    note = r.reason.trim();
  } else if (r.kind === "CORRECTION") {
    change = r4(q - p.quantity);
    if (change === 0) bad("Counted quantity equals current stock");
    note = `Recount (was ${fmt(p.quantity)}): ${r.reason.trim()}`;
  } else bad("Kind must be WASTE or CORRECTION");

  p.quantity = r4(p.quantity + change);
  return log(s, p, r.kind, change, p.unitCost, change * p.unitCost, date, note);
}

export function changeCost(s, id, r) {
  const p = findById(s, id);
  const nc = Number(r.unitCost);
  if (!(nc >= 0)) bad("Cost cannot be negative");
  const old = p.unitCost;
  if (nc === old) bad("New cost equals current cost");
  const revaluation = p.quantity * (nc - old);
  p.unitCost = nc;
  const note = `Unit cost ${fmt(old)} -> ${fmt(nc)}` + (blank(r.reason) ? "" : `: ${r.reason.trim()}`);
  return log(s, p, "COST_CHANGE", 0, nc, revaluation, today(), note);
}

export function setReorderLevel(s, id, level) {
  const p = findById(s, id);
  const n = Number(level);
  if (!(n >= 0)) bad("Reorder level cannot be negative");
  p.reorderLevel = n; // settings change, not a stock movement: not logged
  return p;
}

// ---------- queries ----------
const has = (v, q) => String(v ?? "").toLowerCase().includes(q);

export function searchProducts(s, q) {
  q = q.trim().toLowerCase();
  return s.products
    .filter((p) => !q || [p.name, p.barcode, p.category, p.type].some((v) => has(v, q)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function searchHistory(s, { q = "", type = "", from = "", to = "" }) {
  q = q.trim().toLowerCase();
  return s.history
    .filter((o) =>
      (!q || [o.productName, o.barcode, o.category, o.type, o.note].some((v) => has(v, q))) &&
      (!type || o.operationType === type) &&
      (!from || o.operationDate >= from) &&
      (!to || o.operationDate <= to))
    .sort((a, b) => b.operationDate.localeCompare(a.operationDate) || b.id - a.id)
    .slice(0, 300);
}

export function summarize(s) {
  const map = new Map();
  for (const p of s.products) {
    const k = [p.category, p.type, p.unit].join("|");
    const row = map.get(k) ?? { category: p.category, type: p.type, unit: p.unit, totalQuantity: 0, totalValue: 0, products: 0 };
    row.totalQuantity = r4(row.totalQuantity + p.quantity);
    row.totalValue += p.quantity * p.unitCost;
    row.products += 1;
    map.set(k, row);
  }
  return [...map.values()].sort((a, b) => a.category.localeCompare(b.category) || a.type.localeCompare(b.type));
}

// ---------- persistence ----------
export const isValid = (s) =>
  s && Array.isArray(s.products) && Array.isArray(s.history) &&
  Number.isFinite(s.nextProductId) && Number.isFinite(s.nextOpId);

export function seed() {
  const s = { products: [], history: [], nextProductId: 1, nextOpId: 1 };
  const add = (barcode, name, category, type, unit, quantity, unitCost, ago, reorderLevel) =>
    register(s, { barcode, name, category, type, unit, quantity, unitCost, arrivalDate: daysAgo(ago), reorderLevel });
  add("4001", "Mild Steel Rod", "Metal", "Steel", "ton", 5, 55000, 30, 2);
  add("1001", "Cotton T-Shirt M", "Apparel", "Shirt", "pcs", 50, 350, 20, 15);
  add("1002", "Cotton T-Shirt L", "Apparel", "Shirt", "pcs", 30, 380, 45, 15);
  add("2001", "USB-C Cable 1m", "Electronics", "Cable", "pcs", 100, 120, 15, 30);
  add("2002", "Wireless Mouse", "Electronics", "Mouse", "pcs", 40, 650, 15, 10);
  add("3001", "Basmati Rice", "Grocery", "Grain", "kg", 750, 95, 10, 200);

  // some activity so the dashboard has something to show
  const mv = (barcode, action, quantity, ago, extra = {}) =>
    scan(s, { barcode, action, quantity, date: daysAgo(ago), ...extra });
  const id = (code) => s.products.find((p) => p.barcode === code).id;
  mv("4001", "OUT", 1, 12);
  mv("4001", "IN", 2, 8, { unitCost: 58000, note: "Supplier: Tata Steel" });
  adjust(s, id("4001"), { kind: "WASTE", quantity: 0.5, reason: "Rusted in storage", date: daysAgo(5) });
  mv("4001", "OUT", 1, 2, { note: "Site delivery" });
  mv("1001", "OUT", 12, 9);
  mv("1001", "IN", 20, 6, { unitCost: 360 });
  mv("1001", "OUT", 8, 3);
  mv("2001", "OUT", 40, 7);
  adjust(s, id("2001"), { kind: "WASTE", quantity: 3, reason: "Damaged in transit", date: daysAgo(4) });
  mv("2001", "OUT", 25, 1);
  mv("2002", "OUT", 30, 6);
  mv("3001", "OUT", 100, 5);
  return s;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const s = JSON.parse(raw); if (isValid(s)) return s; }
  } catch { /* fall through to seed data */ }
  return seed();
}

function save(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage full or blocked */ }
}

export function useStore() {
  const [state, setState] = useState(load);
  useEffect(() => { save(state); }, [state]);
  // keep several open tabs in sync
  useEffect(() => {
    const h = (e) => { if (e.key === KEY) setState(load()); };
    window.addEventListener("storage", h);
    return () => window.removeEventListener("storage", h);
  }, []);

  // Run an action on a copy of the state; if it throws, nothing is saved.
  const act = (fn) => {
    const draft = structuredClone(state);
    const result = fn(draft);
    setState(draft);
    return result;
  };
  return { state, act, replace: setState, reset: () => setState(seed()) };
}
