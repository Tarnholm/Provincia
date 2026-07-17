// Mod Lint panel (2026-07-17). Runs the parse-time mod consistency checks
// (lint-mod IPC → src/modLint.js) and shows the findings grouped by severity:
// fatal (red — crashes the game at startup, e.g. "unrecognised resource
// class"), error (orange — broken content: unknown units in descr_strat / EDB
// recruit lines), warn (yellow — dead conditions and unknown building_present
// targets). Presentational + self-contained: owns its own run state, the
// caller passes { modDataDir, onClose }. Dark inline-style look matches
// ArmySetupModal.
import React, { useState } from "react";
import { createPortal } from "react-dom";

const SEV_ORDER = ["fatal", "error", "warn"];
const SEV_STYLE = {
  fatal: { color: "#e88a8a", border: "rgba(232,112,112,0.45)", bg: "rgba(232,112,112,0.08)", label: "Fatal — crashes the game at startup" },
  error: { color: "#e8b070", border: "rgba(232,160,80,0.45)", bg: "rgba(232,160,80,0.07)", label: "Error — broken content in-game" },
  warn: { color: "#e8c873", border: "rgba(232,200,115,0.4)", bg: "rgba(232,200,115,0.06)", label: "Warning — dead or suspicious conditions" },
};

export default function ModLintPanel({ modDataDir, onClose }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { warnings, counts, ms } | { error }
  const [collapsed, setCollapsed] = useState({}); // severity -> bool

  const run = async () => {
    if (busy) return;
    if (!modDataDir) { setResult({ error: "No mod data directory loaded — load a mod first." }); return; }
    const ipc = window.electronAPI && window.electronAPI.lintMod;
    if (!ipc) { setResult({ error: "lintMod IPC unavailable (preload bridge missing?)" }); return; }
    setBusy(true); setResult(null);
    try {
      const r = await ipc(modDataDir);
      setResult(r || { error: "lint-mod returned no result" });
    } catch (e) {
      setResult({ error: (e && e.message) || String(e) });
    } finally { setBusy(false); }
  };

  const counts = (result && result.counts) || null;
  const bySev = {};
  if (result && Array.isArray(result.warnings)) {
    for (const w of result.warnings) (bySev[w.severity] = bySev[w.severity] || []).push(w);
  }

  return createPortal(
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "min(880px, 94vw)", maxHeight: "88vh", display: "flex", flexDirection: "column", background: "#1d2026", color: "#dde", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, boxShadow: "0 12px 40px rgba(0,0,0,0.6)", overflow: "hidden" }}>

        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)" }}>
          <div style={{ fontWeight: 700, color: "#e8c873", fontSize: "0.95rem" }}>Mod lint — parse-time consistency checks</div>
          <div style={{ color: "#889", fontSize: "0.72rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }} title={modDataDir || ""}>{modDataDir || "no mod loaded"}</div>
          <button onClick={run} disabled={busy || !modDataDir}
            title="Cross-check EDB resource tokens, descr_strat/EDB unit names, and building_present targets against the mod's own declarations."
            style={{ background: busy ? "rgba(60,60,60,0.7)" : "rgba(143,180,110,0.25)", color: busy ? "#9ab" : "#b8d38f", border: "1px solid " + (busy ? "rgba(255,255,255,0.25)" : "#7a9a5a"), borderRadius: 5, padding: "3px 12px", cursor: busy ? "default" : "pointer", fontSize: "0.78rem" }}>
            {busy ? "Linting…" : "Run lint"}
          </button>
          <button onClick={onClose} style={{ background: "none", border: "1px solid rgba(255,255,255,0.25)", color: "#9ab", borderRadius: 5, padding: "3px 10px", cursor: "pointer", fontSize: "0.78rem" }}>Close</button>
        </div>

        {/* counts summary */}
        {counts && (
          <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 16px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
            {SEV_ORDER.map((sev) => (
              <span key={sev} style={{ color: SEV_STYLE[sev].color, border: "1px solid " + SEV_STYLE[sev].border, background: SEV_STYLE[sev].bg, borderRadius: 5, padding: "2px 10px", fontSize: "0.76rem", fontWeight: 700 }}>
                {sev}: {counts[sev] || 0}
              </span>
            ))}
            <span style={{ color: "#889", fontSize: "0.72rem", marginLeft: "auto" }}>
              {result.warnings.length} finding{result.warnings.length === 1 ? "" : "s"} · {result.ms} ms
            </span>
          </div>
        )}

        {/* body */}
        <div style={{ overflow: "auto", padding: "10px 16px 16px" }}>
          {!result && !busy && (
            <div style={{ color: "#889", fontSize: "0.8rem", padding: "18px 4px" }}>
              Run lint to cross-check the mod files for the mistakes that show up in-game as cryptic failures:
              undeclared resource classes (startup crash), units named in descr_strat or EDB recruit lines that do not
              exist in the EDU, building_present conditions pointing at chains or levels the EDB never defines, and
              hidden_resource conditions that can never be true anywhere.
            </div>
          )}
          {busy && <div style={{ color: "#9ab", fontSize: "0.8rem", padding: "18px 4px" }}>Parsing mod files…</div>}
          {result && result.error && (
            <div style={{ color: "#e8a090", fontSize: "0.8rem", padding: "12px 4px" }}>{String(result.error)}</div>
          )}
          {counts && result.warnings.length === 0 && (
            <div style={{ color: "#b8d38f", fontSize: "0.85rem", padding: "18px 4px" }}>Clean — no consistency problems found.</div>
          )}

          {SEV_ORDER.map((sev) => {
            const rows = bySev[sev];
            if (!rows || !rows.length) return null;
            const st = SEV_STYLE[sev];
            const hidden = !!collapsed[sev];
            return (
              <div key={sev} style={{ marginTop: 10, border: "1px solid " + st.border, background: st.bg, borderRadius: 6 }}>
                <div onClick={() => setCollapsed((c) => ({ ...c, [sev]: !c[sev] }))}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", cursor: "pointer", userSelect: "none" }}>
                  <span style={{ color: st.color, fontWeight: 700, fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>{sev}</span>
                  <span style={{ color: "#9ab", fontSize: "0.74rem" }}>{st.label}</span>
                  <span style={{ color: st.color, fontSize: "0.74rem", marginLeft: "auto" }}>{rows.length}{hidden ? " (click to expand)" : ""}</span>
                </div>
                {!hidden && (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.74rem" }}>
                    <thead>
                      <tr style={{ color: "#8aa", textAlign: "left" }}>
                        <th style={{ padding: "2px 10px", width: 150 }}>Check</th>
                        <th style={{ padding: "2px 6px", width: 210 }}>File</th>
                        <th style={{ padding: "2px 6px" }}>Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((w, i) => (
                        <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.06)", verticalAlign: "top" }}>
                          <td style={{ padding: "3px 10px", color: st.color, whiteSpace: "nowrap" }}>{w.check}</td>
                          <td style={{ padding: "3px 6px", color: "#9ab", wordBreak: "break-all" }}>{w.file}</td>
                          <td style={{ padding: "3px 6px", color: "#cdd" }}>{w.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}
