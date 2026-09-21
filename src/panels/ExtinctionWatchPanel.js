// src/panels/ExtinctionWatchPanel.js
//
// ☠ Extinction Watch — which factions are one death from destruction.
// RTW destroys a faction the moment its last living male family member dies
// (its settlements revert to the rebels), so the panel counts each faction's
// living ADULT males. Presentational + renderer-pure: everything derives from
// the descr_strat family data App already holds (modFamiliesByFaction). No IPC.
//
// Props:
//   familiesByFaction   — { faction: { members, relatives } } | null until loaded
//   settlementCount     — optional { faction: n } (what is at stake)
//   factionDisplayNames — optional { factionTag: "Display Name" }
//   selectedFaction     — optional, highlights that row
//   onPickFaction       — optional (faction) => void; clicking a row focuses it on the map
//   onClose             — close handler
//
// Style: dark inline, matching src/panels/TraitExplorerPanel.js.
import React from "react";
import { createPortal } from "react-dom";
import { assessAll, COMING_OF_AGE, ELDERLY_AGE } from "../extinctionWatch.js";

const GOLD = "#e8c873";
const TIER_STYLE = {
  extinct: { color: "#ff8f8f", bg: "rgba(224,80,80,0.22)", border: "rgba(224,80,80,0.55)", short: "none" },
  critical: { color: "#ff9d7a", bg: "rgba(224,110,70,0.20)", border: "rgba(224,110,70,0.5)", short: "1 left" },
  fragile: { color: "#e8c873", bg: "rgba(232,200,115,0.14)", border: "rgba(232,200,115,0.4)", short: "2–3" },
  secure: { color: "#8fd18f", bg: "rgba(143,209,143,0.12)", border: "rgba(143,209,143,0.35)", short: "4+" },
  none: { color: "#9ab", bg: "rgba(255,255,255,0.05)", border: "rgba(255,255,255,0.15)", short: "—" },
};
const TIER_TITLE = {
  extinct: "Factions with a family but no living adult male",
  critical: "One living adult male — his death destroys the faction",
  fragile: "Two or three living adult males",
  secure: "Four or more living adult males",
  none: "No family recorded in descr_strat (emergent factions, the rebels)",
};

export default function ExtinctionWatchPanel({ familiesByFaction, settlementCount, factionDisplayNames, selectedFaction, onPickFaction, onClose }) {
  const [query, setQuery] = React.useState("");
  const [tiers, setTiers] = React.useState(() => new Set());
  const [open, setOpen] = React.useState(null);

  const { rows, summary } = React.useMemo(() => assessAll(familiesByFaction, settlementCount), [familiesByFaction, settlementCount]);
  const facLabel = React.useCallback((f) => (factionDisplayNames && f && factionDisplayNames[f]) || (f ? f.replace(/_/g, " ") : "—"), [factionDisplayNames]);
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => (!tiers.size || tiers.has(r.tier)) && (!q || r.faction.toLowerCase().includes(q) || facLabel(r.faction).toLowerCase().includes(q) || r.adults.some((a) => a.name.toLowerCase().includes(q))));
  }, [rows, tiers, query, facLabel]);

  const close = onClose || (() => { });
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const loaded = !!familiesByFaction && rows.length > 0;
  const toggleTier = (k) => setTiers((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const person = (p, dim) => (
    <span key={p.name + p.age} title={p.onMap && p.x != null ? `On the map at x ${p.x}, y ${p.y}` : "Family record — not on the map at campaign start"}
      style={{ display: "inline-block", margin: "2px 6px 2px 0", padding: "1px 7px", borderRadius: 10, fontSize: "0.74rem", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: dim ? "#9ab" : "#ddd" }}>
      {p.tag === "leader" ? "♛ " : p.tag === "heir" ? "♚ " : ""}{p.name}
      <span style={{ color: p.elderly ? "#ff9d7a" : "#8a97a6", marginLeft: 5 }}>{p.age != null ? p.age : "?"}</span>
    </span>
  );

  return createPortal(
    <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 9991, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} className="popover-pop-in" role="dialog" aria-label="Extinction Watch"
        style={{ background: "rgba(26,22,18,0.98)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, width: "min(900px, 94vw)", maxHeight: "86vh", display: "flex", flexDirection: "column", color: "#ddd", boxShadow: "0 18px 60px rgba(0,0,0,0.55)" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "12px 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontSize: "1.02rem", fontWeight: 600, color: GOLD }}>
            Extinction Watch
            <span style={{ marginLeft: 10, fontSize: "0.74rem", color: "#9ab", fontWeight: 400 }}>
              {loaded ? `${filtered.length} / ${rows.length} factions  ·  campaign start (descr_strat)` : ""}
            </span>
          </div>
          <button onClick={close} aria-label="Close" style={{ background: "transparent", border: "none", color: "#9ab", fontSize: "1rem", cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ padding: "8px 16px 0", fontSize: "0.78rem", color: "#a9b4c0", lineHeight: 1.45 }}>
          A faction is destroyed when its last living male family member dies — its settlements go to the rebels, however many it holds.
          Counted here: living males of {COMING_OF_AGE}+ in the family. Boys are listed but never counted.
        </div>

        {/* Tier chips = legend AND filter */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "10px 16px 6px", alignItems: "center" }}>
          {["critical", "fragile", "secure", "extinct", "none"].filter((k) => summary[k] > 0 || k === "critical").map((k) => {
            const s = TIER_STYLE[k], on = tiers.has(k);
            return (
              <button key={k} onClick={() => toggleTier(k)} title={TIER_TITLE[k] + " — click to filter"} aria-pressed={on}
                style={{ cursor: "pointer", borderRadius: 12, padding: "2px 10px", fontSize: "0.76rem", color: s.color, background: on ? s.bg : "transparent", border: `1px solid ${on ? s.border : "rgba(255,255,255,0.14)"}` }}>
                {s.short} <span style={{ color: "#ccd", marginLeft: 4 }}>{summary[k]}</span>
              </button>
            );
          })}
          {tiers.size > 0 && <button onClick={() => setTiers(new Set())} style={{ cursor: "pointer", background: "transparent", border: "none", color: "#9ab", fontSize: "0.76rem" }}>✕ clear</button>}
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search faction or family member…" aria-label="Search"
            style={{ marginLeft: "auto", background: "rgba(255,255,255,0.07)", color: "#eee", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 6, padding: "4px 8px", fontSize: "0.8rem", width: 230 }} />
        </div>

        {/* Rows */}
        <div style={{ overflowY: "auto", padding: "2px 10px 12px" }}>
          {!loaded && (
            <div style={{ padding: "28px 12px", color: "#9ab", fontSize: "0.85rem", textAlign: "center" }}>
              {familiesByFaction ? "This campaign's descr_strat records no family members." : "No mod loaded — load a mod to read its families."}
            </div>
          )}
          {loaded && !filtered.length && (
            <div style={{ padding: "28px 12px", color: "#9ab", fontSize: "0.85rem", textAlign: "center" }}>Nothing matches — clear the search or the tier filter.</div>
          )}
          {filtered.map((r) => {
            const s = TIER_STYLE[r.tier], isOpen = open === r.faction, isSel = selectedFaction === r.faction;
            return (
              <div key={r.faction} data-extinction-row={r.tier} style={{ margin: "4px 6px", borderRadius: 7, border: `1px solid ${isSel ? "rgba(232,200,115,0.55)" : "rgba(255,255,255,0.07)"}`, background: isOpen ? "rgba(255,255,255,0.04)" : "transparent" }}>
                <div onClick={() => setOpen(isOpen ? null : r.faction)} onDoubleClick={() => onPickFaction && onPickFaction(r.faction)}
                  title={onPickFaction ? "Click to expand · double-click to focus this faction on the map" : "Click to expand"}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", cursor: "pointer" }}>
                  <span style={{ minWidth: 46, textAlign: "center", borderRadius: 10, padding: "1px 0", fontSize: "0.74rem", fontWeight: 600, color: s.color, background: s.bg, border: `1px solid ${s.border}` }}>
                    {r.noFamily ? "—" : r.adultMales}
                  </span>
                  <span style={{ flex: "0 1 240px", fontSize: "0.86rem", color: "#e6e6e6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{facLabel(r.faction)}</span>
                  <span style={{ flex: 1, fontSize: "0.76rem", color: r.flags.length ? "#ffb59a" : "#8a97a6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.noFamily ? "no family recorded" : r.flags.length ? r.flags.join(" · ") : (r.boys.length ? `${r.boys.length} boy${r.boys.length === 1 ? "" : "s"}${r.nextOfAgeIn != null ? `, next of age in ${r.nextOfAgeIn}y` : ""}` : "")}
                  </span>
                  {r.settlements != null && <span title="Settlements held at campaign start — what reverts to the rebels" style={{ fontSize: "0.74rem", color: "#9ab", whiteSpace: "nowrap" }}>{r.settlements} town{r.settlements === 1 ? "" : "s"}</span>}
                  <span style={{ color: "#778", fontSize: "0.7rem", width: 10 }}>{isOpen ? "▾" : "▸"}</span>
                </div>
                {isOpen && (
                  <div style={{ padding: "2px 12px 10px 66px", fontSize: "0.78rem" }}>
                    {r.noFamily ? <div style={{ color: "#9ab" }}>No `character` or `character_record` family entries for this faction in descr_strat.</div> : (
                      <>
                        <div style={{ color: "#9ab", marginBottom: 2 }}>Adult males ({r.adultMales}) <span style={{ color: "#667" }}>· ♛ leader · ♚ heir · age in <span style={{ color: "#ff9d7a" }}>orange</span> = {ELDERLY_AGE}+</span></div>
                        <div>{r.adults.length ? r.adults.map((p) => person(p)) : <span style={{ color: "#ff8f8f" }}>none</span>}</div>
                        <div style={{ color: "#9ab", margin: "6px 0 2px" }}>Boys under {COMING_OF_AGE} ({r.boys.length}){r.nextOfAgeIn != null ? ` — the eldest comes of age in ${r.nextOfAgeIn} year${r.nextOfAgeIn === 1 ? "" : "s"}` : ""}</div>
                        <div>{r.boys.length ? r.boys.map((p) => person(p, true)) : <span style={{ color: "#778" }}>none</span>}</div>
                        {r.oneStack && <div style={{ color: "#ffb59a", marginTop: 6 }}>Every adult male stands on tile {r.adults[0].x},{r.adults[0].y} — one lost battle can end the line.</div>}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ padding: "7px 16px", borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: "0.72rem", color: "#7d8896" }}>
          Source: the campaign's descr_strat (`character` and `character_record` lines). A live save's family roster is only partly readable, so this view does not follow a running campaign.
        </div>
      </div>
    </div>,
    document.body
  );
}
