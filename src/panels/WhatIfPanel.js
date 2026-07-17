// What-If sandbox panel (2026-07-17) — apply a hypothetical EDB/EDU text tweak
// in a temp SHADOW copy of the mod, run the turn-1 economy model against it,
// and diff every faction vs the unmodified current mod. The real mod files are
// never written. Self-contained: owns its own state, talks to the main process
// via the "run-what-if" IPC (src/whatIfHandlers.js → src/whatIfSandbox.js).
// Style matches ArmySetupModal / EconBaselinePanel's dark look.
import React, { useEffect, useRef, useState } from "react";

// Mirror of econBaseline.js FIELD_DIRECTION (that module is CJS/main-process):
// which direction is "better" per field, for coloring.
const FIELD_DIRECTION = { settlements: 0, income: 1, upkeep: -1, net: 1 };
const FIELD_LABEL = { settlements: "Settlements", income: "Income", upkeep: "Army upkeep", net: "Net" };

const GREEN = "#9ed6ad", RED = "#e8a090", NEUTRAL = "#9ab";

const FILE_OPTIONS = [
  { value: "export_descr_buildings.txt", label: "EDB (export_descr_buildings)" },
  { value: "export_descr_unit.txt", label: "EDU (export_descr_unit)" },
];
const FILE_SHORT = { "export_descr_buildings.txt": "EDB", "export_descr_unit.txt": "EDU" };

function deltaColor(field, deltaPct) {
  const dir = FIELD_DIRECTION[field] || 0;
  if (!dir || !deltaPct) return NEUTRAL;
  return (deltaPct * dir > 0) ? GREEN : RED;
}

const fmt = (n) => (typeof n === "number" && Number.isFinite(n)) ? n.toLocaleString("en-US") : "—";

const newEdit = () => ({ file: "export_descr_buildings.txt", find: "", replace: "" });

export default function WhatIfPanel({ modDataDir, onClose }) {
  const [edits, setEdits] = useState([newEdit()]);
  const [threshold, setThreshold] = useState("5");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(null);
  const [editErrors, setEditErrors] = useState(null); // [{ file, find, message }] zero-match details
  const [result, setResult] = useState(null);
  const timerRef = useRef(null);

  const api = (typeof window !== "undefined" && window.electronAPI) || {};
  const missingBridge = !api.runWhatIf;

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const setEdit = (i, patch) =>
    setEdits(list => list.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const addEdit = () => setEdits(list => [...list, newEdit()]);
  const removeEdit = (i) => setEdits(list => (list.length > 1 ? list.filter((_, j) => j !== i) : list));

  const usableEdits = edits.filter(e => e.find.trim() !== "");

  const doRun = async () => {
    if (busy || !modDataDir || missingBridge || !usableEdits.length) return;
    const th = Math.max(0, parseFloat(threshold) || 5);
    setBusy(true); setError(null); setEditErrors(null); setResult(null); setElapsed(0);
    const t0 = Date.now();
    timerRef.current = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    try {
      const payload = usableEdits.map(e => ({ file: e.file, find: e.find, replace: e.replace }));
      const r = await api.runWhatIf(modDataDir, payload, th);
      if (r && r.error) {
        setError(r.error);
        if (Array.isArray(r.errors) && r.errors.length) setEditErrors(r.errors);
      } else setResult(r || null);
    } catch (e) { setError(e?.message || String(e)); }
    finally {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setBusy(false);
    }
  };

  const btnStyle = (accent) => ({
    background: accent ? "rgba(232,200,115,0.14)" : "rgba(60,60,60,0.7)",
    color: accent ? "#e8c873" : "#9ab",
    border: "1px solid " + (accent ? "#a08a4a" : "rgba(255,255,255,0.25)"),
    borderRadius: 5, padding: "3px 12px", cursor: "pointer", fontSize: "0.78rem",
  });
  const inputStyle = {
    background: "rgba(255,255,255,0.07)", color: "#eee",
    border: "1px solid rgba(255,255,255,0.18)", borderRadius: 6,
    padding: "3px 8px", fontSize: "0.78rem",
  };
  const taStyle = {
    ...inputStyle, flex: 1, minWidth: 160, minHeight: 40, resize: "vertical",
    fontFamily: "Consolas, monospace", fontSize: "0.72rem", whiteSpace: "pre",
  };

  const appliedSummary = result && result.applied && result.applied.length
    ? result.applied.map(a => `${a.matches} match${a.matches === 1 ? "" : "es"} in ${FILE_SHORT[a.file] || a.file}`).join(" · ")
    : null;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9991, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "rgba(26,22,18,0.98)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "12px 0", width: "min(860px, 96vw)", maxHeight: "88vh", boxShadow: "0 12px 40px rgba(0,0,0,0.6)", color: "#f4f4f4", display: "flex", flexDirection: "column" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div>
            <span style={{ fontSize: "1.0rem", fontWeight: 600, color: "#e8c873" }}>What-If Sandbox</span>
            <span style={{ marginLeft: 10, fontSize: "0.72rem", color: "#9ab" }}>hypothetical EDB/EDU tweak · shadow copy · mod files untouched</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#bbb", fontSize: "1.1rem", cursor: "pointer" }}>✕</button>
        </div>

        {missingBridge && (
          <div style={{ margin: "10px 16px", padding: "8px 10px", borderRadius: 6, background: "rgba(220,90,70,0.10)", border: "1px solid rgba(220,90,70,0.45)", color: RED, fontSize: "0.78rem" }}>
            run-what-if IPC bridge missing from preload — feature not wired yet.
          </div>
        )}

        {/* Edit rows */}
        <div style={{ padding: "8px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", gap: 8, maxHeight: "34vh", overflow: "auto" }}>
          {edits.map((e, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <select value={e.file} onChange={ev => setEdit(i, { file: ev.target.value })}
                style={{ ...inputStyle, width: 210, flexShrink: 0 }}>
                {FILE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <textarea value={e.find} onChange={ev => setEdit(i, { find: ev.target.value })}
                placeholder="find (exact text, e.g. taxable_income_bonus bonus 2)"
                spellCheck={false} style={taStyle} />
              <textarea value={e.replace} onChange={ev => setEdit(i, { replace: ev.target.value })}
                placeholder="replace with"
                spellCheck={false} style={taStyle} />
              <button onClick={() => removeEdit(i)} disabled={edits.length === 1}
                title="remove this edit"
                style={{ ...btnStyle(false), padding: "3px 8px", opacity: edits.length === 1 ? 0.4 : 1 }}>−</button>
            </div>
          ))}
          <div>
            <button onClick={addEdit} style={btnStyle(false)}>+ add edit</button>
          </div>
        </div>

        {/* Run controls */}
        <div style={{ padding: "8px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.78rem", color: "#9ab" }}>threshold</span>
          <input value={threshold} onChange={e => setThreshold(e.target.value)}
            style={{ ...inputStyle, width: 52, textAlign: "right" }} />
          <span style={{ fontSize: "0.78rem", color: "#9ab" }}>%</span>
          <button onClick={doRun} disabled={busy || !modDataDir || missingBridge || !usableEdits.length}
            style={{ ...btnStyle(true), opacity: (busy || !modDataDir || !usableEdits.length) ? 0.5 : 1 }}>
            {busy ? `Running what-if… ${elapsed}s (two full economy passes)` : "Run what-if"}
          </button>
          <span style={{ fontSize: "0.72rem", color: "#c9a45a" }}>
            ⚠ model-only estimate — the game itself isn't run
          </span>
        </div>

        {error && (
          <div style={{ margin: "10px 16px 0", padding: "8px 10px", borderRadius: 6, background: "rgba(220,90,70,0.10)", border: "1px solid rgba(220,90,70,0.45)", color: RED, fontSize: "0.78rem" }}>
            <div style={{ fontWeight: 600 }}>{error}</div>
            {editErrors && editErrors.map((ee, i) => (
              <div key={i} style={{ marginTop: 4, fontFamily: "Consolas, monospace", fontSize: "0.7rem" }}>
                {FILE_SHORT[ee.file] || ee.file}: {ee.message}
              </div>
            ))}
          </div>
        )}

        {/* Results */}
        <div style={{ overflow: "auto", padding: "8px 16px 4px", flex: 1 }}>
          {result && (
            <>
              <div style={{ fontSize: "0.72rem", color: "#9ab", marginBottom: 6 }}>
                {appliedSummary && <span style={{ color: GREEN }}>{appliedSummary}</span>}
                {" · "}{result.factionsCompared} factions compared
                {" · "}{result.rows.length} change{result.rows.length === 1 ? "" : "s"} ≥ threshold
                {" · "}base {(result.baselineMs / 1000).toFixed(1)}s / shadow {(result.shadowMs / 1000).toFixed(1)}s
                {result.reused ? " · shadow reused" : ""}
                {result.snapshotErrors ? ` · ${result.snapshotErrors} faction errors skipped` : ""}
              </div>
              {(result.added.length > 0 || result.removed.length > 0) && (
                <div style={{ marginBottom: 8, padding: "6px 10px", borderRadius: 6, background: "rgba(232,200,115,0.07)", border: "1px solid rgba(232,200,115,0.3)", fontSize: "0.74rem" }}>
                  {result.added.length > 0 && <div>Factions only in what-if: <span style={{ color: GREEN }}>{result.added.join(", ")}</span></div>}
                  {result.removed.length > 0 && <div>Factions lost in what-if: <span style={{ color: RED }}>{result.removed.join(", ")}</span></div>}
                </div>
              )}
              {result.rows.length === 0 ? (
                <div style={{ padding: "14px 0", color: GREEN, fontSize: "0.82rem" }}>
                  No faction's turn-1 economy moved beyond the threshold under this tweak.
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.76rem" }}>
                  <thead>
                    <tr style={{ color: "#9ab", textAlign: "left" }}>
                      <th style={{ padding: "3px 6px" }}>Faction</th>
                      <th style={{ padding: "3px 6px" }}>Field</th>
                      <th style={{ padding: "3px 6px", textAlign: "right" }}>Current</th>
                      <th style={{ padding: "3px 6px", textAlign: "right" }}>What-if</th>
                      <th style={{ padding: "3px 6px", textAlign: "right" }}>Δ%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r, i) => (
                      <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                        <td style={{ padding: "3px 6px" }}>{r.faction.replace(/_/g, " ")}</td>
                        <td style={{ padding: "3px 6px", color: "#ccc" }}>{FIELD_LABEL[r.field] || r.field}</td>
                        <td style={{ padding: "3px 6px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(r.base)}</td>
                        <td style={{ padding: "3px 6px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(r.cur)}</td>
                        <td style={{ padding: "3px 6px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: deltaColor(r.field, r.deltaPct) }}>
                          {r.deltaPct > 0 ? "+" : ""}{r.deltaPct}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
          {!result && !error && (
            <div style={{ padding: "14px 0", color: "#9ab", fontSize: "0.78rem" }}>
              Paste an exact EDB/EDU text fragment to change (e.g. bump a
              taxable_income_bonus value), then Run — the tweak is applied in a
              temporary shadow copy and every faction's turn-1 economy is diffed
              against the current mod. Your mod files are never modified.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
