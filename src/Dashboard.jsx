import { useMemo, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  PieChart, Pie, Cell, AreaChart, Area,
} from "recharts";
import {
  RANGES, kpis, lowStock, idleStock, valueByCategory, topProducts,
  flowByDay, wasteByProduct, opsByType, valueTrend,
} from "./analytics.js";
import { money, num } from "./format.js";

const COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#65a30d"];
const compact = (n) => new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const moneyTip = (v) => money(v);
const shortDate = (d) => d.slice(5);

function ChartCard({ title, empty, children }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      {empty ? <div className="empty">{empty}</div> : (
        <div style={{ height: 260 }}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>
      )}
    </div>
  );
}

export default function Dashboard({ state }) {
  const [days, setDays] = useState(30);
  const rangeLabel = RANGES.find((r) => r.days === days).label.toLowerCase();

  const k = useMemo(() => kpis(state, days), [state, days]);
  const trend = useMemo(() => valueTrend(state, days), [state, days]);
  const flow = useMemo(() => flowByDay(state, days), [state, days]);
  const cats = useMemo(() => valueByCategory(state), [state]);
  const top = useMemo(() => topProducts(state, 8), [state]);
  const waste = useMemo(() => wasteByProduct(state, days), [state, days]);
  const ops = useMemo(() => opsByType(state, days), [state, days]);
  const low = useMemo(() => lowStock(state), [state]);
  const idle = useMemo(() => idleStock(state, 30), [state]);
  const hasFlow = flow.some((r) => r.Inbound || r.Outbound);

  return (
    <>
      <div className="toolbar">
        <h2>Analytics</h2>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {RANGES.map((r) => <option key={r.days} value={r.days}>{r.label}</option>)}
        </select>
      </div>

      <div className="stats">
        <div className="stat"><span>Inventory value (now)</span><b>{money(k.totalValue)}</b></div>
        <div className="stat"><span>Inbound value ({rangeLabel})</span><b className="pos">{money(k.inbound)}</b></div>
        <div className="stat"><span>Outbound value ({rangeLabel})</span><b>{money(k.outbound)}</b></div>
        <div className="stat"><span>Waste loss ({rangeLabel})</span><b className={k.waste ? "neg" : ""}>{money(k.waste)}</b></div>
        <div className="stat"><span>Low / out of stock</span><b className={k.lowStock ? "neg" : ""}>{k.lowStock}</b></div>
        <div className="stat"><span>Operations ({rangeLabel})</span><b>{k.ops}</b></div>
      </div>

      <div className="charts">
        <ChartCard title="Inventory value over time" empty={trend.length ? null : "No operations in this period"}>
          <AreaChart data={trend} margin={{ left: 0, right: 10, top: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="date" tickFormatter={shortDate} fontSize={12} />
            <YAxis tickFormatter={compact} fontSize={12} width={55} />
            <Tooltip formatter={moneyTip} />
            <Area type="monotone" dataKey="value" name="Inventory value" stroke="#2563eb" fill="#bfdbfe" />
          </AreaChart>
        </ChartCard>

        <ChartCard title="Inbound vs outbound value (per day)" empty={hasFlow ? null : "No arrivals or dispatches in this period"}>
          <BarChart data={flow} margin={{ left: 0, right: 10, top: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="date" tickFormatter={shortDate} fontSize={12} minTickGap={20} />
            <YAxis tickFormatter={compact} fontSize={12} width={55} />
            <Tooltip formatter={moneyTip} />
            <Legend />
            <Bar dataKey="Inbound" fill="#16a34a" />
            <Bar dataKey="Outbound" fill="#2563eb" />
          </BarChart>
        </ChartCard>

        <ChartCard title="Stock value by category" empty={cats.length ? null : "No stock value yet"}>
          <PieChart>
            <Pie data={cats} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
              {cats.map((c, i) => <Cell key={c.name} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={moneyTip} />
            <Legend />
          </PieChart>
        </ChartCard>

        <ChartCard title="Top products by stock value" empty={top.length ? null : "No products yet"}>
          <BarChart data={top} layout="vertical" margin={{ left: 10, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis type="number" tickFormatter={compact} fontSize={12} />
            <YAxis type="category" dataKey="name" width={120} fontSize={12} />
            <Tooltip formatter={moneyTip} />
            <Bar dataKey="value" name="Value" fill="#7c3aed" />
          </BarChart>
        </ChartCard>

        <ChartCard title={`Waste / loss by product (${rangeLabel})`} empty={waste.length ? null : "No waste recorded in this period 🎉"}>
          <BarChart data={waste} margin={{ left: 0, right: 10, top: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="name" fontSize={12} />
            <YAxis tickFormatter={compact} fontSize={12} width={55} />
            <Tooltip formatter={moneyTip} />
            <Bar dataKey="value" name="Loss" fill="#dc2626" />
          </BarChart>
        </ChartCard>

        <ChartCard title={`Operations by type (${rangeLabel})`} empty={ops.length ? null : "No operations in this period"}>
          <BarChart data={ops} margin={{ left: 0, right: 10, top: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="name" fontSize={12} />
            <YAxis allowDecimals={false} fontSize={12} width={35} />
            <Tooltip />
            <Bar dataKey="count" name="Operations" fill="#0891b2" />
          </BarChart>
        </ChartCard>
      </div>

      <div className="grid">
        <div className="card">
          <h2>⚠ Low / out of stock</h2>
          <div className="scroll"><table>
            <thead><tr><th>Product</th><th>Stock</th><th>Reorder level</th></tr></thead>
            <tbody>
              {low.map((p) => (
                <tr key={p.id}><td>{p.name}</td><td className="neg"><b>{num(p.quantity)}</b> {p.unit}</td>
                  <td>{p.reorderLevel > 0 ? `${num(p.reorderLevel)} ${p.unit}` : "not set"}</td></tr>
              ))}
              {low.length === 0 && <tr><td colSpan="3" className="empty">All products are above their reorder level</td></tr>}
            </tbody>
          </table></div>
        </div>
        <div className="card">
          <h2>Idle stock (no dispatch for 30+ days)</h2>
          <div className="scroll"><table>
            <thead><tr><th>Product</th><th>Idle</th><th>Stock</th><th>Value tied up</th></tr></thead>
            <tbody>
              {idle.map((r) => (
                <tr key={r.product.id}><td>{r.product.name}</td>
                  <td>{r.days} days{r.neverMoved ? " (never dispatched)" : ""}</td>
                  <td>{num(r.product.quantity)} {r.product.unit}</td><td>{money(r.value)}</td></tr>
              ))}
              {idle.length === 0 && <tr><td colSpan="4" className="empty">Nothing is sitting idle</td></tr>}
            </tbody>
          </table></div>
        </div>
      </div>
    </>
  );
}
