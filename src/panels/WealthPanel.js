// Faction Wealth panel, extracted from App.js (2026-07-15). All the live/start
// derivations (armies, regions, treasury record→faction mapping, AI
// personality, sortable rows) are pure given the raw save/mod slices and are
// computed here from props. The viewport "zoom to this faction" math stays in
// App.js (it closes over canvas/zoom state) and is passed as onJumpToFaction.
// Portals to document.body. Behavior identical to the inline IIFE it replaced.
import React from "react";
import { createPortal } from "react-dom";

export default function WealthPanel({
  factions,
  factionRegionsMap,
  factionWealth,
  factionDisplayNames,
  saveLiveArmies,
  currentOwnerByCity,
  saveTreasuryRecords,
  playerFaction,
  factionRecordOwners,
  liveLogActive,
  saveEconomy,
  selectedFaction,
  treasuryHistory,
  onJumpToFaction,
  onClose,
}) {
  const liveArmiesByFaction = {};
  for (const a of (saveLiveArmies || [])) {
    const f = (a.faction || "").toLowerCase();
    if (!f || f === "unknown") continue;
    liveArmiesByFaction[f] = (liveArmiesByFaction[f] || 0) + 1;
  }
  const liveRegionsByFaction = {};
  if (currentOwnerByCity) {
    for (const owner of Object.values(currentOwnerByCity)) {
      liveRegionsByFaction[owner] = (liveRegionsByFaction[owner] || 0) + 1;
    }
  }
  const liveTreasuryByFaction = (() => {
    const recs = saveTreasuryRecords && saveTreasuryRecords.records;
    if (!recs || recs.length !== 23 || !playerFaction) return null;
    const out = {};
    if (factionRecordOwners && factionRecordOwners.length === recs.length) {
      for (let i = 0; i < recs.length; i += 1) {
        const owner = factionRecordOwners[i] && factionRecordOwners[i].factionName;
        if (!owner) continue;
        out[owner] = { treasury: recs[i].treasury, turnStart: recs[i].turnStart };
      }
      if (!out[playerFaction]) {
        const unidentified = recs.findIndex((_, i) => {
          const owner = factionRecordOwners[i] && factionRecordOwners[i].factionName;
          return !owner;
        });
        if (unidentified >= 0) {
          out[playerFaction] = {
            treasury: recs[unidentified].treasury,
            turnStart: recs[unidentified].turnStart,
          };
        }
      }
      return out;
    }
    const MAJOR_FACTIONS = [
      "romans_julii", "carthage", "antigonid", "ptolemaic", "seleucid",
      "bactria", "parni", "saka", "armenia", "pontus", "lusitani",
      "getae", "acarnania", "achaea", "acragas", "aedui", "aetolia",
      "allobroges", "anatolians", "arevaci", "ardiaei", "argos",
      "arverni",
    ];
    const others = MAJOR_FACTIONS.filter(f => f !== playerFaction);
    out[playerFaction] = { treasury: recs[0].treasury, turnStart: recs[0].turnStart };
    for (let k = 0; k < others.length && k + 1 < recs.length; k++) {
      out[others[k]] = { treasury: recs[k + 1].treasury, turnStart: recs[k + 1].turnStart };
    }
    return out;
  })();
  const aiPersonalityByFaction = (() => {
    if (!factionRecordOwners) return null;
    const out = {};
    for (const o of factionRecordOwners) {
      if (o && o.factionName && o.aiPersonality) {
        out[o.factionName.toLowerCase()] = o.aiPersonality;
      }
    }
    return out;
  })();
  const rows = factions.map(f => {
    const lf = f.toLowerCase();
    const liveRegions = liveRegionsByFaction[lf];
    const liveArmies = liveArmiesByFaction[lf];
    const startRegions = (factionRegionsMap[f] || []).length;
    const liveTreasury = liveTreasuryByFaction && liveTreasuryByFaction[lf];
    const startWealth = factionWealth[f] != null ? factionWealth[f] : (factionWealth[lf] != null ? factionWealth[lf] : null);
    const wealth = liveTreasury ? liveTreasury.treasury : startWealth;
    return {
      faction: f,
      wealth,
      wealthIsLive: !!liveTreasury,
      wealthTurnStart: liveTreasury ? liveTreasury.turnStart : null,
      regions: liveRegions != null ? liveRegions : startRegions,
      startingRegions: startRegions,
      armies: liveArmies || 0,
      isLive: liveLogActive && liveRegions != null,
      aiPersonality: aiPersonalityByFaction ? (aiPersonalityByFaction[lf] || null) : null,
      name: (factionDisplayNames && factionDisplayNames[f]) || f.replace(/_/g, " "),
    };
  }).filter(r => r.regions > 0 || (r.wealth != null && r.wealth !== 0));
  rows.sort((a, b) => b.regions - a.regions || (b.wealth ?? -Infinity) - (a.wealth ?? -Infinity));
  return createPortal(
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 9990,
      background: "rgba(0,0,0,0.4)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} className="popover-pop-in" style={{
        background: "rgba(28,24,18,0.97)",
        border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: 10,
        padding: "12px 0",
        width: "min(680px, 94vw)",
        maxHeight: "80vh",
        boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
        color: "#f4f4f4",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
          padding: "0 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}>
          <span style={{ fontWeight: 700, fontSize: "1rem", color: "#dca64a" }}>
            💰 Faction Wealth
          </span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {window.electronAPI?.saveFileAs && (
              <button
                title="Export treasury history + faction snapshot as two CSV files"
                onClick={async () => {
                  const csvEscape = (v) => {
                    if (v == null) return "";
                    const s = String(v);
                    return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
                  };
                  const snapshotHeader = ["faction","display_name","ai_personality","current_treasury","wealth_is_live","turn_start_treasury","starting_wealth","current_regions","starting_regions","current_armies","income_total","income_farming","income_trade","income_taxes","income_mining","income_other","expenditure_total","projected_income"];
                  const snapshotRows = [snapshotHeader.join(",")];
                  const ecoMap = (saveEconomy && saveEconomy.byFaction) || {};
                  const ecoCell = (v) => (typeof v === "number" ? v : "");
                  for (const r of rows) {
                    const ec = ecoMap[r.faction] || null;
                    const ein = ec && ec.income ? ec.income : {};
                    const eex = ec && ec.expenditure ? ec.expenditure : {};
                    snapshotRows.push([
                      r.faction, r.name, r.aiPersonality || "",
                      r.wealth ?? "", r.wealthIsLive ? "yes" : "no",
                      r.wealthTurnStart ?? "",
                      factionWealth[r.faction] != null ? factionWealth[r.faction] : (factionWealth[r.faction?.toLowerCase()] ?? ""),
                      r.regions, r.startingRegions, r.armies,
                      ecoCell(ein.total), ecoCell(ein.farming), ecoCell(ein.trade), ecoCell(ein.taxes != null ? ein.taxes : ein.tax), ecoCell(ein.mining), ecoCell(ein.other),
                      ecoCell(eex.total), ec ? ecoCell(ec.net) : "",
                    ].map(csvEscape).join(","));
                  }
                  const snapshotCsv = snapshotRows.join("\n");
                  const tHist = treasuryHistory || {};
                  const tFactions = Object.keys(tHist).sort();
                  const maxTurns = tFactions.reduce((m, f) => Math.max(m, (tHist[f] || []).length), 0);
                  const histRows = [["turn", ...tFactions].map(csvEscape).join(",")];
                  for (let t = 0; t < maxTurns; t++) {
                    const row = [t + 1];
                    for (const f of tFactions) row.push(tHist[f]?.[t] ?? "");
                    histRows.push(row.map(csvEscape).join(","));
                  }
                  const histCsv = histRows.join("\n");
                  const snapPath = await window.electronAPI.saveFileAs("faction_snapshot.csv", snapshotCsv, "CSV Files", ["csv"]);
                  if (snapPath) {
                    const histPath = await window.electronAPI.saveFileAs("treasury_history.csv", histCsv, "CSV Files", ["csv"]);
                    if (histPath) {
                      alert(`Exported:\n  ${snapPath}\n  ${histPath}\n\nSnapshot: ${rows.length} factions × ${snapshotHeader.length} columns.\nHistory: ${maxTurns} turns × ${tFactions.length} factions (${tFactions.length === 0 ? "no treasury history loaded — load a save first" : "wide format, pivot in Excel"}).`);
                    }
                  }
                }}
                style={{
                  background: "rgba(220,166,74,0.18)", border: "1px solid rgba(220,166,74,0.4)",
                  color: "#dca64a", padding: "3px 9px", borderRadius: 4, cursor: "pointer", fontSize: "0.72rem", fontWeight: 600,
                }}
              >Export CSV</button>
            )}
            <button onClick={onClose}
              style={{ background: "transparent", border: "none", color: "#aaa", fontSize: "1.1rem", cursor: "pointer", padding: 0 }}
              title="Close (Esc)">×</button>
          </div>
        </div>
        {saveEconomy && saveEconomy.byFaction && (() => {
          const focus = (selectedFaction && saveEconomy.byFaction[selectedFaction]) ? selectedFaction : saveEconomy.playerFaction;
          const e = focus && saveEconomy.byFaction[focus];
          if (!e) return null;
          const fmt = (v) => (v == null ? "—" : Number(v).toLocaleString());
          const disp = (factionDisplayNames && (factionDisplayNames[focus] || factionDisplayNames[String(focus).toLowerCase()])) || focus;
          const inc = e.income || {}, exp = e.expenditure || {};
          const miningInferred = e._confidence && /inferred/.test(e._confidence.mining || "");
          const incomeRows = [["Farming", inc.farming], ["Trade", inc.trade], ["Taxes", inc.taxes != null ? inc.taxes : inc.tax], ["Mining", inc.mining, miningInferred ? "label inferred" : null], ["Merchants", inc.merchants], ["Other", inc.other]];
          const expRows = [["Army upkeep", exp.army_upkeep != null ? exp.army_upkeep : exp.upkeep], ["Wages", exp.wages], ["Recruitment", exp.recruitment], ["Construction", exp.construction], ["Other", exp.other]];
          const netColor = e.net == null ? "#888" : e.net < 0 ? "#e85050" : "#9ec78a";
          const col = (rowsInner, label, accent, total) => (
            <div>
              <div style={{ color: accent, fontWeight: 600, fontSize: "0.7rem", marginBottom: 2, letterSpacing: "0.03em" }}>{label}</div>
              {rowsInner.map(([k, v, hint]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", color: v ? "#ddd" : "#6b7280", lineHeight: 1.5 }}>
                  <span>{k}{hint && <span style={{ color: "#6b7280", fontSize: "0.6rem", fontStyle: "italic", marginLeft: 4 }} title="The value is read exactly from the save; the category label here is inferred from cross-faction structure (no save with the player's Mining > 0 to confirm it directly).">({hint})</span>}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(v)}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid rgba(255,255,255,0.12)", marginTop: 2, paddingTop: 2, fontWeight: 700 }}>
                <span>Total</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(total)}</span>
              </div>
            </div>
          );
          return (
            <div style={{ padding: "8px 16px 10px", borderBottom: "1px solid rgba(255,255,255,0.08)", fontSize: "0.8rem" }}>
              <div style={{ fontWeight: 700, color: "#dca64a", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span>📊 Financial Overview — <span style={{ textTransform: "capitalize" }}>{disp}</span></span>
                {saveEconomy.turn != null && <span style={{ color: "#8a93a8", fontWeight: 400, fontSize: "0.72rem" }}>turn {saveEconomy.turn}</span>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
                {col(incomeRows, "INCOME", "#9ec78a", inc.total)}
                {col(expRows, "EXPENDITURE", "#e89030", exp.total)}
              </div>
              <div style={{ display: "flex", gap: 16, justifyContent: "flex-end", marginTop: 6, fontSize: "0.78rem" }}>
                <span style={{ color: "#999" }}>Treasury <span style={{ color: "#f4cd57", fontVariantNumeric: "tabular-nums" }}>{fmt(e.treasury)}</span></span>
                <span style={{ color: "#999" }}>Net <span style={{ color: netColor, fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{e.net == null ? "—" : (e.net >= 0 ? "+" : "") + Number(e.net).toLocaleString()}</span></span>
                {e.estimatedNextTurn != null && <span style={{ color: "#999" }}>Next ≈ <span style={{ color: "#cfd6e0", fontVariantNumeric: "tabular-nums" }}>{fmt(e.estimatedNextTurn)}</span></span>}
              </div>
              <div style={{ color: "#6b7280", fontSize: "0.64rem", marginTop: 4 }}>Stored save figures (matches the in-game Finance &amp; Family panel). Click a faction below to see its breakdown.</div>
            </div>
          );
        })()}
        <div style={{ overflowY: "auto", padding: "4px 8px" }}>
          <div style={{
            display: "grid", gridTemplateColumns: "24px 1fr 84px 80px 74px 52px 46px",
            fontSize: "0.7rem", color: "#999", padding: "4px 8px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}>
            <span></span><span>Faction</span>
            <span style={{ textAlign: "right" }}>Treasury</span>
            <span style={{ textAlign: "right" }} title="Gross turn income (sum of the stored income categories)">Income</span>
            <span style={{ textAlign: "right" }} title="Net turn income = income − expenditure (from the stored Financial Overview block)">Net</span>
            <span style={{ textAlign: "right" }}>Regions</span>
            <span style={{ textAlign: "right" }}>Armies</span>
          </div>
          {rows.map((r, i) => {
            const eco = saveEconomy && saveEconomy.byFaction ? saveEconomy.byFaction[r.faction] : null;
            const ecoIncome = eco && eco.income ? eco.income.total : null;
            const ecoNet = eco ? eco.net : null;
            return (
            <div key={r.faction}
              onClick={() => onJumpToFaction(r.faction)}
              style={{
                display: "grid", gridTemplateColumns: "24px 1fr 84px 80px 74px 52px 46px",
                alignItems: "center", padding: "4px 8px", borderRadius: 6,
                cursor: "pointer", fontSize: "0.85rem",
                background: selectedFaction === r.faction ? "rgba(220,166,74,0.18)" : "transparent",
                transition: "background 120ms var(--ease-mac-out)",
              }}
              onMouseEnter={(e) => { if (selectedFaction !== r.faction) e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
              onMouseLeave={(e) => { if (selectedFaction !== r.faction) e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ color: "#888", textAlign: "right", paddingRight: 4, fontSize: "0.75rem" }}>{i + 1}</span>
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ textTransform: "capitalize", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                {r.aiPersonality && (
                  <span style={{ fontSize: "0.62rem", color: "#8a93a8", letterSpacing: "0.02em" }}
                    title={`AI personality archetype decoded from save (feral_descr_ai_personality.txt): ${r.aiPersonality}`}>
                    {r.aiPersonality.replace(/^ai_/, "").replace(/_/g, " ")}
                  </span>
                )}
              </span>
              <span style={{ textAlign: "right", color: r.wealth == null ? "#555" : r.wealth < 0 ? "#e85050" : r.wealth >= 5000 ? "#9ec78a" : r.wealth >= 1000 ? "#f4cd57" : "#e89030", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}
                title={r.wealth == null
                  ? "No starting denarii found in descr_strat for this faction."
                  : r.wealthIsLive
                  ? `Live treasury from save (decoded 2026-05-10 via save-cracker session 5). ${typeof r.wealthTurnStart === "number" && r.wealthTurnStart !== r.wealth ? `Started this turn at ${r.wealthTurnStart.toLocaleString()}, mid-turn delta ${(r.wealth - r.wealthTurnStart >= 0 ? "+" : "") + (r.wealth - r.wealthTurnStart).toLocaleString()}.` : ""}`
                  : "Starting denarii from descr_strat. Live treasury not loaded (no save active, or non-RIS-imperial campaign)."}>
                {r.wealth == null ? "—" : r.wealth.toLocaleString()}
                {r.wealthIsLive && <span style={{ color: "#4a8", marginLeft: 4, fontSize: "0.7rem", fontWeight: 400 }}>·live</span>}
              </span>
              <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: ecoIncome == null ? "#555" : "#9ec78a" }}
                title={ecoIncome == null ? "No Financial Overview for this faction (load a save)." : "Gross turn income (sum of the stored income categories)."}>
                {ecoIncome == null ? "—" : ecoIncome.toLocaleString()}
              </span>
              <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: ecoNet == null ? "#555" : ecoNet < 0 ? "#e85050" : "#9ec78a" }}
                title={ecoNet == null ? "Net needs the stored Financial Overview block." : "Net turn income = income − expenditure (stored)."}>
                {ecoNet == null ? "—" : (ecoNet >= 0 ? "+" : "") + ecoNet.toLocaleString()}
              </span>
              <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums",
                             color: r.isLive ? (r.regions > r.startingRegions ? "#9ec78a" : r.regions < r.startingRegions ? "#e89030" : "#bbb") : "#bbb" }}
                title={r.isLive
                  ? `Live: ${r.regions} (started with ${r.startingRegions})`
                  : "Starting region count from descr_strat"}>
                {r.regions}
                {r.isLive && r.regions !== r.startingRegions && (
                  <span style={{ fontSize: "0.65rem", marginLeft: 2, opacity: 0.8 }}>
                    {r.regions > r.startingRegions ? "↑" : "↓"}
                  </span>
                )}
              </span>
              <span style={{ textAlign: "right", color: r.armies > 0 ? "#bbb" : "#555", fontVariantNumeric: "tabular-nums" }}
                title={r.isLive ? `Field armies the parser placed on the map` : "Live mode shows army counts"}>
                {r.isLive ? r.armies : "—"}
              </span>
            </div>
            );
          })}
        </div>
        <div style={{ padding: "8px 16px 0", fontSize: "0.7rem", color: "#888", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          Treasury = current (live) or starting denarii. Income/Net = stored Financial Overview (load a save). Click a row to zoom to that faction.
        </div>
      </div>
    </div>,
    document.body
  );
}
