// Victory Progress panel — every faction's progress toward its win
// conditions (hold_regions / take_regions), sorted by completion %.
// Presentational: caller owns all state; computation is pure
// (src/victoryProgress.js). Styling mirrors ArmySetupModal's dark portal look.
import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { computeVictoryProgress } from "../victoryProgress.js";

export default function VictoryProgressPanel({
  victoryConditions,
  regions,
  currentOwnerByCity,
  initialOwnerByCity,
  factionDisplayNames,
  onClose,
}) {
  const [expanded, setExpanded] = useState(() => new Set()); // faction ids with missing-list open
  const [query, setQuery] = useState("");

  const rows = useMemo(
    () => computeVictoryProgress({ victoryConditions, regions, currentOwnerByCity, initialOwnerByCity }),
    [victoryConditions, regions, currentOwnerByCity, initialOwnerByCity]
  );

  const label = (id) =>
    (factionDisplayNames && id && factionDisplayNames[id]) || (id ? String(id).replace(/_/g, " ") : "—");

  const q = query.trim().toLowerCase();
  const visible = q
    ? rows.filter((r) => r.faction.replace(/_/g, " ").toLowerCase().includes(q) || label(r.faction).toLowerCase().includes(q))
    : rows;

  const toggle = (fac) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(fac)) next.delete(fac); else next.add(fac);
      return next;
    });

  const barColor = (pct) => (pct >= 100 ? "#8fb46e" : pct >= 60 ? "#e8c873" : pct >= 30 ? "#cf8f6a" : "#a06a5a");

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9991, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} className="popover-pop-in" style={{ background: "rgba(26,22,18,0.98)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "12px 0", width: "min(720px, 96vw)", maxHeight: "86vh", boxShadow: "0 12px 40px rgba(0,0,0,0.6)", color: "#f4f4f4", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <span style={{ fontWeight: 700, fontSize: "1rem", color: "#cf8f6a" }}>🏆 Victory Progress</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#bbb", fontSize: "1.1rem", cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ padding: "6px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: "0.74rem", color: "#9ab" }}>
            {visible.length} faction{visible.length === 1 ? "" : "s"} with victory conditions
            {currentOwnerByCity ? " · live-save ownership" : " · campaign-start ownership"}
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="filter factions…"
            style={{ marginLeft: "auto", width: 180, background: "rgba(255,255,255,0.07)", color: "#eee", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 6, padding: "3px 8px", fontSize: "0.78rem" }}
          />
        </div>

        <div style={{ overflow: "auto", padding: "8px 16px" }}>
          {visible.length === 0 && (
            <div style={{ padding: "16px 4px", color: "#9ab", fontSize: "0.82rem" }}>
              {rows.length === 0
                ? "No victory conditions loaded — import a campaign folder with descr_win_conditions.txt first."
                : "No faction matches the filter."}
            </div>
          )}
          {visible.map((r) => {
            const open = expanded.has(r.faction);
            const done = r.pct >= 100;
            return (
              <div key={r.faction} style={{ marginBottom: 8, borderRadius: 6, overflow: "hidden", border: "1px solid " + (done ? "rgba(143,180,110,0.4)" : "rgba(255,255,255,0.12)"), background: done ? "rgba(143,180,110,0.07)" : "rgba(255,255,255,0.03)" }}>
                <div
                  onClick={() => r.missing.length && toggle(r.faction)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", cursor: r.missing.length ? "pointer" : "default" }}
                >
                  <span style={{ width: 16, color: "#9ab", fontSize: "0.7rem", flexShrink: 0 }}>
                    {r.missing.length ? (open ? "▾" : "▸") : ""}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: "0.84rem", minWidth: 160, textTransform: "capitalize" }}>{label(r.faction)}</span>
                  <div style={{ flex: 1, height: 10, borderRadius: 5, background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)", overflow: "hidden" }}>
                    <div style={{ width: Math.max(0, Math.min(100, r.pct)) + "%", height: "100%", background: barColor(r.pct), transition: "width .2s" }} />
                  </div>
                  <span style={{ width: 88, textAlign: "right", fontSize: "0.78rem", color: done ? "#b8d38f" : "#e8c873", flexShrink: 0 }}>
                    {r.heldCount}/{r.requiredCount} · {Math.floor(r.pct)}%
                  </span>
                </div>
                <div style={{ padding: "0 10px 6px 36px", fontSize: "0.72rem", color: "#9ab" }}>
                  {r.conditionsText}
                  {r.takeRequired ? ` — owns ${r.ownedCount}` : ""}
                </div>
                {open && r.missing.length > 0 && (
                  <div style={{ margin: "0 10px 8px 36px", borderRadius: 5, background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.08)", padding: "6px 10px" }}>
                    <div style={{ fontSize: "0.7rem", color: "#cf8f6a", marginBottom: 4, fontWeight: 600 }}>
                      Missing ({r.missing.length})
                    </div>
                    {r.missing.map((m, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: "0.74rem", padding: "1px 0" }}>
                        <span style={{ color: "#ddd", textTransform: "capitalize" }}>
                          {String(m.region).replace(/_/g, " ")}
                          {m.city && m.city !== m.region ? <span style={{ color: "#889" }}> ({String(m.city).replace(/_/g, " ")})</span> : null}
                        </span>
                        <span style={{ color: m.unmatched ? "#a06a5a" : "#9ab", textTransform: "capitalize", textAlign: "right" }}>
                          {m.unmatched ? "not on map" : m.currentOwner ? "held by " + label(m.currentOwner) : "unowned"}
                        </span>
                      </div>
                    ))}
                  </div>
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
