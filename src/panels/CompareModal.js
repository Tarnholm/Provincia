// Compare-factions modal, extracted from App.js (2026-07-15). Pure
// presentational: computes each column's row from the faction data slices
// passed as props (start + live), degrading every lookup to "—" when a slice
// is absent. selection/setSelection own the three picked factions. Behavior
// identical to the inline IIFE it replaced.
import React from "react";

export default function CompareModal({
  factions,
  factionColors,
  factionRegionsMap,
  factionWealth,
  liveRegionsByFaction,
  liveArmiesByFaction,
  liveTreasuryByFaction,
  factionDisplayNames,
  aiPersonalityByFaction,
  liveLogActive,
  selection,
  setSelection,
  onClose,
}) {
  const allFactions = Array.isArray(factions) ? factions.slice().sort() : [];
  const fmt = (n) => n == null ? "—" : (typeof n === "number" ? n.toLocaleString() : n);
  const colorOf = (f) => {
    if (!f) return "#aaa";
    const lf = typeof f === "string" ? f.toLowerCase() : "";
    const c = factionColors && (factionColors[f] || factionColors[lf]);
    return Array.isArray(c) ? `rgb(${c[0]}, ${c[1]}, ${c[2]})` : "#aaa";
  };
  const rowFor = (f) => {
    if (!f || typeof f !== "string") return null;
    try {
      const lf = f.toLowerCase();
      const frm = factionRegionsMap || {};
      const fw = factionWealth || {};
      const liveRegions = liveRegionsByFaction ? (liveRegionsByFaction[lf] ?? null) : null;
      const liveArmies = liveArmiesByFaction ? (liveArmiesByFaction[lf] ?? null) : null;
      const startRegions = (Array.isArray(frm[f]) ? frm[f] : (Array.isArray(frm[lf]) ? frm[lf] : [])).length;
      const liveTreasury = liveTreasuryByFaction ? liveTreasuryByFaction[lf] : null;
      const startWealth = fw[f] != null ? fw[f] : (fw[lf] != null ? fw[lf] : null);
      const wealth = liveTreasury ? liveTreasury.treasury : startWealth;
      const display = (factionDisplayNames && factionDisplayNames[f]) || f.replace(/_/g, " ");
      const ai = aiPersonalityByFaction ? (aiPersonalityByFaction[lf] || null) : null;
      return {
        faction: f, display, color: colorOf(f), wealth, wealthIsLive: !!liveTreasury,
        startWealth, regions: liveRegions != null ? liveRegions : startRegions,
        startRegions, armies: liveArmies || 0, isLive: !!liveLogActive && liveRegions != null,
        ai: ai ? ai.replace(/^ai_/, "").replace(/_/g, " ") : null,
        regionNames: Array.isArray(frm[f]) ? frm[f] : (Array.isArray(frm[lf]) ? frm[lf] : []),
      };
    } catch (e) {
      console.warn("[compare] row failed for", f, e);
      return { faction: f, display: f, color: "#aaa", wealth: null, wealthIsLive: false, startWealth: null, regions: null, startRegions: 0, armies: 0, isLive: false, ai: null, regionNames: [], error: e.message };
    }
  };
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 10001, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#1e1e1e", color: "#e6e6e6", borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.10)", padding: 16,
        width: "min(880px, 92vw)", maxHeight: "86vh", overflow: "auto",
        boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
      }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <h3 style={{ margin: 0, flex: 1, fontSize: "1.05rem" }}>Compare factions</h3>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)",
            color: "#ccc", padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontSize: "0.78rem",
          }}>Close</button>
        </div>
        {allFactions.length === 0 && (
          <div style={{ padding: 12, color: "#aaa", fontStyle: "italic", textAlign: "center" }}>
            No factions loaded yet — pick a mod folder first (the Compare view reads from the same data as the rest of the app).
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {[0, 1, 2].map(idx => {
            const f = selection[idx];
            const row = rowFor(f);
            return (
              <div key={idx} style={{
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.10)",
                borderRadius: 6, padding: 10, fontSize: "0.78rem",
              }}>
                <select
                  value={f || ""}
                  onChange={(e) => setSelection(s => { const c = s.slice(); c[idx] = e.target.value || null; return c; })}
                  style={{
                    width: "100%", marginBottom: 8, background: "#2a2a2a", color: "#eee",
                    border: "1px solid rgba(255,255,255,0.15)", borderRadius: 4, padding: "4px 6px", fontSize: "0.78rem",
                  }}
                >
                  <option value="">— pick a faction —</option>
                  {allFactions.map(fn => (<option key={fn} value={fn}>{(factionDisplayNames && factionDisplayNames[fn]) || fn.replace(/_/g, " ")}</option>))}
                </select>
                {row ? (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <span style={{ width: 12, height: 12, borderRadius: 2, background: row.color, border: "1px solid rgba(0,0,0,0.4)", flexShrink: 0 }} />
                      <b style={{ flex: 1, textTransform: "capitalize" }}>{row.display}</b>
                    </div>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.74rem" }}>
                      <tbody>
                        <tr><td style={{ color: "#888", padding: "2px 0" }}>Wealth{row.wealthIsLive ? " (live)" : ""}</td><td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(row.wealth)}</td></tr>
                        {row.wealthIsLive && row.startWealth != null && (<tr><td style={{ color: "#888", padding: "2px 0" }}>— starting</td><td style={{ textAlign: "right", color: "#888", fontVariantNumeric: "tabular-nums" }}>{fmt(row.startWealth)}</td></tr>)}
                        <tr><td style={{ color: "#888", padding: "2px 0" }}>Regions{row.isLive ? " (live)" : ""}</td><td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(row.regions)}</td></tr>
                        {row.isLive && row.startRegions !== row.regions && (<tr><td style={{ color: "#888", padding: "2px 0" }}>— starting</td><td style={{ textAlign: "right", color: "#888", fontVariantNumeric: "tabular-nums" }}>{fmt(row.startRegions)}</td></tr>)}
                        {liveLogActive && (<tr><td style={{ color: "#888", padding: "2px 0" }}>Armies</td><td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(row.armies)}</td></tr>)}
                        {row.ai && (<tr><td style={{ color: "#888", padding: "2px 0" }}>AI</td><td style={{ textAlign: "right", textTransform: "capitalize" }}>{row.ai}</td></tr>)}
                      </tbody>
                    </table>
                    {row.regionNames.length > 0 && (
                      <details style={{ marginTop: 6 }}>
                        <summary style={{ cursor: "pointer", color: "#aaa", fontSize: "0.72rem" }}>Region list ({row.regionNames.length})</summary>
                        <div style={{ maxHeight: 200, overflowY: "auto", marginTop: 4, fontSize: "0.7rem", lineHeight: 1.5 }}>
                          {row.regionNames.map(r => <div key={r} style={{ color: "#bbb" }}>{r}</div>)}
                        </div>
                      </details>
                    )}
                  </div>
                ) : (
                  <div style={{ color: "#888", fontStyle: "italic", padding: "8px 0" }}>Pick a faction above.</div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 10, fontSize: "0.7rem", color: "#888" }}>
          Values marked <i>(live)</i> come from the loaded save; the rest are starting state from descr_strat.
        </div>
      </div>
    </div>
  );
}
