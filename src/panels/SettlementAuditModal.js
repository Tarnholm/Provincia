// Economy Audit modal, extracted from App.js (2026-07-15). Per-settlement
// tax · PO% · income · growth · governor-gap for the focused faction, computed
// read-only from save state passed in as props. Uses createPortal to escape
// stacking contexts, exactly as the inline block did. Behavior identical.
import React from "react";
import { createPortal } from "react-dom";

export default function SettlementAuditModal({
  selectedFaction, playerFaction, currentOwnerByCity, saveSettlementFields,
  regions, saveCharactersByRegion, factionDisplayNames, onClose,
}) {
  const focusFaction = selectedFaction || playerFaction || null;
  const owner = currentOwnerByCity || {};
  const sf = saveSettlementFields || {};
  // city → region (from the rgb region map) for the governor lookup.
  const cityToRegion = {};
  if (regions) for (const v of Object.values(regions)) { if (v && v.city && v.region) cityToRegion[v.city] = v.region; }
  // Regions holding a "family member" = a named v1 character that isn't an
  // agent and isn't a v2 captain stack. A settlement with none = "no family
  // member stationed" (a captain may still auto-govern it).
  const AGENT = new Set(["spy", "assassin", "diplomat", "merchant"]);
  const familyRegion = new Set();
  if (saveCharactersByRegion) for (const [reg, arr] of Object.entries(saveCharactersByRegion)) {
    if (Array.isArray(arr) && arr.some(c => c && c.firstName && !c._fromV2 && !AGENT.has(c.type))) familyRegion.add(reg);
  }
  const rows = [];
  for (const [city, f] of Object.entries(sf)) {
    const own = owner[city] || null;
    if (focusFaction && own !== focusFaction) continue;
    if (!focusFaction && !own) continue;
    const po = (f && typeof f.publicOrder === "number" && isFinite(f.publicOrder) && Math.abs(f.publicOrder) < 100000) ? Math.round(f.publicOrder) : null; // exact save PO (NOT 5-snapped)
    const inc = (f && typeof f.income === "number") ? f.income : null;
    const grow = (f && f.populationGrowth != null && f.committedPopulation) ? (f.populationGrowth / f.committedPopulation * 100) : null;
    const tax = (f && f.taxRate != null) ? f.taxRate : null;
    const reg = cityToRegion[city] || null;
    const hasGov = reg ? familyRegion.has(reg) : true;
    rows.push({ city, tax, po, inc, grow, hasGov });
  }
  rows.sort((a, b) => (a.city || "").localeCompare(b.city || ""));
  const TAXLABEL = ["low", "normal", "high", "v.high"];
  const focusLabel = (factionDisplayNames && focusFaction && factionDisplayNames[focusFaction]) || focusFaction || "—";
  const negGrowth = rows.filter(r => r.grow != null && r.grow < 0).length;
  const noGov = rows.filter(r => !r.hasGov).length;
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9990, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} className="popover-pop-in" style={{ background: "rgba(28,24,18,0.97)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "12px 0", width: "min(780px, 95vw)", maxHeight: "82vh", boxShadow: "0 12px 40px rgba(0,0,0,0.6)", color: "#f4f4f4", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <span style={{ fontWeight: 700, fontSize: "1rem", color: "#d9b35a" }}>📊 Economy Audit — {focusLabel}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#bbb", fontSize: "1.1rem", cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ padding: "6px 16px", fontSize: "0.74rem", color: "#9aa" }}>
          {rows.length} settlements · {negGrowth} with negative growth · {noGov} with no family governor.{" "}
          PO% and tax are live; income is the realised value (the per-turn projection lands after you end a turn); growth reads 0 on a fresh turn-1 save.
        </div>
        <div style={{ overflow: "auto", padding: "0 12px 8px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
            <thead><tr style={{ color: "#c7b07a", textAlign: "left" }}>
              <th style={{ padding: "3px 6px" }}>Settlement</th><th>Tax</th><th>PO%</th><th>Income</th><th>Growth</th><th>Governor</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.city} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <td style={{ padding: "3px 6px" }}>{r.city.replace(/_/g, " ")}</td>
                  <td style={{ color: "#cbb" }}>{r.tax != null ? TAXLABEL[r.tax] : "—"}</td>
                  <td style={{ color: r.po != null && r.po < 100 ? "#e89060" : "#9bd09b" }}>{r.po != null ? r.po : "—"}</td>
                  <td style={{ color: r.inc != null && r.inc < 0 ? "#e89060" : "#ddd" }}>{r.inc != null ? r.inc : "—"}</td>
                  <td style={{ color: r.grow != null && r.grow < 0 ? "#e87060" : "#bbb" }}>{r.grow != null ? r.grow.toFixed(1) + "%" : "—"}</td>
                  <td>{r.hasGov ? <span style={{ color: "#7fae5f" }}>✓</span> : <span style={{ color: "#e8b85a" }} title="No family member stationed in this settlement's region">⚠ none</span>}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} style={{ padding: "10px 6px", color: "#999", fontStyle: "italic" }}>No settlements for {focusLabel}. Load a save; click a faction on the map to focus it (otherwise it uses the detected player faction).</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>,
    document.body
  );
}
