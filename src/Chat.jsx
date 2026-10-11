import { useEffect, useRef, useState } from "react";
import { answer, askAI, suggestions } from "./chatbot.js";

const INTRO = "Hi! I'm your warehouse assistant. Ask me about stock, costs, arrivals, dispatches, waste or low-stock items. Type “help” for examples.";
const PASS_KEY = "wms:passcode";
const readPass = () => { try { return localStorage.getItem(PASS_KEY) || ""; } catch { return ""; } };

export default function Chat({ state }) {
  const [msgs, setMsgs] = useState([{ role: "bot", text: INTRO, intro: true }]);
  const [input, setInput] = useState("");
  const [ai, setAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [needPass, setNeedPass] = useState(false);
  const [passcode, setPasscode] = useState(readPass);
  const end = useRef(null);

  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [msgs, busy]);

  const savePass = (v) => {
    setPasscode(v);
    try { localStorage.setItem(PASS_KEY, v); } catch { /* ignore */ }
  };

  const send = async (text) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    const prior = msgs.filter((m) => !m.intro && !m.fallback)
      .slice(-6).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));
    const withQ = [...msgs, { role: "user", text: q }];
    if (!ai) { setMsgs([...withQ, { role: "bot", ...answer(state, q) }]); return; }

    setMsgs(withQ);
    setBusy(true);
    try {
      const text = await askAI(state, q, prior, passcode);
      setNeedPass(false);
      setMsgs([...withQ, { role: "bot", text }]);
    } catch (e) {
      if (e.status === 401) setNeedPass(true);
      const local = answer(state, q);
      setMsgs([...withQ, { role: "bot", fallback: true, ...local, text: `⚠ AI mode unavailable: ${e.message}\nBuilt-in answer instead:\n\n${local.text}` }]);
    } finally { setBusy(false); }
  };

  return (
    <div className="card chat">
      <div className="toolbar">
        <h2>Assistant</h2>
        <label className="switch">
          <input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} />
          AI mode <span className="sub">(sends your stock data to the AI service)</span>
        </label>
      </div>
      {ai && needPass && (
        <label>Passcode for AI mode
          <input type="password" value={passcode} onChange={(e) => savePass(e.target.value)} placeholder="ask the site owner" />
        </label>
      )}

      <div className="msgs">
        {msgs.map((m, i) => (
          <div key={i} className={"bubble " + m.role}>
            <div className="txt">{m.text}</div>
            {m.table && (
              <div className="scroll"><table className="mini">
                <thead><tr>{m.table.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>{m.table.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{c}</td>)}</tr>)}</tbody>
              </table></div>
            )}
          </div>
        ))}
        {busy && <div className="bubble bot"><div className="txt">Thinking…</div></div>}
        <div ref={end} />
      </div>

      <div className="chips">
        {suggestions(state).map((s) => <button key={s} type="button" className="chip" onClick={() => send(s)}>{s}</button>)}
      </div>
      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about your stock…" autoFocus />
        <button type="submit" disabled={busy}>Send</button>
      </form>
    </div>
  );
}
