import { lazy, Suspense, useMemo, useRef, useState } from "react";
import {
  useStore, today, register, scan, adjust, changeCost, setReorderLevel,
  searchProducts, searchHistory, summarize, isValid,
} from "./store.js";
import { money, num, signed } from "./format.js";
import { isLow } from "./analytics.js";
const Dashboard = lazy(() => import("./Dashboard.jsx")); // keeps the charts library out of the first load
import Chat from "./Chat.jsx";

const OP_TYPES = ["REGISTER", "IN", "OUT", "WASTE", "CORRECTION", "COST_CHANGE"];
const emptyProd = () => ({ barcode: "", name: "", category: "", type: "", unit: "", quantity: 0, unitCost: 0, arrivalDate: today(), reorderLevel: 0 });

// ---------- adjust dialog (waste / recount / cost / reorder level) ----------
function Dialog({ product, mode, act, onClose, onDone }) {
  const initial = { COST: product.unitCost, CORRECTION: product.quantity, LEVEL: product.reorderLevel || 0 }[mode];
  const [value, setValue] = useState(initial === undefined ? "" : String(initial));
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(today());
  const [err, setErr] = useState(null);
  const u = product.unit;

  const title = { WASTE: "Record waste / loss", CORRECTION: "Stock recount", COST: "Update unit cost", LEVEL: "Set reorder level" }[mode];
  const label = {
    WASTE: `Quantity lost (${u})`,
    CORRECTION: `Counted quantity (${u})`,
    COST: `New unit cost (₹ per ${u})`,
    LEVEL: `Reorder level (${u})`,
  }[mode];
  const needsReason = mode === "WASTE" || mode === "CORRECTION";

  let preview = null;
  if (value !== "" && mode === "WASTE") preview = `Stock: ${num(product.quantity)} → ${num(product.quantity - Number(value))} ${u}`;
  if (value !== "" && mode === "CORRECTION") preview = `Stock: ${num(product.quantity)} → ${num(Number(value))} ${u}`;
  if (value !== "" && mode === "COST") preview = `Inventory value changes by ${money(product.quantity * (Number(value) - product.unitCost))}`;
  if (mode === "LEVEL") preview = "You'll get a low-stock alert when stock is at or below this. Use 0 to switch the alert off.";

  const submit = (e) => {
    e.preventDefault();
    try {
      act((s) => {
        if (mode === "COST") return changeCost(s, product.id, { unitCost: value, reason });
        if (mode === "LEVEL") return setReorderLevel(s, product.id, value);
        return adjust(s, product.id, { kind: mode, quantity: value, reason, date });
      });
      onDone(mode === "LEVEL" ? `Reorder level for ${product.name} set to ${num(Number(value))} ${u}` : `${title}: ${product.name} updated`);
    } catch (e2) { setErr(e2.message); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{title} — {product.name}</h2>
        {err && <div className="banner err">{err}</div>}
        <label>{label}
          <input type="number" step="any" min="0" value={value} onChange={(e) => setValue(e.target.value)} required autoFocus />
        </label>
        {preview && <p className="hint">{preview}</p>}
        {needsReason && (
          <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        )}
        {mode !== "LEVEL" && (
          <label>Reason{needsReason && " (required)"}
            <input value={reason} onChange={(e) => setReason(e.target.value)} required={needsReason}
                   placeholder={mode === "WASTE" ? "e.g. rusted / damaged in transit" : ""} />
          </label>
        )}
        <div className="row end">
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="submit">Save</button>
        </div>
      </form>
    </div>
  );
}

// ---------- main app ----------
export default function App() {
  const { state, act, replace, reset } = useStore();
  const [msg, setMsg] = useState(null);
  const [tab, setTab] = useState("ops");
  const [dialog, setDialog] = useState(null);
  const fileRef = useRef(null);

  const [pq, setPq] = useState("");
  const [hq, setHq] = useState(""); const [hop, setHop] = useState("");
  const [hfrom, setHfrom] = useState(""); const [hto, setHto] = useState("");

  const [scanForm, setScanForm] = useState({ barcode: "", action: "IN", quantity: 1, unitCost: "", date: today(), note: "" });
  const [prod, setProd] = useState(emptyProd);

  const all = state.products;
  const products = useMemo(() => searchProducts(state, pq), [state, pq]);
  const summary = useMemo(() => summarize(state), [state]);
  const history = useMemo(() => searchHistory(state, { q: hq, type: hop, from: hfrom, to: hto }), [state, hq, hop, hfrom, hto]);

  const ok = (text) => setMsg({ ok: true, text });
  const fail = (e) => setMsg({ ok: false, text: e.message });

  const doScan = (e) => {
    e.preventDefault();
    try {
      const r = act((s) => scan(s, {
        ...scanForm,
        unitCost: scanForm.action === "IN" ? scanForm.unitCost : null,
      }));
      ok(`${r.operationType === "IN" ? "Received" : "Dispatched"} ${num(Math.abs(r.quantityChange))} ${r.unit} of ${r.productName}. New stock: ${num(r.balanceAfter)} ${r.unit}`);
      setScanForm((s) => ({ ...s, quantity: 1, unitCost: "", note: "" }));
    } catch (err) { fail(err); }
  };

  const doRegister = (e) => {
    e.preventDefault();
    try {
      const o = act((s) => register(s, prod));
      ok(`Registered ${o.productName} (barcode ${o.barcode})`);
      setProd(emptyProd());
    } catch (err) { fail(err); }
  };

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `wms-backup-${today()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importBackup = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!isValid(data)) throw new Error();
      if (!window.confirm("Replace all current data with this backup?")) return;
      replace(data);
      ok("Backup restored");
    } catch { fail(new Error("Not a valid backup file")); }
  };

  const doReset = () => {
    if (window.confirm("Delete all data and reload the demo products?")) { reset(); ok("Demo data restored"); }
  };

  const set = (setter) => (e) => setter((s) => ({ ...s, [e.target.name]: e.target.value }));
  const uniq = (key) => [...new Set(all.map((p) => p[key]).filter(Boolean))];
  const found = all.find((p) => p.barcode === scanForm.barcode.trim());
  const totalValue = summary.reduce((s, r) => s + r.totalValue, 0);

  return (
    <div className="app">
      <div className="header">
        <h1>Warehouse Management</h1>
        <div className="header-actions">
          <button className="ghost sm" onClick={exportBackup}>Export backup</button>
          <button className="ghost sm" onClick={() => fileRef.current.click()}>Import backup</button>
          <button className="ghost sm" onClick={doReset}>Reset demo data</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={importBackup} />
        </div>
      </div>
      <p className="note">Data is saved in this browser only (localStorage). Use Export backup to move it elsewhere.</p>
      {msg && <div className={"banner " + (msg.ok ? "ok" : "err")}>{msg.text}</div>}

      <div className="tabs">
        {[["ops", "Operations"], ["dash", "Dashboard"], ["chat", "Assistant"]].map(([k, l]) => (
          <button key={k} className={"tab" + (tab === k ? " active" : "")} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === "dash" && <Suspense fallback={<p className="note">Loading charts…</p>}><Dashboard state={state} /></Suspense>}
      {tab === "chat" && <Chat state={state} />}

      {tab === "ops" && (<>
      <div className="stats">
        <div className="stat"><span>Inventory value</span><b>{money(totalValue)}</b></div>
        <div className="stat"><span>Products</span><b>{all.length}</b></div>
        <div className="stat"><span>Operations logged</span><b>{state.history.length}</b></div>
      </div>

      <div className="grid">
        <form className="card" onSubmit={doScan}>
          <h2>Scan item</h2>
          <label>Barcode
            <input name="barcode" value={scanForm.barcode} onChange={set(setScanForm)} list="barcodes" placeholder="e.g. 4001" required />
            <datalist id="barcodes">{all.map((p) => <option key={p.id} value={p.barcode}>{p.name}</option>)}</datalist>
          </label>
          {scanForm.barcode && (
            <p className={"hint " + (found ? "" : "warn")}>
              {found ? `${found.name} · stock ${num(found.quantity)} ${found.unit} · ${money(found.unitCost)}/${found.unit}`
                     : "Unknown barcode — register it first"}
            </p>
          )}
          <div className="row">
            <label>Action
              <select name="action" value={scanForm.action} onChange={set(setScanForm)}>
                <option value="IN">Arrival (stock IN)</option>
                <option value="OUT">Disbursal (stock OUT)</option>
              </select>
            </label>
            <label>Quantity{found ? ` (${found.unit})` : ""}
              <input type="number" step="any" min="0" name="quantity" value={scanForm.quantity} onChange={set(setScanForm)} required />
            </label>
          </div>
          <div className="row">
            <label>{scanForm.action === "IN" ? "Arrival date" : "Disbursal date"}
              <input type="date" name="date" value={scanForm.date} onChange={set(setScanForm)} required />
            </label>
            {scanForm.action === "IN" && (
              <label>Unit cost of this batch (₹)
                <input type="number" step="any" min="0" name="unitCost" value={scanForm.unitCost} onChange={set(setScanForm)}
                       placeholder={found ? String(found.unitCost) : "current cost"} />
              </label>
            )}
          </div>
          <label>Note<input name="note" value={scanForm.note} onChange={set(setScanForm)} placeholder="supplier, customer, PO no. …" /></label>
          <button type="submit">📷 Scan</button>
        </form>

        <form className="card" onSubmit={doRegister}>
          <h2>Register new product</h2>
          <div className="row">
            <label>Barcode<input name="barcode" value={prod.barcode} onChange={set(setProd)} required /></label>
            <label>Name<input name="name" value={prod.name} onChange={set(setProd)} required /></label>
          </div>
          <div className="row">
            <label>Category
              <input name="category" value={prod.category} onChange={set(setProd)} list="cats" required />
              <datalist id="cats">{uniq("category").map((c) => <option key={c} value={c} />)}</datalist>
            </label>
            <label>Type
              <input name="type" value={prod.type} onChange={set(setProd)} list="types" required />
              <datalist id="types">{uniq("type").map((t) => <option key={t} value={t} />)}</datalist>
            </label>
            <label>Unit
              <input name="unit" value={prod.unit} onChange={set(setProd)} list="units" placeholder="ton, kg, pcs" required />
              <datalist id="units">{[...new Set(["pcs", "kg", "ton", "litre", "box", "m", ...uniq("unit")])].map((u) => <option key={u} value={u} />)}</datalist>
            </label>
          </div>
          <div className="row">
            <label>Opening stock<input type="number" step="any" min="0" name="quantity" value={prod.quantity} onChange={set(setProd)} /></label>
            <label>Cost per unit (₹)<input type="number" step="any" min="0" name="unitCost" value={prod.unitCost} onChange={set(setProd)} /></label>
            <label>Arrival date<input type="date" name="arrivalDate" value={prod.arrivalDate} onChange={set(setProd)} required /></label>
          </div>
          <label>Reorder level (low-stock alert when stock falls to this; 0 = off)
            <input type="number" step="any" min="0" name="reorderLevel" value={prod.reorderLevel} onChange={set(setProd)} />
          </label>
          <button type="submit">Add product</button>
        </form>
      </div>

      <div className="card">
        <h2>Stock by category &amp; type</h2>
        <div className="scroll"><table>
          <thead><tr><th>Category</th><th>Type</th><th>SKUs</th><th>Total stock</th><th>Total value</th></tr></thead>
          <tbody>
            {summary.map((s) => (
              <tr key={s.category + s.type + s.unit}>
                <td>{s.category}</td><td>{s.type}</td><td>{s.products}</td>
                <td><b>{num(s.totalQuantity)}</b> {s.unit}</td><td>{money(s.totalValue)}</td>
              </tr>
            ))}
            {summary.length === 0 && <tr><td colSpan="5" className="empty">No stock yet</td></tr>}
          </tbody>
        </table></div>
      </div>

      <div className="card">
        <div className="toolbar">
          <h2>Products</h2>
          <input className="search" placeholder="Search name, barcode, category, type…" value={pq} onChange={(e) => setPq(e.target.value)} />
        </div>
        <div className="scroll"><table>
          <thead><tr><th>Barcode</th><th>Product</th><th>Category / Type</th><th>Stock</th><th>Unit cost</th><th>Value</th><th>Last arrival</th><th>Last disbursal</th><th>Manage</th></tr></thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>{p.barcode}</td><td>{p.name}</td><td>{p.category} / {p.type}</td>
                <td><b>{num(p.quantity)}</b> {p.unit} {isLow(p) && <span className="badge WASTE">LOW</span>}</td>
                <td>{money(p.unitCost)}</td><td>{money(p.quantity * p.unitCost)}</td>
                <td>{p.lastArrivalDate ?? "—"}</td><td>{p.lastDisbursalDate ?? "—"}</td>
                <td className="actions">
                  <button className="sm" onClick={() => setDialog({ product: p, mode: "WASTE" })}>Waste</button>
                  <button className="sm" onClick={() => setDialog({ product: p, mode: "CORRECTION" })}>Recount</button>
                  <button className="sm" onClick={() => setDialog({ product: p, mode: "COST" })}>Cost</button>
                  <button className="sm" onClick={() => setDialog({ product: p, mode: "LEVEL" })}>Level</button>
                </td>
              </tr>
            ))}
            {products.length === 0 && <tr><td colSpan="9" className="empty">No products found</td></tr>}
          </tbody>
        </table></div>
      </div>

      <div className="card">
        <div className="toolbar">
          <h2>Operation history</h2>
          <input className="search" placeholder="Search product, barcode, note…" value={hq} onChange={(e) => setHq(e.target.value)} />
          <select value={hop} onChange={(e) => setHop(e.target.value)}>
            <option value="">All operations</option>
            {OP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input type="date" value={hfrom} onChange={(e) => setHfrom(e.target.value)} title="From" />
          <input type="date" value={hto} onChange={(e) => setHto(e.target.value)} title="To" />
        </div>
        <div className="scroll"><table>
          <thead><tr><th>Date</th><th>Operation</th><th>Product</th><th>Change</th><th>Balance</th><th>Unit cost</th><th>Value impact</th><th>Note</th></tr></thead>
          <tbody>
            {history.map((o) => (
              <tr key={o.id}>
                <td>{o.operationDate}</td>
                <td><span className={"badge " + o.operationType}>{o.operationType.replace("_", " ")}</span></td>
                <td>{o.productName}<div className="sub">{o.barcode}</div></td>
                <td>{o.quantityChange === 0 ? "—" : `${signed(o.quantityChange)} ${o.unit}`}</td>
                <td>{num(o.balanceAfter)} {o.unit}</td>
                <td>{money(o.unitCost)}</td>
                <td className={o.valueImpact < 0 ? "neg" : "pos"}>{money(o.valueImpact)}</td>
                <td>{o.note}</td>
              </tr>
            ))}
            {history.length === 0 && <tr><td colSpan="8" className="empty">No operations found</td></tr>}
          </tbody>
        </table></div>
      </div>

      </>)}

      {dialog && (
        <Dialog {...dialog} act={act} onClose={() => setDialog(null)}
                onDone={(text) => { ok(text); setDialog(null); }} />
      )}
    </div>
  );
}
