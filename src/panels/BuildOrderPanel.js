// src/panels/BuildOrderPanel.js (2026-07-17)
//
// Build-Order Optimizer panel. Ranks every buildable-next structure for a settlement
// (or the whole faction) by modeled payback — cost / extra income per turn — so the
// best next build is obvious. Presentational: fetches via the "rank-build-order" IPC
// (window.electronAPI.rankBuildOrder). Dark inline styling matches ArmySetupModal.js.
//
// Props: { modDataDir, faction, region, factionDisplayNames, onClose }

import React from "react";
import { createPortal } from "react-dom";

// payback-speed color band: <10 turns green, <25 amber, slower gray
function paybackColor(pb) {
  if (pb == null) return "#8a8a8a";
  if (pb < 10) return "#7fd98f";
  if (pb < 25) return "#e8c873";
  return "#9a9a9a";
}
const CAT_STYLE = {
  economy: { bg: "rgba(90,150,110,0.22)", fg: "#9ed6ad", label: "economy" },
  military: { bg: "rgba(180,90,80,0.22)", fg: "#e0a090", label: "military" },
  happiness: { bg: "rgba(120,140,200,0.22)", fg: "#9fb6e8", label: "order" },
  other: { bg: "rgba(120,120,120,0.22)", fg: "#bbb", label: "other" },
};

export default function BuildOrderPanel({ modDataDir, faction, region, factionDisplayNames, onClose }) {
  const [data, setData] = React.useState(null);
  const [busy, setBusy] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [scope, setScope] = React.useState(region ? "region" : "faction");

  const facLabel = (factionDisplayNames && faction && factionDisplayNames[faction]) || faction || "—";

  React.useEffect(() => {
    let alive = true;
    setBusy(true); setErr(null); setData(null);
    const reg = scope === "region" ? region : null;
    const p = window.electronAPI && window.electronAPI.rankBuildOrder
      ? window.electronAPI.rankBuildOrder(modDataDir, faction, reg || undefined)
      : Promise.resolve({ error: "rankBuildOrder IPC unavailable (preload bridge missing?)" });
    Promise.resolve(p).then(r => {
      if (!alive) return;
      if (r && r.error) setErr(r.error);
      else setData(r);
      setBusy(false);
    }).catch(e => { if (alive) { setErr(e && e.message ? e.message : String(e)); setBusy(false); } });
    return () => { alive = false; };
  }, [modDataDir, faction, region, scope]);

  const close = onClose || (() => {});

  const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString());

  return createPortal(
    <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 9991, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} className="popover-pop-in" style={{ background: "rgba(26,22,18,0.98)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "12px 0", width: "min(820px, 96vw)", maxHeight: "86vh", boxShadow: "0 12px 40px rgba(0,0,0,0.6)", color: "#f4f4f4", display: "flex", flexDirection: "column" }}>
        {/* header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <span style={{ fontWeight: 700, fontSize: "1rem", color: "#cf8f6a" }}>🧰 Build-Order Optimizer — {facLabel}</span>
          <button onClick={close} style={{ background: "none", border: "none", color: "#bbb", fontSize: "1.1rem", cursor: "pointer" }}>✕</button>
        </div>

        {/* toolbar */}
        <div style={{ padding: "6px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.72rem", color: "#8aa" }}>Ranked by modeled payback (cost ÷ extra income/turn). Fastest-returning builds first.</span>
          {region && (
            <button onClick={() => setScope(scope === "region" ? "faction" : "region")}
              title="Toggle between the selected settlement only and every settlement in the faction."
              style={{ background: "rgba(60,60,60,0.7)", color: "#e8c873", border: "1px solid #a08a4a", borderRadius: 5, padding: "2px 10px", cursor: "pointer", fontSize: "0.74rem" }}>
              {scope === "region" ? "◱ This settlement" : "▦ Whole faction"}
            </button>
          )}
        </div>

        {/* body */}
        <div style={{ overflowY: "auto", padding: "8px 16px 14px" }}>
          {busy && <div style={{ color: "#9ab", fontSize: "0.82rem", padding: "18px 4px" }}>Computing income model… (first run for a faction takes ~1-3s)</div>}
          {err && <div style={{ color: "#e08a7a", fontSize: "0.82rem", padding: "12px 4px", whiteSpace: "pre-wrap" }}>⚠ {err}</div>}
          {!busy && !err && data && data.settlements && data.settlements.length === 0 &&
            <div style={{ color: "#9ab", fontSize: "0.82rem", padding: "12px 4px" }}>No settlements found for this selection.</div>}

          {!busy && !err && data && (data.settlements || []).map((s) => (
            <div key={s.region} style={{ marginBottom: 14, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, background: "rgba(255,255,255,0.02)" }}>
              <div style={{ padding: "7px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontWeight: 700, color: "#e0d0b8", fontSize: "0.92rem" }}>
                  {s.capital ? "★ " : ""}{s.settlement}
                  <span style={{ color: "#8a8", fontWeight: 400, fontSize: "0.72rem" }}> — {s.region} · {String(s.level || "").replace(/_/g, " ")} · pop {fmt(s.pop)}</span>
                </span>
                <span style={{ color: "#8aa", fontSize: "0.72rem" }}>{s.options.length} buildable</span>
              </div>

              {s.options.length === 0 && <div style={{ padding: "8px 12px", color: "#888", fontSize: "0.78rem" }}>Nothing buildable-next here.</div>}

              {/* option rows */}
              {s.options.map((o, i) => {
                const isIncome = o.paybackTurns != null;
                const cs = CAT_STYLE[o.category] || CAT_STYLE.other;
                return (
                  <div key={o.chain + ":" + o.toLevel}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 12px",
                      borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.04)",
                      opacity: isIncome ? 1 : 0.62 }}>
                    {/* name */}
                    <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                      <div style={{ color: "#f0e8dc", fontSize: "0.82rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {o.name}
                        <span style={{ color: "#7a8", fontWeight: 400, fontSize: "0.68rem" }}> ({o.chain}{o.fromLevel ? ` ${o.fromLevel}→` : " →"}{o.toLevel})</span>
                      </div>
                      <div style={{ color: "#9a9a9a", fontSize: "0.68rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.note}</div>
                    </div>
                    {/* cost / turns */}
                    <div style={{ flex: "0 0 96px", textAlign: "right", fontSize: "0.74rem", color: "#c8c0b4" }}>
                      {fmt(o.cost)} dn
                      <div style={{ color: "#888", fontSize: "0.66rem" }}>{o.turns != null ? `${o.turns} turns` : "—"}</div>
                    </div>
                    {/* income delta */}
                    <div style={{ flex: "0 0 76px", textAlign: "right", fontSize: "0.78rem", fontWeight: 700, color: isIncome ? "#7fd98f" : "#777" }}>
                      {isIncome ? `+${fmt(o.incomeDeltaPerTurn)}` : "—"}
                      <div style={{ color: "#777", fontSize: "0.62rem", fontWeight: 400 }}>dn/turn</div>
                    </div>
                    {/* payback badge */}
                    <div style={{ flex: "0 0 72px", textAlign: "center" }}>
                      {isIncome ? (
                        <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: "0.74rem", fontWeight: 700,
                          background: "rgba(0,0,0,0.25)", border: `1px solid ${paybackColor(o.paybackTurns)}`, color: paybackColor(o.paybackTurns) }}>
                          {o.paybackTurns}t
                        </span>
                      ) : <span style={{ color: "#666", fontSize: "0.7rem" }}>—</span>}
                    </div>
                    {/* category chip */}
                    <div style={{ flex: "0 0 66px", textAlign: "center" }}>
                      <span style={{ display: "inline-block", padding: "1px 7px", borderRadius: 4, fontSize: "0.66rem", background: cs.bg, color: cs.fg }}>{cs.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
