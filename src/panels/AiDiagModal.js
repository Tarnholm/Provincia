// AI Diagnostics modal, extracted from App.js (2026-07-15). Shows the
// economic health of every faction in the loaded save (bankrupt / will-go-
// bankrupt / bleeding / hoarding), with editable hoarding thresholds. Props
// thread the save economy + diagnostics + config (and its setter), a display-
// name map, a faction-pick handler, and a close handler. AiDiagSection (a tiny
// presentational list, previously module-scope in App.js and used only here)
// moved in with it. Behavior identical to the inline block.
import React from "react";

// Faction-list section: title + colored rows, each clickable to select the
// faction. `disp` resolves a display name; `onPick` selects + closes.
const AiDiagSection = ({ title, color, rows, render, empty, disp, onPick }) => (
  <div>
    <div style={{ fontWeight: 700, color, fontSize: "0.8rem", borderBottom: `1px solid ${color}44`, paddingBottom: 2, marginBottom: 4 }}>{title} <span style={{ color: "#888", fontWeight: 400 }}>({rows.length})</span></div>
    {rows.length === 0 ? <div style={{ color: "#667", fontStyle: "italic", fontSize: "0.74rem" }}>{empty}</div> : (
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {rows.map((r) => (
          <div key={r.faction} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.78rem", padding: "2px 6px", borderRadius: 4, cursor: "pointer" }}
            onClick={() => onPick(r.faction)}
            title="Click to select this faction on the map">
            <span style={{ flex: 1, textTransform: "capitalize", color: "#ddd" }}>{disp(r.faction)}</span>
            <span style={{ color: "#9aa", fontVariantNumeric: "tabular-nums", fontSize: "0.72rem" }}>{render(r)}</span>
          </div>
        ))}
      </div>
    )}
  </div>
);

export default function AiDiagModal({
  saveEconomy, aiDiagConfig, setAiDiagConfig, aiDiagnostics, factionDisplayNames,
  onClose, onPickFaction,
}) {
  const inputStyle = { width: 84, background: "rgba(255,255,255,0.07)", color: "#eee", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 4, padding: "2px 6px", fontSize: "0.74rem", fontVariantNumeric: "tabular-nums" };
  const num = (key) => (
    <input type="number" value={aiDiagConfig[key]} style={inputStyle}
      onChange={(e) => { const v = e.target.value === "" ? 0 : Number(e.target.value); setAiDiagConfig((c) => ({ ...c, [key]: Number.isFinite(v) ? v : c[key] })); }} />
  );
  const scaled = aiDiagConfig.hoardMode !== "flat";
  const fmt = (v) => (v == null ? "—" : Number(v).toLocaleString());
  const disp = (f) => (factionDisplayNames && (factionDisplayNames[f] || factionDisplayNames[String(f).toLowerCase()])) || String(f).replace(/_/g, " ");
  const pick = (f) => { onPickFaction(f); onClose(); };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 11001, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#16181c", color: "#eee", borderRadius: 10, padding: "16px 18px", maxWidth: "66vw", maxHeight: "84vh", display: "flex", flexDirection: "column", gap: 10, border: "1px solid rgba(200,90,90,0.4)", boxShadow: "0 12px 48px rgba(0,0,0,0.7)", minWidth: 520 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontSize: "1rem", color: "#e88" }}>🩺 AI Diagnostics{saveEconomy?.turn != null ? <span style={{ color: "#8a93a8", fontWeight: 400, fontSize: "0.78rem" }}> — turn {saveEconomy.turn}</span> : null}</h2>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "#aaa", fontSize: "1rem", cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ fontSize: "0.74rem", color: "#9aa" }}>
          Economic health of every faction in the loaded save (from the cracked Financial Overview). Cross-turn checks — stuck units, factions dormant for N turns — are coming next off the timeline scanner.
        </div>
        <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, padding: "8px 10px", fontSize: "0.74rem", color: "#bcd", display: "flex", flexWrap: "wrap", gap: "6px 16px", alignItems: "center" }}>
          <span style={{ fontWeight: 700, color: "#caa84a", width: "100%" }}>😴 Hoarding threshold — flag a faction whose treasury exceeds:</span>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <select value={aiDiagConfig.hoardMode} onChange={(e) => setAiDiagConfig((c) => ({ ...c, hoardMode: e.target.value }))} style={{ ...inputStyle, width: "auto" }}>
              <option value="scaled">scaled to faction size</option>
              <option value="flat">a flat amount</option>
            </select>
          </label>
          {scaled ? (
            <>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>per settlement {num("hoardPerSettlement")}</label>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }} title="Extra per settlement-tier point (village 1 … huge city 6). 0 = ignore tiers.">+ per tier-point {num("hoardPerTier")}</label>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }} title="Extra per unit of total population. 0 = ignore population.">+ per population {num("hoardPerPop")}</label>
            </>
          ) : (
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>amount {num("hoardTreasury")}</label>
          )}
          <span style={{ width: "100%", height: 1, background: "rgba(255,255,255,0.07)" }} />
          <label style={{ display: "flex", alignItems: "center", gap: 6 }} title="…AND it spent less than this on recruitment + construction this turn (so it isn't using the money). Treasury must also be flat/rising, not shrinking.">…and spent on army+buildings below {num("hoardInvest")}</label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>Low-treasury alert below {num("lowTreasury")}</label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#8a93a8" }} title="Used by the upcoming cross-turn 'dormant faction' / 'stuck unit' checks.">Dormant window (turns) {num("dormantTurns")}</label>
        </div>
        <div style={{ overflow: "auto", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 12, paddingRight: 4 }}>
          <AiDiagSection disp={disp} onPick={pick} title={`💀 Bankrupt (treasury below ${Number(aiDiagConfig.lowTreasury || 0).toLocaleString()})`} color="#e85050" rows={aiDiagnostics.bankrupt} empty="None below the threshold." render={(r) => `treasury ${fmt(r.treasury)} · net ${fmt(r.net)}/turn`} />
          <AiDiagSection disp={disp} onPick={pick} title="📉 Will go bankrupt next turn" color="#e0913a" rows={aiDiagnostics.willBankrupt} empty="None projected to cross 0 next turn." render={(r) => `${fmt(r.treasury)} ${r.net < 0 ? "−" : "+"} ${fmt(Math.abs(r.net))} → ${fmt(r.after)}`} />
          <AiDiagSection disp={disp} onPick={pick} title="🩸 Bleeding (negative income)" color="#d06a6a" rows={aiDiagnostics.bleeding} empty="Everyone's net income is ≥ 0." render={(r) => `net ${fmt(r.net)}/turn · treasury ${fmt(r.treasury)}`} />
          <AiDiagSection disp={disp} onPick={pick} title="😴 Hoarding / passed-out (has money, not using it)" color="#caa84a" rows={aiDiagnostics.hoarding} empty="No idle-cash factions detected." render={(r) => `${fmt(r.treasury)} (cap ${fmt(Math.round(r.threshold))}) · ${r.settlements} setl · recruit ${fmt(r.recruitment)} / build ${fmt(r.construction)}${r.growth != null ? ` · ${r.growth >= 0 ? "+" : "−"}${fmt(Math.abs(r.growth))}/turn` : ""}`} />
        </div>
        <div style={{ fontSize: "0.68rem", color: "#667" }}>“Hoarding” = treasury &gt; {Number(aiDiagConfig.hoardTreasury).toLocaleString()} with under {Number(aiDiagConfig.hoardInvest).toLocaleString()} spent on recruitment + construction this turn — a proxy for a “passed-out” AI. Thresholds save automatically. Click any faction to select it on the map.</div>
      </div>
    </div>
  );
}
