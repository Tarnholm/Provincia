// Submod Drift panel (2026-07-17). RTW:R submod folders override same-relative-
// path files in the base mod; a STALE override silently shadows base-mod updates
// (the expanded_bi.txt incident: old submod copy lacked new string tokens →
// "Could not find string 'mine_from_coal_ga' in expanded string table!").
// Pick a submod folder → scan-submod-drift compares every override against the
// loaded base mod (modDataDir): danger files first with their in-game symptom,
// stale overrides highlighted, byte-identical ones dimmed as harmless.
// Presentational + self-contained state; styling matches ArmySetupModal's dark
// inline-style aesthetic (no external CSS).
import React, { useState } from "react";
import { createPortal } from "react-dom";

const fmtTime = (ms) => {
  if (typeof ms !== "number" || !isFinite(ms)) return "—";
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export default function SubmodDriftPanel({ modDataDir, onClose }) {
  const [submodDir, setSubmodDir] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const runScan = async (dir) => {
    if (!dir || !modDataDir) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await window.electronAPI.scanSubmodDrift(modDataDir, dir);
      if (r && r.error) setError(r.error);
      else setResult(r || { overrides: [], summary: {} });
    } catch (e) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  const pickSubmod = async () => {
    try {
      const dir = await window.electronAPI.selectSubmodFolder();
      if (!dir) return;
      setSubmodDir(dir);
      runScan(dir);
    } catch (e) { setError(e?.message || String(e)); }
  };

  const s = result && result.summary;
  const rowStyle = (o) => {
    // stale = red-ish (danger) / orange (plain stale); identical dimmed; rest neutral
    if (o.stale && o.danger) return { background: "rgba(220,90,70,0.16)", color: "#f0a0a0" };
    if (o.stale) return { background: "rgba(207,143,106,0.14)", color: "#e8b890" };
    if (o.sameContent) return { opacity: 0.45, color: "#aaa" };
    return { color: "#ddd" };
  };
  const statusOf = (o) => {
    if (o.sameContent) return "identical — harmless";
    if (o.stale) return "STALE — older than base, content differs";
    if (o.submodMtime >= o.baseMtime) return "differs (newer than base — deliberate override?)";
    return "differs";
  };

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9991, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "rgba(26,22,18,0.98)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "12px 0", width: "min(900px, 96vw)", maxHeight: "86vh", boxShadow: "0 12px 40px rgba(0,0,0,0.6)", color: "#f4f4f4", display: "flex", flexDirection: "column" }}>

        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
          <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#e8c873" }}>Submod Drift Checker</span>
          <span style={{ fontSize: "0.72rem", color: "#9ab" }}>base: {modDataDir || "(no mod loaded)"}</span>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", color: "#bbb", fontSize: "1.1rem", cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px" }}>
          <button onClick={pickSubmod} disabled={busy || !modDataDir}
            style={{ background: "rgba(60,60,60,0.7)", color: "#e8c873", border: "1px solid #a08a4a", borderRadius: 5, padding: "3px 12px", cursor: busy ? "default" : "pointer", fontSize: "0.78rem" }}>
            {submodDir ? "Pick another submod folder…" : "Pick submod folder…"}
          </button>
          {submodDir && <span style={{ fontSize: "0.74rem", color: "#b8d38f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{submodDir}</span>}
          {submodDir && !busy && <button onClick={() => runScan(submodDir)}
            style={{ background: "none", border: "1px solid rgba(255,255,255,0.2)", color: "#9aa", borderRadius: 5, padding: "2px 8px", cursor: "pointer", fontSize: "0.72rem" }}>rescan</button>}
        </div>

        {busy && <div style={{ padding: "6px 16px", fontSize: "0.8rem", color: "#9ab" }}>Scanning…</div>}
        {error && <div style={{ margin: "0 16px 10px", padding: "8px 10px", borderRadius: 6, background: "rgba(220,90,70,0.10)", border: "1px solid rgba(220,90,70,0.45)", color: "#e8a090", fontSize: "0.78rem" }}>{error}</div>}

        {s && (
          <div style={{ padding: "0 16px 8px", fontSize: "0.76rem", color: "#ccc" }}>
            {s.overrides} override{s.overrides === 1 ? "" : "s"} of {s.submodFiles} submod file{s.submodFiles === 1 ? "" : "s"} —{" "}
            <span style={{ color: s.dangerStale ? "#f0a0a0" : "#9ab" }}>{s.dangerStale} stale danger</span>,{" "}
            <span style={{ color: s.stale ? "#e8b890" : "#9ab" }}>{s.stale} stale</span>,{" "}
            {s.differing} differing, <span style={{ opacity: 0.6 }}>{s.identical} identical</span>
            {s.stale === 0 && s.overrides > 0 && <span style={{ color: "#9ed6ad" }}> — no drift detected</span>}
          </div>
        )}

        {result && (
          <div style={{ overflow: "auto", margin: "0 16px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.3)" }}>
            {!result.overrides.length && <div style={{ padding: "10px 12px", fontSize: "0.8rem", color: "#9ab" }}>No overrides — no submod file shadows a base-mod file.</div>}
            {result.overrides.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.76rem" }}>
                <thead>
                  <tr style={{ color: "#e8c873", textAlign: "left", background: "rgba(255,255,255,0.06)" }}>
                    <th style={{ padding: "5px 10px", fontWeight: 600 }}>Override file</th>
                    <th style={{ padding: "5px 10px", fontWeight: 600 }}>Base</th>
                    <th style={{ padding: "5px 10px", fontWeight: 600 }}>Submod</th>
                    <th style={{ padding: "5px 10px", fontWeight: 600 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.overrides.map((o) => (
                    <tr key={o.rel} style={{ ...rowStyle(o), borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                      <td style={{ padding: "5px 10px", fontFamily: "monospace", verticalAlign: "top" }}>
                        {o.rel}
                        {o.danger && (
                          <div style={{ marginTop: 3, fontFamily: "inherit", fontSize: "0.72rem", color: o.stale ? "#f0b0a0" : "#d8b070", maxWidth: 420 }}>
                            ⚠ {o.danger}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "5px 10px", whiteSpace: "nowrap", verticalAlign: "top" }}>{fmtTime(o.baseMtime)}</td>
                      <td style={{ padding: "5px 10px", whiteSpace: "nowrap", verticalAlign: "top" }}>{fmtTime(o.submodMtime)}</td>
                      <td style={{ padding: "5px 10px", verticalAlign: "top", fontWeight: o.stale ? 700 : 400 }}>{statusOf(o)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {result && result.errors && result.errors.length > 0 && (
          <div style={{ margin: "0 16px 8px", fontSize: "0.72rem", color: "#c9a" }}>
            {result.errors.length} file(s) could not be read: {result.errors.slice(0, 3).map(e => e.rel).join(", ")}{result.errors.length > 3 ? "…" : ""}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
