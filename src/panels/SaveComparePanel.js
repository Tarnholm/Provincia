// Save-to-save Compare panel. Pick an earlier and a later save, crack both via
// the compare-saves IPC (src/saveCompareHandlers.js → saveCompareWorker), and
// report what changed: settlement ownership flips, per-faction settlement/
// treasury/unit deltas, and the biggest per-settlement population swings.
// Presentational conventions match src/panels/ArmySetupModal.js (portal overlay,
// dark inline styles). Self-contained state: only { modDataDir, onClose } props.
import React, { useState } from "react";
import { createPortal } from "react-dom";

const fmt = (n) => (n == null ? "—" : n.toLocaleString("en-US"));
const fmtDelta = (n) => (n == null ? "—" : (n > 0 ? "+" : "") + n.toLocaleString("en-US"));
const deltaColor = (n) => (n == null || n === 0 ? "#9ab" : n > 0 ? "#9ed6ad" : "#e8a090");
const facLabel = (f) => (f ? f.replace(/_/g, " ") : "—");

const thStyle = { textAlign: "left", padding: "3px 8px", color: "#c8b88a", fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.14)", position: "sticky", top: 0, background: "rgba(26,22,18,0.98)" };
const tdStyle = { padding: "2px 8px", borderBottom: "1px solid rgba(255,255,255,0.05)" };
const numTd = { ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" };

export default function SaveComparePanel({ modDataDir, onClose }) {
  const [saveA, setSaveA] = useState(null); // { file, path } — the earlier save
  const [saveB, setSaveB] = useState(null); // the later save
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const pick = async (which) => {
    // No saveDir arg on purpose: the user may compare saves from anywhere, and
    // passing a dir makes the handler reject picks outside it.
    const r = await window.electronAPI?.selectSaveFile?.();
    if (!r || r.error || !r.path) return; // canceled (or outside-dir error — can't happen with no dir)
    const picked = { file: r.file || r.path.split(/[\\/]/).pop(), path: r.path };
    if (which === "a") setSaveA(picked); else setSaveB(picked);
    setResult(null); setError(null);
  };

  const compare = async () => {
    if (!saveA || !saveB || busy) return;
    if (!window.electronAPI?.compareSaves) {
      setError("compare-saves IPC unavailable (preload bridge missing compareSaves?)");
      return;
    }
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await window.electronAPI.compareSaves(modDataDir, saveA.path, saveB.path);
      if (!r) setError("compare-saves returned no result");
      else if (r.error) setError(r.error);
      else setResult(r);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickBtn = (which, picked) => (
    <button onClick={() => pick(which)} disabled={busy}
      style={{ background: picked ? "rgba(143,180,110,0.25)" : "rgba(60,60,60,0.7)",
        color: picked ? "#b8d38f" : "#e8c873",
        border: "1px solid " + (picked ? "#7a9a5a" : "#a08a4a"),
        borderRadius: 5, padding: "3px 10px", cursor: busy ? "default" : "pointer", fontSize: "0.76rem",
        maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      title={picked ? picked.path : undefined}>
      {picked ? picked.file : (which === "a" ? "Pick earlier save…" : "Pick later save…")}
    </button>
  );

  const sectionHead = (label, extra) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "12px 0 4px", color: "#e8c873", fontSize: "0.82rem", fontWeight: 600 }}>
      {label}
      {extra ? <span style={{ color: "#9ab", fontWeight: 400, fontSize: "0.72rem" }}>{extra}</span> : null}
    </div>
  );

  const m = result?.meta;
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9991, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} className="popover-pop-in"
        style={{ background: "rgba(26,22,18,0.98)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "12px 0", width: "min(760px, 96vw)", maxHeight: "86vh", boxShadow: "0 12px 40px rgba(0,0,0,0.6)", color: "#f4f4f4", display: "flex", flexDirection: "column" }}>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px 8px", borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
          <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#e8c873" }}>Compare saves</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#bbb", fontSize: "1.1rem", cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", flexWrap: "wrap" }}>
          {pickBtn("a", saveA)}
          <span style={{ color: "#9ab", fontSize: "0.8rem" }}>→</span>
          {pickBtn("b", saveB)}
          <button onClick={compare} disabled={!saveA || !saveB || busy}
            style={{ marginLeft: "auto", background: (!saveA || !saveB || busy) ? "rgba(60,60,60,0.5)" : "rgba(232,200,115,0.18)",
              color: (!saveA || !saveB || busy) ? "#777" : "#e8c873",
              border: "1px solid " + ((!saveA || !saveB || busy) ? "rgba(255,255,255,0.15)" : "#a08a4a"),
              borderRadius: 5, padding: "3px 14px", cursor: (!saveA || !saveB || busy) ? "default" : "pointer", fontSize: "0.78rem", fontWeight: 600 }}>
            {busy ? "Comparing… (reads both saves, ~10s)" : "Compare"}
          </button>
        </div>

        {error && (
          <div style={{ margin: "0 14px 8px", padding: "8px 10px", borderRadius: 6, background: "rgba(220,90,70,0.10)", border: "1px solid rgba(220,90,70,0.45)", color: "#e8a090", fontSize: "0.78rem" }}>
            {error}
          </div>
        )}

        <div style={{ overflow: "auto", padding: "0 14px 10px", fontSize: "0.78rem" }}>
          {!result && !error && !busy && (
            <div style={{ color: "#9ab", padding: "14px 0" }}>
              Pick two saves from the same campaign — the earlier one on the left — then Compare.
            </div>
          )}

          {result && (
            <>
              <div style={{ padding: "6px 10px", borderRadius: 6, background: "rgba(232,200,115,0.07)", border: "1px solid rgba(232,200,115,0.3)", marginTop: 4 }}>
                <span style={{ color: "#c8b88a" }}>{m.a.turnLabel || m.a.file || "save A"}</span>
                <span style={{ color: "#9ab" }}> → </span>
                <span style={{ color: "#c8b88a" }}>{m.b.turnLabel || m.b.file || "save B"}</span>
                {m.identical && <span style={{ color: "#9ed6ad", marginLeft: 10 }}>No differences found — the saves are effectively identical.</span>}
                {m.orderSuspect && (
                  <div style={{ color: "#e8c873", marginTop: 4 }}>
                    ⚠ The "earlier" save is at a later turn than the "later" one — deltas below are reversed. Consider swapping the picks.
                  </div>
                )}
              </div>

              {sectionHead("Ownership flips", result.flips.length + " settlement" + (result.flips.length === 1 ? "" : "s") + " changed hands")}
              {result.flips.length === 0 ? (
                <div style={{ color: "#9ab" }}>No settlements changed owner.</div>
              ) : (
                <div style={{ maxHeight: 200, overflow: "auto", background: "rgba(0,0,0,0.3)", borderRadius: 6 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr>
                      <th style={thStyle}>Settlement</th><th style={thStyle}>From</th><th style={thStyle}>To</th>
                    </tr></thead>
                    <tbody>
                      {result.flips.map((f) => (
                        <tr key={f.settlement}>
                          <td style={tdStyle}>{f.settlement}</td>
                          <td style={{ ...tdStyle, color: "#e8a090" }}>{facLabel(f.from)}</td>
                          <td style={{ ...tdStyle, color: "#9ed6ad" }}>{facLabel(f.to)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {sectionHead("Faction deltas", result.factionRows.length + " faction" + (result.factionRows.length === 1 ? "" : "s") + " changed · treasuries are approximate on some saves")}
              {result.factionRows.length === 0 ? (
                <div style={{ color: "#9ab" }}>No faction-level changes.</div>
              ) : (
                <div style={{ maxHeight: 260, overflow: "auto", background: "rgba(0,0,0,0.3)", borderRadius: 6 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr>
                      <th style={thStyle}>Faction</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>Settlements</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>Δ</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>Treasury Δ</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>Units Δ</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>Soldiers Δ</th>
                    </tr></thead>
                    <tbody>
                      {result.factionRows.map((r) => (
                        <tr key={r.faction}>
                          <td style={tdStyle}>
                            {facLabel(r.faction)}
                            {r.appeared && <span style={{ color: "#9ed6ad", marginLeft: 6, fontSize: "0.68rem" }}>appeared</span>}
                            {r.disappeared && <span style={{ color: "#e8a090", marginLeft: 6, fontSize: "0.68rem" }}>wiped out</span>}
                          </td>
                          <td style={numTd}>{fmt(r.settlementsFrom)} → {fmt(r.settlementsTo)}</td>
                          <td style={{ ...numTd, color: deltaColor(r.settlementsDelta) }}>{fmtDelta(r.settlementsDelta)}</td>
                          <td style={{ ...numTd, color: deltaColor(r.treasuryDelta) }}>{fmtDelta(r.treasuryDelta)}</td>
                          <td style={{ ...numTd, color: deltaColor(r.unitsDelta) }}>{fmtDelta(r.unitsDelta)}</td>
                          <td style={{ ...numTd, color: deltaColor(r.soldiersDelta) }}>{fmtDelta(r.soldiersDelta)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {sectionHead("Population",
                result.meta.popRowsTruncated
                  ? "top " + result.popRows.length + " of " + result.meta.popChangedTotal + " changed settlements by |Δ|"
                  : result.popRows.length + " settlement" + (result.popRows.length === 1 ? "" : "s") + " changed")}
              {result.popRows.length === 0 ? (
                <div style={{ color: "#9ab" }}>No population changes decoded.</div>
              ) : (
                <div style={{ maxHeight: 260, overflow: "auto", background: "rgba(0,0,0,0.3)", borderRadius: 6 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr>
                      <th style={thStyle}>Settlement</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>From</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>To</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>Δ</th>
                    </tr></thead>
                    <tbody>
                      {result.popRows.map((r) => (
                        <tr key={r.settlement}>
                          <td style={tdStyle}>{r.settlement}</td>
                          <td style={numTd}>{fmt(r.from)}</td>
                          <td style={numTd}>{fmt(r.to)}</td>
                          <td style={{ ...numTd, color: deltaColor(r.delta) }}>{fmtDelta(r.delta)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
