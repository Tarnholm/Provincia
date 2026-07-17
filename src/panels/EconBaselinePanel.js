// Econ Baseline panel (2026-07-17) — capture a named turn-1 economy baseline
// for the loaded mod, then diff current mod files against it and surface
// factions whose economy moved beyond a threshold. Self-contained: owns its
// own state, talks to the main process via the econ-baseline IPC trio
// (see src/econBaselineHandlers.js). Style matches ArmySetupModal's dark look.
import React, { useEffect, useState } from "react";

// Which direction is "better" per field (mirror of econBaseline.js
// FIELD_DIRECTION — duplicated because that module is CJS/main-process).
const FIELD_DIRECTION = { settlements: 0, income: 1, upkeep: -1, net: 1 };
const FIELD_LABEL = { settlements: "Settlements", income: "Income", upkeep: "Army upkeep", net: "Net" };

const GREEN = "#9ed6ad", RED = "#e8a090", NEUTRAL = "#9ab";

function deltaColor(field, deltaPct) {
  const dir = FIELD_DIRECTION[field] || 0;
  if (!dir || !deltaPct) return NEUTRAL;
  return (deltaPct * dir > 0) ? GREEN : RED;
}

const fmt = (n) => (typeof n === "number" && Number.isFinite(n)) ? n.toLocaleString("en-US") : "—";

export default function EconBaselinePanel({ modDataDir, onClose }) {
  const [baselines, setBaselines] = useState([]);
  const [selected, setSelected] = useState("");
  const [captureName, setCaptureName] = useState("");
  const [threshold, setThreshold] = useState("10");
  const [busy, setBusy] = useState(null);        // null | "capture" | "diff" | "list"
  const [error, setError] = useState(null);
  const [captureInfo, setCaptureInfo] = useState(null);
  const [diff, setDiff] = useState(null);

  const api = (typeof window !== "undefined" && window.electronAPI) || {};
  const missingBridge = !api.econBaselineList || !api.econBaselineCapture || !api.econBaselineDiff;

  const refreshList = async (selectName) => {
    if (!api.econBaselineList) return;
    setBusy("list");
    try {
      const r = await api.econBaselineList();
      if (r && r.error) { setError(r.error); return; }
      const list = Array.isArray(r) ? r : [];
      setBaselines(list);
      const want = selectName || selected;
      if (want && list.some(b => b.name === want)) setSelected(want);
      else if (!want && list.length) setSelected(list[0].name);
    } catch (e) { setError(e?.message || String(e)); }
    finally { setBusy(null); }
  };

  useEffect(() => { refreshList(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const doCapture = async () => {
    if (busy || !modDataDir || !api.econBaselineCapture) return;
    setBusy("capture"); setError(null); setCaptureInfo(null);
    try {
      const r = await api.econBaselineCapture(modDataDir, captureName.trim() || "baseline");
      if (r && r.error) setError(r.error);
      else { setCaptureInfo(r); setCaptureName(""); await refreshList(r && r.name); }
    } catch (e) { setError(e?.message || String(e)); }
    finally { setBusy(b => (b === "capture" ? null : b)); }
  };

  const doDiff = async () => {
    if (busy || !modDataDir || !selected || !api.econBaselineDiff) return;
    const th = Math.max(0, parseFloat(threshold) || 10);
    setBusy("diff"); setError(null); setDiff(null);
    try {
      const r = await api.econBaselineDiff(modDataDir, selected, th);
      if (r && r.error) setError(r.error);
      else setDiff(r);
    } catch (e) { setError(e?.message || String(e)); }
    finally { setBusy(b => (b === "diff" ? null : b)); }
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

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9991, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "rgba(26,22,18,0.98)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "12px 0", width: "min(760px, 96vw)", maxHeight: "86vh", boxShadow: "0 12px 40px rgba(0,0,0,0.6)", color: "#f4f4f4", display: "flex", flexDirection: "column" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div>
            <span style={{ fontSize: "1.0rem", fontWeight: 600, color: "#e8c873" }}>Economy Baseline</span>
            <span style={{ marginLeft: 10, fontSize: "0.72rem", color: "#9ab" }}>turn-1 model · normal taxes · no save</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#bbb", fontSize: "1.1rem", cursor: "pointer" }}>✕</button>
        </div>

        {missingBridge && (
          <div style={{ margin: "10px 16px", padding: "8px 10px", borderRadius: 6, background: "rgba(220,90,70,0.10)", border: "1px solid rgba(220,90,70,0.45)", color: RED, fontSize: "0.78rem" }}>
            econ-baseline IPC bridge missing from preload — feature not wired yet.
          </div>
        )}

        {/* Capture row */}
        <div style={{ padding: "8px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <input value={captureName} onChange={e => setCaptureName(e.target.value)}
            placeholder="baseline name (e.g. pre-EDB-pass)"
            onKeyDown={e => { if (e.key === "Enter") doCapture(); }}
            style={{ ...inputStyle, width: 220 }} />
          <button onClick={doCapture} disabled={!!busy || !modDataDir || missingBridge}
            style={{ ...btnStyle(true), opacity: (busy || !modDataDir) ? 0.5 : 1 }}>
            {busy === "capture" ? "Capturing… (may take a minute)" : "Capture baseline"}
          </button>
          {captureInfo && (
            <span style={{ fontSize: "0.72rem", color: GREEN }}>
              saved “{captureInfo.name}” — {captureInfo.factions} factions{captureInfo.errors ? `, ${captureInfo.errors} errors` : ""}
            </span>
          )}
        </div>

        {/* Diff controls */}
        <div style={{ padding: "8px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.78rem", color: "#9ab" }}>Diff vs</span>
          <select value={selected} onChange={e => setSelected(e.target.value)}
            style={{ ...inputStyle, minWidth: 180 }}>
            {!baselines.length && <option value="">— no baselines yet —</option>}
            {baselines.map(b => (
              <option key={b.name} value={b.name}>
                {b.name}{b.at ? ` (${String(b.at).slice(0, 10)}, ${b.factions} fac)` : ""}
              </option>
            ))}
          </select>
          <span style={{ fontSize: "0.78rem", color: "#9ab" }}>threshold</span>
          <input value={threshold} onChange={e => setThreshold(e.target.value)}
            style={{ ...inputStyle, width: 52, textAlign: "right" }} />
          <span style={{ fontSize: "0.78rem", color: "#9ab" }}>%</span>
          <button onClick={doDiff} disabled={!!busy || !selected || !modDataDir || missingBridge}
            style={{ ...btnStyle(true), opacity: (busy || !selected) ? 0.5 : 1 }}>
            {busy === "diff" ? "Diffing… (recomputing all factions)" : "Run diff"}
          </button>
        </div>

        {error && (
          <div style={{ margin: "10px 16px 0", padding: "8px 10px", borderRadius: 6, background: "rgba(220,90,70,0.10)", border: "1px solid rgba(220,90,70,0.45)", color: RED, fontSize: "0.78rem" }}>
            {error}
          </div>
        )}

        {/* Results */}
        <div style={{ overflow: "auto", padding: "8px 16px 4px", flex: 1 }}>
          {diff && (
            <>
              <div style={{ fontSize: "0.72rem", color: "#9ab", marginBottom: 6 }}>
                baseline captured {diff.baselineAt ? String(diff.baselineAt).replace("T", " ").slice(0, 16) : "—"}
                {" · "}{diff.factionsCompared} factions compared
                {" · "}{diff.rows.length} change{diff.rows.length === 1 ? "" : "s"} ≥ threshold
              </div>
              {(diff.added.length > 0 || diff.removed.length > 0) && (
                <div style={{ marginBottom: 8, padding: "6px 10px", borderRadius: 6, background: "rgba(232,200,115,0.07)", border: "1px solid rgba(232,200,115,0.3)", fontSize: "0.74rem" }}>
                  {diff.added.length > 0 && <div>Added factions: <span style={{ color: GREEN }}>{diff.added.join(", ")}</span></div>}
                  {diff.removed.length > 0 && <div>Removed factions: <span style={{ color: RED }}>{diff.removed.join(", ")}</span></div>}
                </div>
              )}
              {diff.rows.length === 0 ? (
                <div style={{ padding: "14px 0", color: GREEN, fontSize: "0.82rem" }}>
                  No faction moved beyond the threshold — economy matches the baseline.
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.76rem" }}>
                  <thead>
                    <tr style={{ color: "#9ab", textAlign: "left" }}>
                      <th style={{ padding: "3px 6px" }}>Faction</th>
                      <th style={{ padding: "3px 6px" }}>Field</th>
                      <th style={{ padding: "3px 6px", textAlign: "right" }}>Baseline</th>
                      <th style={{ padding: "3px 6px", textAlign: "right" }}>Current</th>
                      <th style={{ padding: "3px 6px", textAlign: "right" }}>Δ%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.rows.map((r, i) => (
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
          {!diff && !error && (
            <div style={{ padding: "14px 0", color: "#9ab", fontSize: "0.78rem" }}>
              Capture a baseline before an editing session, then run the diff after
              EDB / EDU / descr_strat changes to see which factions' turn-1 economy moved.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
