// Mercenary Pool Browser (🪙, 2026-07-24) — every pool from
// descr_mercenaries.txt with its units (exp/cost/replenish/max/initial,
// faction restrictions) and regions. Search across pool / unit / region
// names; click a pool's "map" button to highlight its regions on the map;
// click a unit row to open its unit card; click a region chip to highlight
// (double-click jumps). Data comes from the same get-mercenary-pools IPC the
// Mercenaries map mode uses — the panel only renders what the caller passes.
// Styling matches the other Tools panels (dark portal modal).
import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";

export default function MercPoolsPanel({
  mercData,          // { pools: [{name, regions, units}], byRegion } | null while loading
  regions,           // rgbKey → { region, ... } (for region → map highlight)
  onHighlightRegions, // (rgbKeys, jump) => void
  onOpenUnit,        // (unitName) => void — opens the unit card popup
  onClose,
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(() => new Set());

  const pools = (mercData && mercData.pools) || [];
  const keyByRegion = useMemo(() => {
    const m = {};
    for (const [rgb, r] of Object.entries(regions || {})) {
      if (r && r.region) m[String(r.region).toLowerCase()] = rgb;
    }
    return m;
  }, [regions]);

  const q = query.trim().toLowerCase();
  const visible = q
    ? pools.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        (p.units || []).some((u) => u.name.toLowerCase().includes(q)) ||
        (p.regions || []).some((r) => r.toLowerCase().includes(q)))
    : pools;

  const toggle = (name) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });

  const keysOf = (pool) => (pool.regions || [])
    .map((r) => keyByRegion[String(r).toLowerCase()]).filter(Boolean);

  const unitCount = pools.reduce((a, p) => a + (p.units || []).length, 0);
  const th = { textAlign: "left", color: "#9a8f7a", fontWeight: 600, padding: "2px 6px", whiteSpace: "nowrap" };
  const td = { padding: "2px 6px", whiteSpace: "nowrap" };

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9991, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} className="popover-pop-in" style={{ background: "rgba(26,22,18,0.98)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "12px 0", width: "min(760px, 96vw)", maxHeight: "86vh", boxShadow: "0 12px 40px rgba(0,0,0,0.6)", color: "#f4f4f4", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <span style={{ fontWeight: 700, fontSize: "1rem", color: "#d9c964" }}>🪙 Mercenary Pools</span>
          <span style={{ fontSize: "0.72rem", color: "#888" }}>{pools.length} pools · {unitCount} unit entries</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#bbb", fontSize: "1.1rem", cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ padding: "6px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pool, unit or region…"
            autoFocus
            style={{ width: "100%", boxSizing: "border-box", padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "#f0f0f0", fontSize: "0.85rem", outline: "none" }}
          />
        </div>

        <div style={{ overflowY: "auto", padding: "6px 10px" }}>
          {!mercData && <div style={{ color: "#aaa", fontStyle: "italic", padding: 10 }}>Loading descr_mercenaries…</div>}
          {mercData && visible.length === 0 && <div style={{ color: "#aaa", fontStyle: "italic", padding: 10 }}>No pools match.</div>}
          {visible.map((p) => {
            const isOpen = open.has(p.name) || (!!q && visible.length <= 4);
            return (
              <div key={p.name} style={{ marginBottom: 4, border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, background: "rgba(255,255,255,0.02)" }}>
                <div
                  onClick={() => toggle(p.name)}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", cursor: "pointer" }}
                >
                  <span style={{ color: "#888", fontSize: "0.7rem", width: 10 }}>{isOpen ? "▾" : "▸"}</span>
                  <span style={{ fontWeight: 600, color: "#e8d9a0", flex: 1, textTransform: "capitalize" }}>{p.name.replace(/_/g, " ")}</span>
                  <span style={{ color: "#888", fontSize: "0.72rem" }}>{(p.units || []).length} units · {(p.regions || []).length} regions</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); const ks = keysOf(p); if (ks.length) onHighlightRegions(ks, true); }}
                    title="Highlight this pool's regions on the map"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 5, color: "#8fc9d8", fontSize: "0.7rem", padding: "2px 8px", cursor: "pointer" }}
                  >map</button>
                </div>
                {isOpen && (
                  <div style={{ padding: "0 8px 7px 26px" }}>
                    <table style={{ borderCollapse: "collapse", fontSize: "0.74rem", width: "100%" }}>
                      <thead>
                        <tr>
                          <th style={th}>Unit</th><th style={th}>Exp</th><th style={th}>Cost</th>
                          <th style={th}>Replenish</th><th style={th}>Max</th><th style={th}>Initial</th><th style={th}>Restrict</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(p.units || []).map((u, i) => (
                          <tr
                            key={u.name + i}
                            onClick={() => onOpenUnit && onOpenUnit(u.name)}
                            title="Open unit card"
                            style={{ cursor: "pointer" }}
                            onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                          >
                            <td style={{ ...td, color: "#ddd", whiteSpace: "normal" }}>{u.name.replace(/^merc /i, "").replace(/_/g, " ")}</td>
                            <td style={{ ...td, color: "#bbb" }}>{u.exp ?? "—"}</td>
                            <td style={{ ...td, color: "#e8c873" }}>{u.cost != null ? u.cost.toLocaleString() : "—"}</td>
                            <td style={{ ...td, color: "#bbb" }}>{Array.isArray(u.replenish) ? `${u.replenish[0]}–${u.replenish[1]}` : "—"}</td>
                            <td style={{ ...td, color: "#bbb" }}>{u.max ?? "—"}</td>
                            <td style={{ ...td, color: "#bbb" }}>{u.initial ?? "—"}</td>
                            <td style={{ ...td, color: "#9a8f7a", whiteSpace: "normal" }}>{(u.restrict || []).join(", ") || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ marginTop: 5, display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {(p.regions || []).map((r) => {
                        const k = keyByRegion[String(r).toLowerCase()];
                        return (
                          <span
                            key={r}
                            onClick={() => k && onHighlightRegions([k], false)}
                            onDoubleClick={() => k && onHighlightRegions([k], true)}
                            title={k ? "Click: highlight · double-click: jump" : "Region not on this map"}
                            style={{ fontSize: "0.68rem", padding: "1px 7px", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)", color: k ? "#a8c8d8" : "#776", cursor: k ? "pointer" : "default" }}
                          >{r.replace(/_/g, " ")}</span>
                        );
                      })}
                    </div>
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
