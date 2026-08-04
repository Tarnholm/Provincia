// Army Setup modal, extracted from App.js (2026-07-15). Presentational: the
// caller owns all state + handlers (passed as props). Body verbatim (its own
// setup code + return). Behavior identical to the inline IIFE it replaced.
import React from "react";
import { createPortal } from "react-dom";
import FactionIcon from "../FactionIcon";

export default function ArmySetupModal({
  activeIconsDir,
  armyBudgetFloor,
  armyCalibSave,
  armyCalibSaves,
  armyEcoMode,
  armyFacSearch,
  armyOverview,
  armyOverviewRunning,
  armyProjIncome,
  armySetSearch,
  armySetupBusy,
  armySetupData,
  armySetupFactions,
  armyT1Budget,
  corrCalibStored,
  factionDisplayNames,
  garrDone,
  modDataDir,
  pendingReload,
  pushToast,
  setArmyBudgetFloor,
  setArmyCalibSaves,
  setArmyEcoMode,
  setArmyFacSearch,
  setArmyOverview,
  setArmyProjIncome,
  setArmySetSearch,
  setArmySetupBusy,
  setArmySetupData,
  setArmyStratPlan,
  setArmyT1Budget,
  setGarrDone,
  setPendingReload,
  setShowArmySetup,
  taxCalibStored,
}) {
        // Army Setup overlay — virtual-tax budget vs editable floor, current army
        // + balance, recruitable pool, swap suggestions. Army/pool/balance come
        // from the getArmySetup IPC (descr_strat); budget is projected here from
        // the loaded saveEconomy (the renderer's faction attribution).
        const d = armySetupData;
        const fac = d && d.faction;
        const facLabel = (factionDisplayNames && fac && factionDisplayNames[fac]) || fac || "—";
        const MULT = (d && d.taxBrackets) || { low: 0.80, normal: 1.00, high: 1.20, very_high: 1.50 };
        const close = () => setShowArmySetup(false);
        // Faction list for the picker = the CURRENT campaign's roster (descr_strat
        // faction lines), minus rebel/slave pseudo-factions. The Greens/Blues/Senate
        // (roman_rebels_1/2, roman_senate) are dead_until_resurrected civil-war factions
        // with zero start settlements — shown per the mod team (2026-08-04), their rows
        // read as "emergent" instead of a broken zero economy.
        const SKIP_FAC = new Set(["slave", "rebels"]);
        const facQ = armyFacSearch.trim().toLowerCase();
        const facList = (armySetupFactions || []).filter(x => x && !SKIP_FAC.has(x))
          .filter(x => !facQ || x.replace(/_/g, " ").toLowerCase().includes(facQ) || ((factionDisplayNames && factionDisplayNames[x]) || "").toLowerCase().includes(facQ));
        // NO-SAVE-ONLY (2026-06-10, user request): the save-loading flow (two-save model,
        // save-based optimalTaxPlan, save-economy badges) is gone — the mod-files model is
        // live-verified exact, so it IS the planner. Everything below computes from the
        // mod files alone: tax plan (computeStratTaxPlan), turn-1 budget (incomeModel),
        // and the budget auto-fill (sustainable army budget − starting-army upkeep).
        // 0.9.1096 HANG FIX: an IPC error reply used to be SILENTLY dropped here
        // (`if (t1 && !t1.error && t1.totals)` with no else), so any main-process
        // handler failure — e.g. v0.9.1095's "Cannot find module './src/calibSaveOpts.js'"
        // (file missing from the packaged build's files list) — left the budget
        // panel stuck on the "computing…" placeholder forever. Errors now render
        // in the panel, and a watchdog timeout converts a genuinely-unreplying IPC
        // into a visible error instead of an eternal await.
        const ipcWithTimeout = (p, what, ms = 120000) => {
          if (!p || typeof p.then !== "function") return Promise.resolve({ error: what + " IPC unavailable (preload bridge missing?)" });
          let to;
          return Promise.race([
            p.finally(() => clearTimeout(to)),
            new Promise(res => { to = setTimeout(() => res({ error: what + ` got no reply from the main process after ${ms / 1000}s — the handler likely crashed before replying (see provincia.log)` }), ms); }),
          ]);
        };
        const fetchFor = async (ff, calibOverride) => {
          if (!ff || !modDataDir) return;
          const calib = calibOverride !== undefined ? calibOverride : armyCalibSave;
          setArmyProjIncome("");
          setArmySetupBusy(true); setArmySetupData(null); setArmyT1Budget(null); setArmyStratPlan(null); setGarrDone(new Set()); setPendingReload(false);
          // per-campaign tax + corruption calibration: persisted per modDir+faction
          const taxH = taxCalibStored(modDataDir, ff);
          const corrCal = corrCalibStored(modDataDir, ff);
          const t1Promise = ipcWithTimeout(window.electronAPI.getTurn1Budget?.(modDataDir, ff, calib || undefined, armyEcoMode === "ai" || undefined, taxH || undefined, corrCal || undefined, armyEcoMode === "human" ? "hard" : undefined), "turn-1 budget");
          // auto-compute the tax plan too (no button press needed)
          const planPromise = ipcWithTimeout(window.electronAPI.getStratTaxPlan?.(modDataDir, ff, calib || undefined), "strat tax plan");
          try {
            const r = await ipcWithTimeout(window.electronAPI.getArmySetup(ff, modDataDir, armyBudgetFloor), "army setup");
            setArmySetupData(r || { error: "no result" });
            const t1 = await t1Promise;
            if (t1 && !t1.error && t1.totals) {
              setArmyT1Budget(t1);
              if (typeof t1.totals.armyBudget === "number") {
                // prefer the budget's save-aware army upkeep over the army-setup no-save formula
                const au = (typeof t1.totals.armyUpkeep === "number" && t1.totals.armyUpkeep > 0) ? t1.totals.armyUpkeep : (r && typeof r.armyUpkeep === "number" ? r.armyUpkeep : null);
                if (au != null) setArmyProjIncome(String(t1.totals.armyBudget - au));
              }
            } else {
              setArmyT1Budget({ error: (t1 && t1.error) || "turn-1 budget returned no result", faction: ff });
            }
            const plan = await planPromise;
            if (plan && !plan.error) setArmyStratPlan(plan);
          }
          catch (e) { setArmySetupData({ error: e?.message || String(e) }); }
          finally { setArmySetupBusy(false); }
        };
        const TAX_LBL = { low: "Low", normal: "Normal", high: "High", very_high: "V.High" };
        // Balance overview: run the turn-1 budget for every campaign faction, progressive.
        const runOverview = async () => {
          if (armyOverviewRunning.current || !modDataDir) return;
          armyOverviewRunning.current = true;
          // before/after diff: remember the LAST completed run per mod dir, so after a
          // round of file edits the next run shows exactly which factions moved.
          let prevByFac = {};
          try {
            const prev = JSON.parse(localStorage.getItem("armyOverviewPrev:" + modDataDir) || "null");
            if (prev && Array.isArray(prev.rows)) for (const r of prev.rows) prevByFac[r.fac] = r;
          } catch { }
          setArmyOverview({ busy: true, rows: [], error: null, prevByFac, prevAt: (() => { try { return JSON.parse(localStorage.getItem("armyOverviewPrev:" + modDataDir) || "null")?.at || null; } catch { return null; } })() });
          const done = [];
          try {
            // Deterministic-across-saves: per faction, run the budget under EACH calibration
            // save and take the DETERMINISTIC value — the figure its AI-campaign saves agree on.
            // The engine only rolls a governor's start-of-campaign personality traits for the
            // SAVE's OWN player faction, so that one save is a lone outlier; every OTHER save
            // gives the identical seed-governor (designed-start) economy. detOf returns the
            // most-common value (the seed); with no agreement it falls back to the median.
            // With 0/1 save it's just the single result.
            const calibList = armyCalibSaves.length ? armyCalibSaves : [undefined];
            const detOf = (arr) => {
              const v = arr.filter(x => typeof x === "number" && isFinite(x));
              if (!v.length) return undefined;
              const counts = new Map(); for (const x of v) counts.set(x, (counts.get(x) || 0) + 1);
              let best, bestC = 0; for (const [val, c] of counts) if (c > bestC) { bestC = c; best = val; }
              if (bestC >= 2) return best;                         // the seed value the AI-saves agree on
              const s = [...v].sort((a, b) => a - b); const m = Math.floor(s.length / 2);
              return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;   // no agreement (≤1 AI save) → median
            };
            for (const ff of facList) {
              // The overview honors the attached calibration save(s) like fetchFor does.
              const perSave = [];
              for (const sv of calibList) {
                const t1 = await ipcWithTimeout(window.electronAPI.getTurn1Budget?.(modDataDir, ff, sv || undefined, armyEcoMode === "ai" || undefined, taxCalibStored(modDataDir, ff) || undefined, corrCalibStored(modDataDir, ff) || undefined, armyEcoMode === "human" ? "hard" : undefined), "turn-1 budget (" + ff + (sv ? " · " + sv.split(/[\\/]/).pop().slice(0, 10) : "") + ")");
                if (t1 && t1.error) setArmyOverview(prev => ({ ...(prev || {}), error: t1.error }));
                if (t1 && !t1.error && t1.totals) perSave.push(t1);
              }
              if (perSave.length) {
                const keys = new Set(); perSave.forEach(t => Object.keys(t.totals).forEach(k => { if (typeof t.totals[k] === "number") keys.add(k); }));
                const detTotals = {}; for (const k of keys) { const dv = detOf(perSave.map(t => t.totals[k])); if (dv !== undefined) detTotals[k] = dv; }
                const row = { fac: ff, ...detTotals, towns: perSave[0].settlements?.length || 0, tier: perSave[0].tier, nSaves: perSave.length };
                done.push(row);
                setArmyOverview(prev => ({ ...(prev || {}), busy: true, rows: [...((prev && prev.rows) || []), row] }));
              }
            }
          } finally {
            armyOverviewRunning.current = false;
            try { localStorage.setItem("armyOverviewPrev:" + modDataDir, JSON.stringify({ at: new Date().toISOString(), rows: done.map(r => ({ fac: r.fac, net: r.net, netAfterTribute: r.netAfterTribute, income: r.income })) })); } catch { }
            setArmyOverview(prev => prev ? { ...prev, busy: false } : prev);
          }
        };
        return createPortal(
          <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 9991, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div onClick={e => e.stopPropagation()} className="popover-pop-in" style={{ background: "rgba(26,22,18,0.98)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "12px 0", width: "min(860px, 96vw)", maxHeight: "86vh", boxShadow: "0 12px 40px rgba(0,0,0,0.6)", color: "#f4f4f4", display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                <span style={{ fontWeight: 700, fontSize: "1rem", color: "#cf8f6a" }}>⚔ Army Setup — {facLabel}</span>
                <button onClick={close} style={{ background: "none", border: "none", color: "#bbb", fontSize: "1.1rem", cursor: "pointer" }}>✕</button>
              </div>
              {/* Toolbar: faction picker with icons (everything computes from the mod files) */}
              <div style={{ padding: "6px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.72rem", color: "#8aa" }}>Pick a faction — tax plan + turn-1 budget are computed from the mod files (no save needed).</span>
                  <button onClick={runOverview} disabled={armyOverview && armyOverview.busy}
                    title="Compute the turn-1 budget for EVERY campaign faction and list over/under-budget verdicts — the mod-balance overview. Takes ~1s per faction; rows appear as they finish."
                    style={{ background: "rgba(60,60,60,0.7)", color: "#e8c873", border: "1px solid #a08a4a", borderRadius: 5, padding: "2px 10px", cursor: "pointer", fontSize: "0.74rem" }}>
                    ⚖ Balance overview{armyOverview && armyOverview.busy ? ` (${armyOverview.rows.length}/${facList.length}…)` : ""}
                  </button>
                  {armyOverview && !armyOverview.busy && <button onClick={() => setArmyOverview(null)} style={{ background: "none", border: "1px solid rgba(255,255,255,0.2)", color: "#9aa", borderRadius: 5, padding: "2px 8px", cursor: "pointer", fontSize: "0.72rem" }}>hide</button>}
                  <button
                    onClick={() => { const order = ["human", "player", "ai"]; const next = order[(order.indexOf(armyEcoMode) + 1) % order.length]; setArmyEcoMode(next); pushToast(next === "ai" ? "Modeling factions under AI rules (no human malus + empire-size bonus)" : next === "human" ? "Modeling factions all-human at HARD (H/H ×0.92, no AI bonus, optimal taxes for every faction) — the 'if you played each' view" : "Modeling factions under human-player HARD rules (H/H ×0.92 income)", "info", 4500); if (fac) setTimeout(() => fetchFor(fac), 0); }}
                    title={armyEcoMode === "ai"
                      ? "AI RULES: no 0.92 human income malus + the tiered empire-size AI income bonus (≈×1.8 city-states → ×1.0 big empires, from 215 AI ledgers). Click to cycle → player (Hard)."
                      : armyEcoMode === "human"
                      ? "ALL-HUMAN, HARD (H/H ×0.92 income like the player, no AI bonus) — what each faction makes if YOU played it and set its 0-growth-optimal taxes; ignores in-game set rates so every faction is compared on equal footing. Click to cycle → AI rules."
                      : "HUMAN-PLAYER, HARD (H/H: 92% tax+farm income, no AI bonus; honors the tax rates you set in-game via the calibration save). Click to cycle → all-human."}
                    style={{ background: armyEcoMode === "ai" ? "rgba(120,140,200,0.25)" : armyEcoMode === "human" ? "rgba(90,150,110,0.22)" : "rgba(60,60,60,0.7)", color: armyEcoMode === "ai" ? "#9fb6e8" : armyEcoMode === "human" ? "#9ed6ad" : "#9ab", border: "1px solid " + (armyEcoMode === "ai" ? "#5a72b0" : armyEcoMode === "human" ? "#4a9a6a" : "rgba(255,255,255,0.25)"), borderRadius: 5, padding: "2px 10px", cursor: "pointer", fontSize: "0.74rem" }}>
                    {armyEcoMode === "ai" ? "🤖 AI rules" : armyEcoMode === "human" ? "🧑 all-human" : "👤 player (Hard)"}
                  </button>
                  <button
                    onClick={async () => {
                      if (armyCalibSaves.length) { setArmyCalibSaves([]); pushToast("Calibration saves cleared — back to descr_strat seeds", "info", 4000); if (fac) fetchFor(fac, ""); return; }
                      try {
                        const r = await window.electronAPI.selectSaveFiles?.();
                        const paths = (r && Array.isArray(r.paths)) ? r.paths : (r && r.path ? [r.path] : []);
                        if (paths.length) { setArmyCalibSaves(paths); pushToast(paths.length > 1 ? `${paths.length} calibration saves set — the Balance overview shows each faction's DETERMINISTIC starting-governor economy across them (drops the lone played-faction roll)` : "Calibration save set — governor traits now come from this save for ALL factions", "info", 6000); if (fac) fetchFor(fac, paths[0]); }
                      } catch { }
                    }}
                    title={armyCalibSaves.length
                      ? `${armyCalibSaves.length} calibration save${armyCalibSaves.length > 1 ? "s" : ""} active${armyCalibSaves.length > 1 ? " — the overview shows each faction's deterministic starting-governor economy" : ""}:\n${armyCalibSaves.map(s => s.split(/[\\/]/).pop()).join("\n")}\nClick to clear.`
                      : "Pick one or MORE fresh turn-1 saves as calibration: the engine randomizes personality traits at campaign start and each save records that campaign's roll. Pick several and the Balance overview shows each faction's deterministic value across them, dropping the lone played-faction roll."}
                    style={{ background: armyCalibSaves.length ? "rgba(143,180,110,0.25)" : "rgba(60,60,60,0.7)", color: armyCalibSaves.length ? "#b8d38f" : "#9ab", border: "1px solid " + (armyCalibSaves.length ? "#7a9a5a" : "rgba(255,255,255,0.25)"), borderRadius: 5, padding: "2px 10px", cursor: "pointer", fontSize: "0.74rem" }}>
                    🎯 {armyCalibSaves.length ? (armyCalibSaves.length > 1 ? `${armyCalibSaves.length} saves (deterministic) ✕` : "calibrated: " + armyCalibSave.split(/[\\/]/).pop().replace(/\.sav$/i, "").slice(0, 22) + " ✕") : "calibration save(s)…"}
                  </button>
                  {armyOverview && !armyOverview.busy && armyOverview.rows.length > 0 && (
                    <button
                      onClick={() => {
                        const rows = armyOverview.rows.slice().sort((a, b) => ((a.netAfterTribute ?? a.net) ?? 0) - ((b.netAfterTribute ?? b.net) ?? 0));
                        const name = f2 => ((factionDisplayNames && factionDisplayNames[f2]) || f2).replace(/_/g, " ");
                        const md = [
                          "# RIS balance overview — turn-1 economy @ optimal taxes vs starting army",
                          "_" + new Date().toISOString().slice(0, 10) + " · Provincia mod-file model (no save). Income 1st look = finance scroll before the empire_sizeN event fires; @ size tax = after (Size = tax level from settlement count: 0-1 / 2-4 / 5-8 / 9-15 / 16-29 / 30-50 / 51-100 / 101-200 / 201-400 / 401+). Net = army budget − starting-army upkeep ± protectorate tribute (50% of client profit, from turn 2). ♛ suzerain · ⚑ protectorate._",
                          "",
                          "| Faction | Towns | Size | Income 1st look | @ size tax | Wages | Corruption | Army budget | Army upkeep | Net/turn | Verdict |",
                          "|---|---|---|---|---|---|---|---|---|---|---|",
                          ...rows.map(r => {
                            const eff = r.netAfterTribute ?? r.net;
                            const marks = (r.nClients > 0 ? " ♛" : "") + (r.suzerain ? " ⚑" : "");
                            const verdict = r.towns === 0 ? "_emergent (dead at start)_" : eff == null ? "—" : eff >= 0 ? "OK (+" + eff + ")" : "**OVER by " + (-eff) + "**";
                            return `| ${name(r.fac)}${marks} | ${r.towns} | ${r.tier ?? "—"} | ${r.incomeFirstLook ?? "—"} | ${r.income} | ${r.wages} | ${r.corruption} | ${r.armyBudget} | ${r.armyUpkeep ?? "—"} | ${eff ?? "—"} | ${verdict} |`;
                          }),
                        ].join("\n");
                        navigator.clipboard?.writeText(md).then(() => pushToast("Balance report copied as markdown — paste into Discord/docs", "info", 4000)).catch(() => {});
                      }}
                      title="Copy the whole overview as a markdown table (worst first) for the mod-team Discord or docs."
                      style={{ background: "none", border: "1px solid rgba(232,200,115,0.4)", color: "#e8c873", borderRadius: 5, padding: "2px 8px", cursor: "pointer", fontSize: "0.72rem" }}>
                      ⧉ copy report
                    </button>
                  )}
                  <input value={armyFacSearch} onChange={(e) => setArmyFacSearch(e.target.value)} placeholder="Search factions…"
                    style={{ marginLeft: "auto", width: 180, background: "rgba(255,255,255,0.07)", color: "#eee", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 6, padding: "3px 8px", fontSize: "0.78rem" }} />
                </div>
                <div style={{ maxHeight: 200, overflow: "auto", background: "rgba(0,0,0,0.3)", borderRadius: 6, padding: 8, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))", gap: 8, alignContent: "start" }}>
                  {facList.length === 0 && <span style={{ color: "#889", fontSize: "0.74rem", gridColumn: "1 / -1" }}>Loading campaign factions…</span>}
                  {facList.map((ff) => {
                    const on = ff === fac;
                    return (
                      <button key={ff} onClick={() => fetchFor(ff)}
                        title={`${((factionDisplayNames && factionDisplayNames[ff]) || ff).replace(/_/g, " ")} — click to analyze`}
                        style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "8px 4px 6px", borderRadius: 8, cursor: "pointer",
                          border: on ? "2px solid #e8c873" : "2px solid transparent",
                          background: on ? "rgba(232,200,115,0.14)" : "rgba(255,255,255,0.03)",
                          opacity: on ? 1 : 0.85, transition: "opacity .12s, background .12s, border-color .12s" }}>
                        <div style={{ width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <FactionIcon iconPath={`faction_icons/${ff}.tga`} alt={ff} size={40} tightCrop modIconsDir={activeIconsDir} />
                        </div>
                        <span style={{ fontSize: "0.66rem", textAlign: "center", textTransform: "capitalize", color: on ? "#f2e3b8" : "#9aa", lineHeight: 1.15, maxWidth: "100%", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{((factionDisplayNames && factionDisplayNames[ff]) || ff).replace(/_/g, " ")}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{ overflow: "auto", padding: "8px 16px" }}>
                {/* ⚖ Balance overview — every faction's verdict (mod-team harness) */}
                {armyOverview && (armyOverview.rows.length > 0 || armyOverview.error) && (
                  <div style={{ marginBottom: 12, padding: "8px 10px", borderRadius: 6, background: "rgba(232,200,115,0.07)", border: "1px solid rgba(232,200,115,0.3)" }}>
                    <div style={{ fontWeight: 700, color: "#e8c873", marginBottom: 4 }}>⚖ Balance overview — turn-1 economy @ optimal taxes vs starting army{armyOverview.busy ? ` (computing ${armyOverview.rows.length}/${facList.length}…)` : ` (${armyOverview.rows.length} factions, worst first)`}</div>
                    {/* 0.9.1096: handler failures used to be dropped silently → 0 rows, no clue why */}
                    {armyOverview.error && <div style={{ color: "#e8a090", fontSize: "0.74rem", marginBottom: 4 }}>⚠ {String(armyOverview.error)}</div>}
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.74rem" }}>
                      <thead><tr style={{ color: "#8aa", textAlign: "left" }}>
                        <th style={{ padding: "0 6px" }}>Faction</th><th>Towns</th><th title="Empire-size tax level from settlement count: 1 = 0-1 · 2 = 2-4 · 3 = 5-8 · 4 = 9-15 · 5 = 16-29 · 6 = 30-50 · 7 = 51-100 · 8 = 101-200 · 9 = 201-400 · 10 = 401+. The sizeN EDB lines (taxable_income_bonus / trade penalties) key on this.">Size</th><th title="Income at FIRST LOOK — the number on the finance scroll the moment the campaign opens, before the script fires the empire_sizeN event (no sizeN EDB line active yet).">Income 1st look</th><th title="Income after the empire-size tax event fires (the steady-state number the rest of this table budgets with).">@ size tax</th><th>Wages</th><th>Corr.</th><th>Army budget</th><th>Army upkeep</th><th>Net/turn</th><th title={armyOverview.prevAt ? `Change vs the previous overview run (${armyOverview.prevAt.slice(0, 16).replace("T", " ")}) — run, edit mod files, run again to see exactly which factions your changes moved.` : "Run the overview again after editing mod files to see per-faction changes here."}>Δ prev</th><th>Verdict</th>
                      </tr></thead>
                      <tbody>
                        {armyOverview.rows.slice().sort((a, b) => ((a.netAfterTribute ?? a.net) ?? 0) - ((b.netAfterTribute ?? b.net) ?? 0)).map((r, i) => {
                          const eff = r.netAfterTribute ?? r.net;
                          return (
                          <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.05)", cursor: "pointer" }} onClick={() => fetchFor(r.fac)} title="Click to open this faction's full setup">
                            <td style={{ padding: "1px 6px", color: "#dde", textTransform: "capitalize" }}>{((factionDisplayNames && factionDisplayNames[r.fac]) || r.fac).replace(/_/g, " ")}
                              {r.nClients > 0 && <span title={`Suzerain of ${r.nClients} protectorate${r.nClients === 1 ? "" : "s"}: receives ≥${r.tributeIn}/turn tribute (50% of each client's profit, from turn 2; conservative floor) — counted in the net column, not in the army budget.`} style={{ color: "#d3a7e8", marginLeft: 4, cursor: "help" }}>♛</span>}
                              {r.suzerain && <span title={`Protectorate of ${r.suzerain}: pays half its profit as tribute every turn from turn 2 (≈${r.tributeOut} at the modeled profit${r.tributeOut === 0 ? " — currently modeled at no profit, so 0" : ""}). Net shown after tribute.`} style={{ color: "#d3a7e8", marginLeft: 4, cursor: "help" }}>⚑</span>}
                            </td>
                            <td style={{ color: "#9aa" }}>{r.towns}</td>
                            <td style={{ color: "#c9b8e8" }} title={`Empire Tax Level ${r.tier ?? "?"} from ${r.towns} settlement${r.towns === 1 ? "" : "s"} (brackets: 0-1 / 2-4 / 5-8 / 9-15 / 16-29 / 30-50 / 51-100 / 101-200 / 201-400 / 401+).`}>{r.tier ?? "—"}</td>
                            <td style={{ color: "#9ab8c9" }} title="Finance scroll at the moment the campaign opens — empire_sizeN event not fired yet.">{r.incomeFirstLook ?? "—"}</td>
                            <td style={{ color: "#9aa" }} title={typeof r.incomeFirstLook === "number" && typeof r.income === "number" ? `Empire-size tax effect: ${r.income - r.incomeFirstLook >= 0 ? "+" : ""}${r.income - r.incomeFirstLook}/turn vs first look.` : undefined}>{r.income}{typeof r.incomeFirstLook === "number" && typeof r.income === "number" && r.income !== r.incomeFirstLook ? <span style={{ color: r.income < r.incomeFirstLook ? "#e8806a" : "#7fd17f", fontSize: "0.85em", marginLeft: 3 }}>{r.income < r.incomeFirstLook ? "▼" : "▲"}{Math.abs(r.income - r.incomeFirstLook)}</span> : null}</td>
                            <td style={{ color: "#9aa" }}>{r.wages}</td>
                            <td style={{ color: "#9aa" }}>{r.corruption}</td>
                            <td style={{ color: "#b8d38f" }}>{r.armyBudget}</td>
                            <td style={{ color: "#cba" }}>{r.armyUpkeep ?? "—"}</td>
                            <td style={{ color: eff == null ? "#778" : eff >= 0 ? "#7fd17f" : "#e8806a", fontWeight: 600 }} title={typeof r.netFirstLook === "number" ? `Net at first look (before the empire-size event): ${r.netFirstLook}.` : undefined}>{eff ?? "—"}</td>
                            <td>{(() => {
                              const pv = armyOverview.prevByFac && armyOverview.prevByFac[r.fac];
                              const prevEff = pv ? (pv.netAfterTribute ?? pv.net) : null;
                              if (prevEff == null || eff == null) return <span style={{ color: "#667" }}>—</span>;
                              const d = eff - prevEff;
                              if (d === 0) return <span style={{ color: "#667" }}>=</span>;
                              return <span style={{ color: d > 0 ? "#7fd17f" : "#e8806a", fontWeight: 600 }} title={`Previous run: ${prevEff} → now ${eff}`}>{d > 0 ? "+" : ""}{d}</span>;
                            })()}</td>
                            <td>{r.towns === 0
                              ? <span style={{ color: "#a9a", fontStyle: "italic" }} title="Dead at campaign start (dead_until_resurrected) — emerges later (civil war); no starting economy to balance.">emergent</span>
                              : eff == null ? <span style={{ color: "#778" }}>—</span> : eff >= 0
                              ? <span style={{ color: "#7fd17f" }}>OK · room +{eff}</span>
                              : <span style={{ color: "#e8806a", fontWeight: 700 }}>OVER by {-eff}</span>}</td>
                          </tr>
                        );})}
                      </tbody>
                    </table>
                    <div style={{ marginTop: 4, fontSize: "0.66rem", color: "#8aa" }}>Income = mod-file model @ each faction's optimal tax plan, in two states: <b>1st look</b> (campaign just opened, empire_sizeN event not fired) → <b>@ size tax</b> (event fired; Size column = tax level from settlement count). Wages/corruption/net budget with the @-size-tax state. Army upkeep = EDU estimate of the seeded descr_strat army (engine charge can deviate ±15%). ♛ receives protectorate tribute · ⚑ pays tribute (50% of profit, from turn 2) — net is after tribute. Click a row for the faction's full plan + trim suggestions.</div>
                  </div>
                )}
                {armySetupBusy && <div style={{ color: "#9aa", fontStyle: "italic" }}>Analyzing…</div>}
                {!d && !armySetupBusy && <div style={{ color: "#9aa", fontStyle: "italic" }}>Pick a faction above.</div>}
                {d && d.error && <div style={{ color: "#e89060" }}>{d.error}</div>}
                {d && !d.error && (<>
                  {/* Budget */}
                  <div style={{ marginBottom: 10, padding: "8px 10px", borderRadius: 6, background: "rgba(207,143,106,0.10)", border: "1px solid rgba(207,143,106,0.35)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <strong style={{ color: "#e7b88f" }}>Budget</strong>
                      <span style={{ fontSize: "0.78rem", color: armyProjIncome.trim() === "" ? "#e8c873" : "#bbb", fontWeight: armyProjIncome.trim() === "" ? 700 : 400 }}>turn-1 income @ optimal taxes (editable):</span>
                      <input type="number" value={armyProjIncome} step={50} placeholder="computing…"
                        onChange={(ev) => setArmyProjIncome(ev.target.value)}
                        title="Auto-filled from the mod-file income model: the sustainable army budget at the optimal tax plan, minus the starting army's estimated upkeep. Editable — override with the game's exact number if you like. The swap/trim suggestions budget against it."
                        style={{ width: 90, background: "rgba(0,0,0,0.4)", color: "#fff", borderRadius: 4, padding: "2px 6px", border: armyProjIncome.trim() === "" ? "2px solid #e8c873" : "1px solid rgba(255,255,255,0.2)" }} />
                      <span style={{ fontSize: "0.78rem", color: "#bbb" }}>floor:</span>
                      <input type="number" value={armyBudgetFloor} step={50}
                        onChange={(ev) => { const v = parseInt(ev.target.value, 10); if (Number.isFinite(v)) setArmyBudgetFloor(v); }}
                        style={{ width: 80, background: "rgba(0,0,0,0.4)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 4, padding: "2px 6px" }} />
                      <span style={{ fontSize: "0.72rem", color: "#8aa" }}>treasury {d.denari ?? "—"} · army upkeep {(armyT1Budget && armyT1Budget.totals && armyT1Budget.faction === fac && typeof armyT1Budget.totals.armyUpkeep === "number" && armyT1Budget.totals.armyUpkeep > 0) ? armyT1Budget.totals.armyUpkeep : d.armyUpkeep}</span>
                    </div>
                    {(() => {
                      const proj = parseInt(armyProjIncome, 10);
                      const hasProj = Number.isFinite(proj);
                      const head = hasProj ? proj - armyBudgetFloor : null;
                      return (
                        <div style={{ marginTop: 6, fontSize: "0.82rem" }}>
                          {hasProj ? (
                            <div style={{ color: head >= 0 ? "#7fd17f" : "#e8705f" }}>
                              Headroom to floor = <b>{head}</b> upkeep {head >= 0 ? "(room to add ~that much)" : "(over budget by " + (-head) + " — trim)"}
                            </div>
                          ) : (
                            <div style={{ color: "#8aa" }}>The budget auto-fills from the mod-file model once the faction analysis finishes.</div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                  {/* 0.9.1096: surface a turn-1 budget failure instead of leaving the
                      panel on "computing…" forever (v0.9.1095: packaged build was
                      missing src/calibSaveOpts.js → handler errored on every
                      calibration-save request and the error was silently dropped). */}
                  {armyT1Budget && armyT1Budget.error && (
                    <div style={{ marginBottom: 10, padding: "8px 10px", borderRadius: 6, background: "rgba(220,90,70,0.10)", border: "1px solid rgba(220,90,70,0.45)", color: "#e8a090", fontSize: "0.78rem" }}>
                      ⚠ <b>Turn-1 budget failed:</b> {String(armyT1Budget.error)}
                      <span style={{ color: "#b08a80" }}> — try detaching the calibration save; if that helps, the save path/parse is the culprit.</span>
                    </div>
                  )}
                  {/* STATIC turn-1 budget @ optimal taxes (2026-06-09) — works with NO save:
                      growth-model optimal brackets + the income model cracked from the mod
                      files (validated vs the 10-faction turn-1 save corpus: median 7%). */}
                  {armyT1Budget && armyT1Budget.totals && armyT1Budget.faction === fac && (() => {
                    const t = armyT1Budget.totals;
                    const BRB = { low: "Low", normal: "Normal", high: "High", very_high: "V.High" };
                    const BRC = { low: "#9fd3ff", normal: "#cfcf8f", high: "#e8b85a", very_high: "#e8806a" };
                    // Prefer the budget's SAVE-AWARE army upkeep (t.armyUpkeep) over the army-setup
                    // panel's no-save formula (d.armyUpkeep) — the save-aware one matches the game.
                    const actualArmy = (typeof t.armyUpkeep === "number" && t.armyUpkeep > 0) ? t.armyUpkeep : ((d && typeof d.armyUpkeep === "number") ? d.armyUpkeep : null);
                    const netAfterArmy = (actualArmy != null) ? t.armyBudget - actualArmy : null;
                    return (
                      <div style={{ marginBottom: 10, padding: "8px 10px", borderRadius: 6, background: "rgba(143,180,110,0.10)", border: "1px solid rgba(143,180,110,0.4)" }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                          <strong style={{ color: "#b8d38f" }}>💰 Turn-1 budget @ optimal taxes</strong>
                          <span style={{ fontSize: "0.7rem", color: "#8aa" }}>{armyT1Budget.saveAware ? "calibration save applied (save governor traits + pops) + mod-file income model" : "computed from the mod files alone (no save)"} · empire size {armyT1Budget.tier} · {armyT1Budget.settlements.length} settlements{typeof t.incomeFirstLook === "number" && t.incomeFirstLook !== t.income ? <span title={`First look = the finance scroll the moment the campaign opens, before the script fires the empire_size${armyT1Budget.tier} event; the size-tax state is what this panel budgets with.`} style={{ color: "#9ab8c9" }}> · income 1st look {t.incomeFirstLook} → @ size tax {t.income}</span> : null}</span>
                          {armyT1Budget.saveWarning && <span style={{ fontSize: "0.7rem", color: "#e0a050" }} title="A calibration save is attached but could not be used — the numbers below are the no-save model.">⚠ {armyT1Budget.saveWarning}</span>}
                          {(() => {
                            // MODEL-vs-LEDGER DIVERGENCE (user 2026-07-02: the Rome +5054-vs-+2699 report;
                            // all-human has modeled H/H since v0.9.1216, so a big gap on the save's OWN
                            // faction now means the mode's optimal-tax plan differs from the rates actually
                            // set in-game (all-human ignores set rates) — point at the 🎮 ledger number.
                            const led = armyT1Budget.saveLedger;
                            if (!(led && led.isPlayer && armyEcoMode === "human" && netAfterArmy != null)) return null;
                            const diff = netAfterArmy - led.net;
                            if (Math.abs(diff) <= Math.max(300, 0.10 * Math.abs(led.net))) return null;
                            return <span style={{ fontSize: "0.7rem", color: "#e8806a", fontWeight: 600 }}
                              title={`This save's campaign is played BY this faction, but the panel is in 🧑 all-human mode, which budgets every faction at its OPTIMAL tax plan and ignores the rates set in-game. Model net ${netAfterArmy} vs the save's own ledger ${led.net}. Switch to 👤 player (Hard) to honor your in-game rates, set the plan's brackets in-game, or take the 🎮 number.`}>
                              ⚠ all-human plan ≠ this campaign's rates (model {netAfterArmy} vs game {led.net}) — 👤 player mode honors them</span>;
                          })()}
                          <input value={armySetSearch} onChange={(e) => setArmySetSearch(e.target.value)} placeholder="Filter settlements…"
                            style={{ marginLeft: "auto", width: 140, background: "rgba(255,255,255,0.07)", color: "#eee", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 5, padding: "2px 7px", fontSize: "0.72rem" }} />
                          <button onClick={() => setArmyProjIncome(String(netAfterArmy != null ? netAfterArmy : t.armyBudget))}
                            title="Fill the Budget box's income field with this estimate (net after the starting army's EDU-estimated upkeep when available, else the gross sustainable-upkeep budget)."
                            style={{ background: "rgba(60,60,60,0.7)", color: "#b8d38f", border: "1px solid #7a9a5a", borderRadius: 5, padding: "2px 8px", cursor: "pointer", fontSize: "0.72rem" }}>
                            use as budget{netAfterArmy != null ? `: ${netAfterArmy}` : `: ${t.armyBudget}`}
                          </button>
                          {armyT1Budget.saveLedger && armyT1Budget.saveLedger.isPlayer && (
                            <button onClick={() => setArmyProjIncome(String(armyT1Budget.saveLedger.net))}
                              title={`The attached save's OWN financial ledger for this faction — the authoritative in-game net (${armyT1Budget.saveLedger.net}/turn) at the rates currently set in the game${armyT1Budget.saveLedger.verified ? " (treasury-verified)" : ""}. The model estimate above is at the RECOMMENDED tax plan instead, so the two legitimately differ; when in doubt, the game's number wins.`}
                              style={{ background: "rgba(60,60,60,0.7)", color: "#9fd3ff", border: "1px solid #5a82a0", borderRadius: 5, padding: "2px 8px", cursor: "pointer", fontSize: "0.72rem" }}>
                              🎮 game says: {armyT1Budget.saveLedger.net} — use
                            </button>
                          )}
                          <button
                            onClick={() => {
                              const BRN = { low: "Low", normal: "Normal", high: "High", very_high: "V.High" };
                              const text = armyT1Budget.settlements.slice()
                                .sort((x, y) => ((x.settlement || x.region) || "").localeCompare((y.settlement || y.region) || ""))
                                .map(x => `${((x.settlement || x.region) || "").replace(/_/g, " ")}: ${BRN[x.optimalBracket] || x.optimalBracket || "?"}${x.borderline ? " (verify)" : ""}`)
                                .join("\n");
                              navigator.clipboard?.writeText(text).then(() => pushToast("Tax plan copied — paste it next to the game and set the brackets", "info", 4000)).catch(() => {});
                            }}
                            title="Copy the settlement → bracket list to the clipboard, for setting taxes in-game."
                            style={{ background: "rgba(60,60,60,0.7)", color: "#9fd3ff", border: "1px solid #5a82a0", borderRadius: 5, padding: "2px 8px", cursor: "pointer", fontSize: "0.72rem" }}>
                            ⧉ copy plan
                          </button>
                        </div>
                        {/* GAME-STYLE Financial Overview (v0.9.1234) — Turn Income / Turn Expenditure like the in-game scroll */}
                        {(() => {
                          const army = (typeof t.armyUpkeep === "number") ? t.armyUpkeep : ((d && typeof d.armyUpkeep === "number") ? d.armyUpkeep : null); // save-aware total (not the army-setup no-save d)
                          const units = (typeof t.armyUnits === "number") ? t.armyUnits : ((d && d.summary && typeof d.summary.totalArmyUnits === "number") ? d.summary.totalArmyUnits : null);
                          const gens = (d && Array.isArray(d.characters)) ? d.characters.length : null;
                          const incTotal = t.income;
                          const corr = t.corruption;
                          const expTotal = t.wages + (army || 0) + corr;
                          const net = incTotal - expTotal;
                          const fmt = (n) => n == null ? "—" : Math.round(n).toLocaleString();
                          const R = "#c0674a", G = "#7fae56"; // red = base (pop), green = modifiers, matching the game tooltip colours
                          const secHdr = (label, val) => (
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "5px 10px", background: "rgba(255,255,255,0.06)", borderBottom: "1px solid rgba(255,255,255,0.14)" }}>
                              <strong style={{ fontSize: "0.92rem", color: "#e8dcc0" }}>{label}</strong>
                              <strong style={{ fontSize: "0.92rem", color: "#e8dcc0", fontVariantNumeric: "tabular-nums" }}>{fmt(val)}</strong>
                            </div>
                          );
                          const row = (name, val, parts) => (
                            <div key={name} style={{ display: "grid", gridTemplateColumns: "120px 1fr 70px", alignItems: "baseline", padding: "3px 10px", borderBottom: "1px solid rgba(255,255,255,0.05)", fontSize: "0.8rem" }}>
                              <span style={{ color: "#cdbfa0", fontWeight: 600 }}>{name}</span>
                              <span style={{ fontSize: "0.67rem", lineHeight: 1.2 }}>{parts}</span>
                              <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: val ? "#eee" : "#778" }}>{fmt(val)}</span>
                            </div>
                          );
                          return (
                            <div style={{ marginTop: 8, borderRadius: 6, overflow: "hidden", border: "1px solid rgba(200,170,110,0.35)", background: "rgba(30,26,18,0.55)" }}
                              title="Turn income & expenditure laid out like the in-game Financial Overview. Values are the model's (denarius-exact vs the game when a calibration save is attached).">
                              {secHdr("Turn Income", incTotal)}
                              {row("Farming", t.farming, <span style={{ color: R }}>Population growth per turn</span>)}
                              {row("Mining", t.mining, <><span style={{ color: R }}>Population growth per turn</span> <span style={{ color: G }}>+ Governor's influence</span></>)}
                              {row("Trade", t.trade, <><span style={{ color: R }}>Population growth per turn</span> <span style={{ color: G }}>+ Governor's influence + Trade routes</span></>)}
                              {row("Merchants", 0, <span style={{ color: R }}>Population growth per turn</span>)}
                              {row("Taxes", t.taxes, <><span style={{ color: R }}>Population growth per turn</span> <span style={{ color: G }}>+ Governor's influence + Tax Rate</span></>)}
                              {row("Other", t.admin, <span style={{ color: R }}>Population growth per turn</span>)}
                              {secHdr("Turn Expenditure", expTotal)}
                              {row("Wages", t.wages, <span style={{ color: "#9a8f78" }}>Generals &amp; Admirals: {gens != null ? gens : "—"}; Agents: 0</span>)}
                              {row("Army upkeep", army, <span style={{ color: "#9a8f78" }}>Units: {units != null ? units : "—"}</span>)}
                              {row("Recruitment", 0, <span style={{ color: "#9a8f78" }}>Units: 0; Agents: 0</span>)}
                              {row("Construction", 0, <span style={{ color: "#9a8f78" }}>Buildings: 0</span>)}
                              {row("Other", corr, <span style={{ color: "#9a8f78" }}>Corruption — distance to capital × income − law</span>)}
                              <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 10px", background: "rgba(255,255,255,0.06)", borderTop: "1px solid rgba(255,255,255,0.16)" }}>
                                <strong style={{ color: "#b8d38f" }}>Net income</strong>
                                <strong style={{ color: net >= 0 ? "#7fd17f" : "#e8806a", fontVariantNumeric: "tabular-nums" }}>{net >= 0 ? "+" : ""}{fmt(net)}</strong>
                              </div>
                            </div>
                          );
                        })()}
                        {netAfterArmy != null && (() => {
                          const room = netAfterArmy - armyBudgetFloor; // floor is the allowed max deficit (e.g. −500)
                          // ARMY-ONLY trim suggestions when over budget: greedily drop the
                          // priciest non-general units until the deficit is covered.
                          let trims = null;
                          if (room < 0 && d.characters) {
                            const units = [];
                            for (const c of d.characters) for (const u of (c.army || [])) {
                              if (/general/i.test(u.unit) || !u.upkeep) continue;
                              units.push({ unit: u.unit, upkeep: u.upkeep, holder: c.name });
                            }
                            units.sort((a, b) => b.upkeep - a.upkeep);
                            let need = -room, take = [];
                            for (const u of units) { if (need <= 0) break; take.push(u); need -= u.upkeep; }
                            const grouped = {};
                            for (const u of take) { const k = u.unit; (grouped[k] = grouped[k] || { n: 0, upkeep: u.upkeep }).n++; }
                            trims = { list: Object.entries(grouped), saves: take.reduce((a, u) => a + u.upkeep, 0), covered: need <= 0 };
                          }
                          return (
                            <div style={{ marginTop: 6, fontSize: "0.88rem", padding: "5px 8px", borderRadius: 4, background: "rgba(0,0,0,0.25)" }}
                              title={`Sustainable army budget ${t.armyBudget} − current starting army ≈${actualArmy} = net ≈${netAfterArmy}. With your deficit floor of ${armyBudgetFloor}, you can add roughly ${room} more upkeep of NEW troops before crossing it.`}>
                              <span style={{ color: "#cdc" }}>− current army ≈<b>{actualArmy}</b> = net ≈<b style={{ color: netAfterArmy >= 0 ? "#7fd17f" : "#e8806a" }}>{netAfterArmy}</b>/turn</span>
                              {room >= 0
                                ? <span style={{ marginLeft: 14, color: "#9fe89f", fontWeight: 700 }}>⚔ room for ≈{room} upkeep of new troops <span style={{ color: "#889", fontSize: "0.7rem", fontWeight: 400 }}>(to the {armyBudgetFloor} floor)</span></span>
                                : <span style={{ marginLeft: 14, color: "#e8806a", fontWeight: 700 }}>⚠ OVER BUDGET by {-room} <span style={{ color: "#889", fontSize: "0.7rem", fontWeight: 400 }}>(vs the {armyBudgetFloor} floor)</span></span>}
                              {trims && trims.list.length > 0 && (
                                <div style={{ marginTop: 4, fontSize: "0.76rem", color: "#e8b08a" }}
                                  title="Greedy suggestion: removes the highest-upkeep non-general units first. Adjust to taste — the goal is the total saved, not these exact units.">
                                  ✂ army-only fix: remove {trims.list.map(([u, g]) => `${g.n}× ${u} (${g.upkeep})`).join(", ")} → saves {trims.saves}/turn{trims.covered ? " ✓ back within budget" : " (still short — deeper cuts needed)"}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.74rem", marginTop: 6 }}>
                          <thead><tr style={{ color: "#8aa", textAlign: "left" }}>
                            <th style={{ fontWeight: 600, padding: "0 6px" }}>Settlement</th><th>Pop</th><th>Growth @ set</th><th>→ Tax</th><th title="Estimated public order at the recommended bracket — risk RANKING (±20), not the exact in-game %. 🔴 likely revolt risk · 🟡 watch · 🟢 fine. Validated on live Julii: flagged all 3 actual revolt-risk towns.">PO @ set</th><th>Tax income</th><th>Farm</th><th title="Trade income (land routes + sea lanes) for this settlement.">Trade</th><th title="Corruption ('Other' expenditure on the settlement scroll) — shown negative/red. Per-town % of gross income (REFIT 2 2026-06-12, linear law). Compare against the in-game scroll to spot miscomputed towns.">Corruption</th><th title="Governor administration income (the settlement scroll's 'Admin' / 'Other' income line): admin% × town gross. Live-decoded 2026-06-11.">Admin</th><th title="Settlement NET income = farms + taxes + trade + admin − corruption — the in-game settlement scroll's 'Net Income' line. Compare directly (e.g. Rome → 4527).">Total</th><th>Dist→cap</th>
                          </tr></thead>
                          <tbody>
                            {armyT1Budget.settlements.slice().filter(s => !armySetSearch.trim() || ((s.settlement || s.region) || "").toLowerCase().includes(armySetSearch.trim().toLowerCase())).sort((a, b) => ((a.settlement || a.region) || "").localeCompare((b.settlement || b.region) || "")).map((s, si) => {
                              const GMOD = { low: 0.5, normal: 0, high: -0.5, very_high: -1 };
                              const atSet = (s.baseGrowthEst != null && s.bracket) ? Math.round((s.baseGrowthEst + (GMOD[s.bracket] || 0)) * 10) / 10 : null;
                              return (
                              <tr key={si} style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                                <td style={{ padding: "1px 6px", color: "#dde", cursor: "help" }}
                                  title={`${(s.settlement || s.region || "").replace(/_/g, " ")}${s.siegeTurns != null ? `\n🏰 Can hold a siege ≈${s.siegeTurns} turns (engine formula: settlement size + walls + governor management).` : ""}${s.plagueRiskPct > 0 ? `\n☠ Random plague risk ≈${s.plagueRiskPct}%/turn (squalor pips > 3; engine formula).` : ""}`}>
                                  {(s.settlement || s.region || "").replace(/_/g, " ")}{s.capital ? " ★" : ""}{s.plagueRiskPct > 0 ? <span style={{ color: "#c79be8" }} title={`Random plague risk ≈${s.plagueRiskPct}%/turn — squalor is over the safe threshold; health buildings reduce it.`}> ☠</span> : null}</td>
                                <td style={{ color: "#9aa" }}>{s.pop}</td>
                                <td style={{ color: (atSet != null && atSet < 0) ? "#e8806a" : "#9aa" }} title={s.baseGrowthEst != null ? `Tax-neutral base growth ${s.baseGrowthEst >= 0 ? "+" : ""}${s.baseGrowthEst}% ${s.bracket ? `+ ${s.bracket} modifier` : ""} — this is what the in-game scroll should read at the recommended bracket.` : undefined}>{atSet != null ? `${atSet >= 0 ? "+" : ""}${atSet}%` : "—"}</td>
                                <td style={{ color: BRC[s.bracket] || "#9aa", fontWeight: 600 }}>{BRB[s.bracket] || s.bracket}{s.borderline && <span title="Borderline growth estimate (right on a bracket boundary) — the true bracket can be one step EITHER way: check the growth scroll in-game and take the highest bracket that keeps growth at 0% or better." style={{ color: "#e8b85a", marginLeft: 3, cursor: "help" }}>⚠</span>}</td>
                                <td style={{ color: ({ red: "#e8806a", orange: "#e8964a", yellow: "#e8964a", lightgreen: "#7fd17f" })[s.poRisk] || "#2f9e44", cursor: "help" }}
                                  title={s.poAtSet != null ? `Public order ≈${s.poAtSet} at the recommended bracket (exact component model: base 100 + garrison + law + happiness + governor influence + health − squalor − distance − culture; julii live validation: 26/26 within ±10pp save-aware, 24/26 no-save).${s.poAtLow != null ? `\nAt Low tax ≈${s.poAtLow}${s.poAtLow < 100 ? " — still risky even at Low → needs more garrison." : ""}` : ""}${s.poAtSet < 130 && s.pop ? `\n⚔ Garrison fix: ≈${Math.max(40, Math.ceil((130 - s.poAtSet) / 350 * s.pop / 10) * 10)} extra men in town ≈ +${130 - s.poAtSet} PO (exact law: garrison% = 5·floor(70·men/pop), 80% cap; men = unit soldiers ×4 at HUGE size).` : ""}` : undefined}>
                                  {s.poAtSet == null ? "—" : <>{s.poRisk === "red" ? "🔴" : (s.poRisk === "orange" || s.poRisk === "yellow") ? "🟠" : "🟢"} {s.poAtSet}{s.poGarrisonAdjust ? <span style={{ color: "#9fb88f", marginLeft: 3, cursor: "help", fontSize: "0.85em" }} title={`Includes ${s.poGarrisonAdjust > 0 ? "+" : ""}${s.poGarrisonAdjust} PO from garrison edits made AFTER the calibration save (save = starting point, descr_strat adds/removes layered on top via the garrison law).`}>✎{s.poGarrisonAdjust > 0 ? "+" : ""}{s.poGarrisonAdjust}</span> : null}{s.garrisonFixMen ? (s.garrisonUnit ? <b style={{ color: "#e8806a", marginLeft: 4, cursor: "help" }} title={`Priority garrison fix: add ${s.garrisonUnit.n}× ${s.garrisonUnit.unit} — the cheapest unit actually recruitable here (${s.garrisonUnit.soldiers} soldiers ⇒ ~${s.garrisonUnit.menPerUnit} men at Huge size). Lifts public order from ${s.poAtSet} to ~${s.garrisonUnit.poAfter}; +${s.garrisonUnit.totalUpkeep}/turn upkeep.`}>⚔ +{s.garrisonUnit.n}× {s.garrisonUnit.unit}</b> : <b style={{ color: "#e8806a", marginLeft: 4, cursor: "help" }} title={`Below the safe band — priority garrison fix: ≈${s.garrisonFixMen} extra soldiers brings PO to ~85. Pick the cheapest unit(s) from this settlement's recruit pool.`}>⚔+{s.garrisonFixMen}m</b>) : s.poRisk === "red" && s.poAtLow != null && s.poAtLow < 100 ? <span style={{ color: "#e8705f", fontWeight: 700 }} title="Estimated to be at revolt risk even at LOW tax — add garrison."> ⚔</span> : null}</>}
                                </td>
                                <td style={{ color: "#e8c873", cursor: s.govIncome ? "help" : "default" }}
                                  title={s.govIncome ? `Governor income traits applied (parsed from descr_strat starting traits + ancillaries, exact-tile binding):${s.govIncome.tax ? `\n  tax ${s.govIncome.tax > 0 ? "+" : ""}${s.govIncome.tax}%` : ""}${s.govIncome.trading ? `\n  trade ${s.govIncome.trading > 0 ? "+" : ""}${s.govIncome.trading}%` : ""}${s.govIncome.mining ? `\n  mining ${s.govIncome.mining > 0 ? "+" : ""}${s.govIncome.mining}%` : ""}\nFrom: ${(s.govIncome.hits || []).join(", ")}` : undefined}>
                                  {s.taxes}{s.taxH != null ? <span style={{ color: "#7fd1c0", fontSize: "0.64rem", cursor: "help" }} title={`Calibrated from your pasted live reading: per-campaign tax multiplier ×${s.taxH.toFixed(2)} applied (live = model × H, the engine's hidden 5%-step campaign roll).`}> {s.taxH === 1 ? "✓" : `×${s.taxH.toFixed(2)}`}</span> : null}{s.govIncome ? <span style={{ color: s.govIncome.tax >= 0 ? "#9fd37f" : "#e8a07a", fontSize: "0.66rem" }}> 👤</span> : null}</td>
                                <td style={{ color: "#9fd37f" }}>{s.farming}</td>
                                <td style={{ color: "#cfd37f" }} title="Trade income (land routes + sea lanes).">{s.trade != null ? Math.round(s.trade) : 0}</td>
                                <td style={{ color: (s.corruption ? "#e8a07a" : "#667"), cursor: s.corruption ? "help" : "default" }} title={s.corruption ? `Corruption ('Other' expenditure on the in-game settlement scroll) ≈−${Math.round(s.corruption)}/turn. Compare against the scroll — a mismatch flags a miscomputed town.` : "No corruption (capital / low-distance / law-suppressed)."}>{s.corruption ? `−${Math.round(s.corruption)}` : "0"}</td>
                                <td style={{ color: (s.admin ? "#d3c89f" : "#667") }} title={s.admin ? `Governor administration income (the scroll's 'Admin'/'Other' income line) ≈+${Math.round(s.admin)}/turn — admin% × town gross.` : "No admin income."}>{s.admin ? Math.round(s.admin) : 0}</td>
                                <td style={{ color: "#9fd3c0", fontWeight: 600 }} title={`Settlement NET income (farms + taxes + trade + admin − corruption) = the in-game scroll's 'Net Income' line${s.corrCalibrated ? " · corruption calibrated to your live paste" : ""}.`}>{s.totalIncome != null ? s.totalIncome : ((s.taxes || 0) + (s.farming || 0) + (s.trade || 0) + (s.admin || 0) - (s.corruption || 0))}</td>
                                <td style={{ color: "#778" }}>{s.distToCapital != null ? s.distToCapital : "—"}</td>
                              </tr>
                            );})}
                          </tbody>
                        </table>
                        <div style={{ marginTop: 5, fontSize: "0.68rem", color: "#8aa" }}>
                          Set each settlement's tax to the "→ Tax" bracket in-game (highest bracket keeping growth ≥ 0), and this is the projected turn-1 economy. Income model validated against the 10-faction turn-1 save corpus (median budget error 7%; trade is the weak term). Trade/mining are faction-level estimates — per-town columns show taxes + farming only. "PO @ set" is a revolt-risk RANKING (±20) for garrison planning — 🔴 towns need garrison or lower tax; ⚔ means risky even at Low.
                        </div>
                        {armyT1Budget.staleWarning && (
                          <div style={{ marginTop: 5, padding: "4px 8px", borderRadius: 4, background: "rgba(232,90,90,0.18)", border: "1px solid rgba(232,90,90,0.55)", fontSize: "0.72rem", color: "#f0a0a0" }}>
                            ⚠ {armyT1Budget.staleWarning}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {/* Per-character army + balance */}
                  {d.characters.map((c, ci) => {
                    const badUp = (c.illegalUpgrades && c.illegalUpgrades.length) || 0;
                    return (
                      <div key={ci} style={{ marginBottom: 8 }}>
                        <div style={{ color: "#dcc", fontWeight: 600, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span>{c.role} {c.name}{c.subFaction ? <span style={{ color: "#b89", fontWeight: 400, fontSize: "0.72rem" }}> (sub-faction {c.subFaction})</span> : null} <span style={{ color: "#8aa", fontWeight: 400, fontSize: "0.74rem" }}>· {c.army.length} units · upkeep {c.upkeep} {c.flags.length ? <span style={{ color: "#e8b85a" }}>· ⚠ {c.flags.join("; ")}</span> : null}</span></span>
                          {badUp > 0 && (
                            <button
                              onClick={async () => {
                                if (!modDataDir) { alert("No mod loaded."); return; }
                                if (!confirm(`Remove illegitimate weapon/armour upgrades from ${c.name}'s army?\n\n${badUp} unit(s) carry upgrades this town can't make (no smith). This sets their weapon_lvl / armour to 0 in descr_strat.txt (backup saved first).`)) return;
                                try {
                                  const r = await window.electronAPI.applyUpgradeFix(modDataDir, d.faction, c.name, { weapon: !d.canWeapon, armour: !d.canArmour });
                                  if (r && r.ok) { pushToast(`Fixed ${r.fixed} upgrade line(s) on ${c.name}`, "info", 6000); fetchFor(d.faction); }
                                  else alert("Fix failed: " + (r?.error || "unknown"));
                                } catch (e) { alert(e?.message || String(e)); }
                              }}
                              title="Zero the weapon/armour upgrades this faction can't produce (no smith)"
                              style={{ background: "#8a6a3a", color: "#fff", border: "1px solid #a07a3a", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: "0.72rem" }}>
                              Fix {badUp} bad upgrade{badUp === 1 ? "" : "s"}
                            </button>
                          )}
                        </div>
                        <div style={{ fontSize: "0.76rem", color: "#cbd", paddingLeft: 8 }}>
                          {c.army.map((u, ui) => {
                            const bad = (u.weapon_lvl > 0 && !d.canWeapon) || (u.armour > 0 && !d.canArmour);
                            return (<span key={ui}>{ui > 0 ? ", " : ""}<span style={{ color: bad ? "#e8a07a" : undefined }}>{u.unit}{(u.weapon_lvl > 0 || u.armour > 0) ? <span style={{ color: bad ? "#e87060" : "#7a9" }}> [{u.weapon_lvl > 0 ? "wpn" + u.weapon_lvl : ""}{u.weapon_lvl > 0 && u.armour > 0 ? " " : ""}{u.armour > 0 ? "arm" + u.armour : ""}]</span> : null}</span>{u.upkeep != null ? <span style={{ color: "#889" }}> ({u.upkeep})</span> : null}</span>);
                          })}
                        </div>
                      </div>
                    );
                  })}
                  {/* Recruitable pool */}
                  {d.settlements.map((s, si) => (
                    <div key={si} style={{ marginTop: 8 }}>
                      <div style={{ color: "#9cc", fontWeight: 600, fontSize: "0.82rem" }}>Recruitable at {s.region} <span style={{ color: "#889", fontWeight: 400 }}>({s.pool.length} units{s.hasSmith ? " · has smith" : " · no smith → no weapon/armour retrain"})</span></div>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.76rem", marginTop: 2 }}>
                        <tbody>
                          {s.pool.filter(u => !/general/.test(u.unit)).map((u, ui) => (
                            <tr key={ui} style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                              <td style={{ padding: "1px 6px", color: "#dde" }}>{u.unit}</td>
                              <td style={{ color: "#9aa", width: 110 }}>{u.category}/{u.cls}</td>
                              <td style={{ color: "#cbb", width: 70, textAlign: "right" }}>{u.upkeep}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                  {/* Swap suggestions */}
                  {(() => {
                    const pool = (d.settlements[0]?.pool || []);
                    const line = pool.filter(u => (u.cls === "heavy" || u.cls === "spearmen") && u.category === "infantry").sort((a, b) => (a.upkeep || 0) - (b.upkeep || 0));
                    // budget from the ENTERED projected income (not the unreliable auto value)
                    const proj = parseInt(armyProjIncome, 10);
                    const hasProj = Number.isFinite(proj);
                    const headroom = hasProj ? proj - armyBudgetFloor : null;
                    // find a skirmisher-heavy character + suggest swapping one skirmisher for a heavier line unit within headroom
                    const sugg = [];
                    let hiddenTrimN = 0, hiddenTrimSave = 0;  // over-garrisoned towns hidden while under budget
                    // PO-risk garrison fixes rank ABOVE the cosmetic unit swaps — a red/orange town is
                    // an actual revolt risk, not a tuning tweak. Pull them from the turn-1 budget rows.
                    const _bset = (armyT1Budget && armyT1Budget.faction === d.faction && armyT1Budget.settlements) || [];
                    for (const bs of _bset) {
                      if (!bs.garrisonUnit || !(bs.poRisk === "red" || bs.poRisk === "orange")) continue;
                      const gu = bs.garrisonUnit;
                      sugg.push({ garrison: true, ok: true, settlement: bs.settlement, garrUnit: gu,
                        text: `🛡 ${bs.settlement}: public order ${bs.poAtSet} (${bs.poRisk === "red" ? "revolt risk" : "shaky"}) — recruit ${gu.n}× ${gu.unit} there → ~${gu.poAfter} (+${gu.totalUpkeep}/turn upkeep).` });
                    }
                    // GARRISON-REPLACE: towns whose STARTING garrison holds units they can no longer
                    // recruit there (mod AOR gating changed) — un-retrainable. Slim to the leanest
                    // recruitable garrison that clears the >70 no-revolt floor.
                    for (const bs of _bset) {
                      const gr = bs.garrisonReplace; if (!gr || !gr.removeUnits || !gr.removeUnits.length) continue;
                      if (gr.noRecruit) {
                        sugg.push({ replace: true, ok: false, noRecruit: true, settlement: bs.settlement, repl: gr,
                          text: `⚠ ${bs.settlement}: ${gr.removeUnits.join(", ")} can't be recruited here${gr.noMil ? " — and there's no military building to recruit any replacement (add a barracks, or drop the unit)" : " — and no infantry is recruitable here"}. Drop → PO ~${gr.poAfter}.` });
                        continue;
                      }
                      if (gr.trim) {
                        // BUDGET-AWARE (user 2026-07-01): an over-provisioned garrison is only worth
                        // trimming when the faction is tight. With headroom to spare, keeping a few
                        // non-essential units is fine — hide the trim, just tally it for a note.
                        if (headroom != null && headroom > 0) { hiddenTrimN++; hiddenTrimSave += Math.max(0, -gr.upkeepDelta); continue; }
                        sugg.push({ replace: true, ok: true, trim: true, settlement: bs.settlement, repl: gr,
                          text: `✂ ${bs.settlement}: over-garrisoned at its optimal tax — drop ${gr.dropCount} excess unit(s)${gr.keepUnits && gr.keepUnits.length ? ` (keep ${gr.keepUnits.join(" + ")})` : ""} → PO ~${gr.poAfter}, save ${-gr.upkeepDelta}/turn.` });
                        continue;
                      }
                      const keep = gr.keepUnits && gr.keepUnits.length ? `, keep ${gr.keepUnits.join(" + ")}` : "";
                      const addStr = (gr.addSummary || []).map(a => `${a.count}× ${a.unit}`).join(" + ");
                      const action = addStr ? `replace with ${addStr}${keep}` : `drop them${keep}`;
                      const reason = gr.monotonous ? `${gr.dropCount} stacked identical units — diversify` : `${gr.dropCount} garrison unit(s) not recruitable here`;
                      sugg.push({ replace: true, ok: true, settlement: bs.settlement, repl: gr,
                        text: `♻ ${bs.settlement}: ${reason} — ${action} → PO ~${gr.poAfter} (${gr.upkeepDelta >= 0 ? "+" : ""}${gr.upkeepDelta}/turn upkeep).` });
                    }
                    for (const c of d.characters) {
                      if (!c.flags.some(f => /skirmisher-heavy|no heavy/.test(f))) continue;
                      const sk = c.army.find(u => { const p = pool.find(x => x.unit.toLowerCase() === u.unit.toLowerCase()); return p && (p.cls === "missile" || p.cls === "skirmish"); });
                      if (!sk) continue;
                      const skUp = (pool.find(x => x.unit.toLowerCase() === sk.unit.toLowerCase()) || {}).upkeep || 0;
                      // prefer a line unit NOT already in this army (diversity), then one that fits the headroom
                      const have = new Set(c.army.map(u => u.unit.toLowerCase()));
                      const fits = headroom == null ? line : line.filter(u => (u.upkeep - skUp) <= headroom);
                      const cand = fits.find(u => !have.has(u.unit.toLowerCase())) || fits[0];
                      if (!cand) continue;
                      const delta = cand.upkeep - skUp;
                      const resultNet = hasProj ? proj - delta : null;
                      const ok = headroom == null || delta <= headroom;
                      sugg.push({ character: c.name, oldUnit: sk.unit, newUnit: cand.unit, ok,
                        text: `In ${c.name}'s army: swap 1× ${sk.unit} (${skUp}) → ${cand.unit} (${cand.upkeep}, ${cand.cls}) — Δ${delta >= 0 ? "+" : ""}${delta} upkeep` + (resultNet != null ? ` → net ${resultNet}${resultNet < armyBudgetFloor ? " (OVER floor!)" : ""}` : " (enter projected income to budget-check)") });
                    }
                    // OVER-BUDGET TRIM: if the entered net is below the floor, suggest a
                    // same-role downgrade to claw back the deficit (keeps the composition;
                    // never downgrades infantry to a skirmisher, so it won't re-unbalance).
                    if (hasProj && proj < armyBudgetFloor) {
                      const need = armyBudgetFloor - proj; // upkeep we must shed
                      for (const c of d.characters) {
                        let best = null;
                        for (const u of c.army) {
                          if (/general/.test(u.unit)) continue;
                          const uu = pool.find(x => x.unit.toLowerCase() === u.unit.toLowerCase());
                          if (!uu || uu.upkeep == null) continue;
                          const cheaper = pool.filter(v => v.category === uu.category && v.unit.toLowerCase() !== u.unit.toLowerCase()
                            && v.upkeep != null && (uu.upkeep - v.upkeep) >= need
                            && (uu.category === "cavalry" || (v.cls !== "missile" && v.cls !== "skirmish")))
                            .sort((a, b) => (uu.upkeep - a.upkeep) - (uu.upkeep - b.upkeep)); // smallest sufficient saving first
                          if (cheaper.length) { const v = cheaper[0]; const save = uu.upkeep - v.upkeep; if (!best || save < best.save) best = { character: c.name, oldUnit: u.unit, newUnit: v.unit, save, net: proj + save }; }
                        }
                        if (best) sugg.push({ character: best.character, oldUnit: best.oldUnit, newUnit: best.newUnit, ok: true, trim: true,
                          text: `TRIM ${best.character}: swap ${best.oldUnit} → ${best.newUnit} — save ${best.save} upkeep → net ${best.net} (back within the floor)` });
                      }
                    }
                    // SPEND HEADROOM (user 2026-07-02): with room to the floor, propose concrete
                    // recruitable spends that USE UP the budget instead of leaving it idle.
                    // Order: composition gaps (no cavalry / no line infantry) → garrison top-ups
                    // for 85–99 PO towns (red/orange already get fixes above) → reinforcement
                    // fill of the smallest armies. The upkeep of the un-applied fixes above is
                    // RESERVED first, so applying every suggestion still lands on the floor side.
                    let spendUsed = 0, spendLeft = null;
                    if (hasProj && headroom != null && headroom > 0) {
                      let remaining = headroom;
                      for (const s of sugg) {
                        if (garrDone.has(s.text)) continue;
                        if (s.garrison && s.garrUnit) remaining -= (s.garrUnit.totalUpkeep || 0);
                        else if (s.replace && s.repl && s.repl.upkeepDelta > 0) remaining -= s.repl.upkeepDelta;
                      }
                      // distinct recruitable units across ALL the faction's settlements — each
                      // settlement pool is already fully RIS-gated, so everything here is a unit
                      // the faction can genuinely recruit somewhere.
                      const cands = []; const seenCand = new Set();
                      for (const st of d.settlements) for (const u of (st.pool || [])) {
                        if (u.upkeep == null || /general|bodyguard|captain/i.test(u.unit)) continue;
                        const k = u.unit.toLowerCase();
                        if (!seenCand.has(k)) { seenCand.add(k); cands.push({ ...u, at: st.region }); }
                      }
                      const byUpAsc = cands.slice().sort((a, b) => a.upkeep - b.upkeep);
                      const byUpDesc = cands.slice().sort((a, b) => b.upkeep - a.upkeep);
                      const cheapest = byUpAsc.length ? byUpAsc[0].upkeep : Infinity;
                      // per-army working state (20-unit engine cap incl. the bodyguard);
                      // admirals excluded — their "army" is the fleet's cargo.
                      const armies = d.characters
                        .filter(c => (c.army || []).length > 0 && c.role !== "admiral")
                        .map(c => { const cnt = {}; for (const u of c.army) { const k = u.unit.toLowerCase(); cnt[k] = (cnt[k] || 0) + 1; } return { c, size: c.army.length, cnt, adds: [], addUp: 0 }; });
                      const planAdd = (a, u) => { a.adds.push(u.unit); a.addUp += u.upkeep; a.size++; const k = u.unit.toLowerCase(); a.cnt[k] = (a.cnt[k] || 0) + 1; remaining -= u.upkeep; };
                      // 1) composition gaps: fix the balance flags first
                      for (const a of armies) {
                        for (const f of a.c.flags || []) {
                          if (a.size >= 20 || remaining < cheapest) break;
                          let pick = null;
                          if (f === "no cavalry") pick = byUpAsc.find(u => u.category === "cavalry" && u.upkeep <= remaining);
                          else if (f === "no heavy/spear line infantry") pick = byUpAsc.find(u => u.category === "infantry" && (u.cls === "heavy" || u.cls === "spearmen") && u.upkeep <= remaining);
                          if (pick) planAdd(a, pick);
                        }
                      }
                      // 2) garrison top-ups: towns modeled at PO 85–99 → push toward 100 with the
                      // town's OWN pool (never cross-region; exact garrison law ΔPO ≈ men·350/pop)
                      const garrSpends = [];
                      for (const bs of _bset) {
                        if (remaining < cheapest) break;
                        if (bs.poAtSet == null || bs.poAtSet < 85 || bs.poAtSet >= 100 || !bs.pop) continue;
                        const st = d.settlements.find(x => x.region === bs.region);
                        const inf = ((st && st.pool) || []).filter(u => u.category === "infantry" && u.upkeep != null && u.soldiers && !/general|bodyguard|captain/i.test(u.unit)).sort((a, b) => a.upkeep - b.upkeep);
                        if (!inf.length) continue;
                        const u = inf[0]; const menPer = u.soldiers * 4;
                        const n = Math.min(3, Math.max(1, Math.ceil((100 - bs.poAtSet) / (menPer * 350 / bs.pop))));
                        if (n * u.upkeep > remaining) continue;
                        const poAfter = Math.min(200, Math.round(bs.poAtSet + n * menPer * 350 / bs.pop));
                        garrSpends.push({ settlement: bs.settlement, adds: Array(n).fill(u.unit), n, unit: u.unit, up: n * u.upkeep, poAfter });
                        remaining -= n * u.upkeep;
                      }
                      // 3) reinforcement fill: smallest armies first, round-robin; quality-first
                      // (highest-upkeep affordable), max 2 copies of a unit per army for diversity
                      let guard = 0;
                      while (remaining >= cheapest && guard++ < 60) {
                        const open = armies.filter(a => a.size < 20).sort((x, y) => x.size - y.size);
                        if (!open.length) break;
                        const a = open[0];
                        const pick = byUpDesc.find(u => u.upkeep <= remaining && (a.cnt[u.unit.toLowerCase()] || 0) < 2)
                          || byUpDesc.find(u => u.upkeep <= remaining);
                        if (!pick) break;
                        planAdd(a, pick);
                      }
                      for (const g of garrSpends) {
                        spendUsed += g.up;
                        sugg.push({ spendGarr: true, ok: true, settlement: g.settlement, addUnits: g.adds,
                          text: `💰 ${g.settlement}: top up the garrison with ${g.n}× ${g.unit} → PO ~${g.poAfter} (+${g.up}/turn upkeep).` });
                      }
                      for (const a of armies) {
                        if (!a.adds.length) continue;
                        const grp = new Map(); for (const u of a.adds) grp.set(u, (grp.get(u) || 0) + 1);
                        const addStr = [...grp.entries()].map(([u, n]) => `${n}× ${u}`).join(" + ");
                        spendUsed += a.addUp;
                        sugg.push({ spendArmy: true, ok: true, character: a.c.name, addUnits: a.adds.slice(),
                          text: `💰 Reinforce ${a.c.name}'s army: add ${addStr} (+${a.addUp}/turn upkeep).` });
                      }
                      if (spendUsed > 0) spendLeft = remaining;
                    }
                    if (!sugg.length && !hiddenTrimN) return null;
                    return (
                      <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 6, background: "rgba(120,170,90,0.10)", border: "1px solid rgba(120,170,90,0.35)" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <strong style={{ color: "#a7d77f" }}>Suggestions</strong>
                          {pendingReload && <button onClick={() => fetchFor(d.faction)} title="Re-read descr_strat and refresh — click when you've finished applying changes" style={{ background: "#5a7b9b", color: "#fff", border: "1px solid #6a8bab", borderRadius: 4, padding: "2px 10px", cursor: "pointer", fontSize: "0.72rem", fontWeight: 600 }}>🔄 Reload{garrDone.size ? ` (${garrDone.size} applied)` : ""}</button>}
                        </div>
                        <div style={{ margin: "6px 0 0", display: "flex", flexDirection: "column", gap: 6 }}>
                          {sugg.map((s, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.8rem" }}>
                              <span style={{ flex: 1, color: garrDone.has(s.text) ? "#6f7f6f" : (s.ok ? "#dfe" : "#e8a07a"), textDecoration: garrDone.has(s.text) ? "line-through" : "none" }}>{s.text}</span>
                              <button
                                onClick={async () => {
                                  if (s.spendArmy || s.spendGarr) {
                                    if (!modDataDir) { alert("No mod loaded."); return; }
                                    const target = s.spendArmy ? `${s.character}'s army` : `${s.settlement}'s garrison`;
                                    if (!confirm(`Add ${s.addUnits.length} unit(s) to ${target} in descr_strat?\n\n(${d.faction}) Adds: ${s.addUnits.join(", ")}.\nWrites the campaign descr_strat.txt (a backup, descr_strat.txt.provincia-bak, is saved first). Reload the mod (🔄) or restart the game to see it.`)) return;
                                    try {
                                      const r = s.spendArmy
                                        ? await window.electronAPI.applyAddArmyUnits(modDataDir, d.faction, s.character, s.addUnits)
                                        : await window.electronAPI.applyReplaceGarrison(modDataDir, d.faction, s.settlement, [], s.addUnits);
                                      if (r && r.ok) { pushToast(`Added ${r.addedCount ?? s.addUnits.length} unit(s) to ${target}${r.capClipped ? " (clipped at the 20-unit cap)" : ""}`, "info", 6000); setPendingReload(true); setGarrDone(prev => new Set(prev).add(s.text)); }
                                      else if (r && /no garrison present|no garrison character/i.test(r.error || "")) pushToast(`No garrison at ${s.settlement} — station a general or captain there first, then re-run.`, "info", 7000);
                                      else alert("Add failed: " + (r?.error || "unknown"));
                                    } catch (e) { alert(e?.message || String(e)); }
                                    return;
                                  }
                                  if (s.replace) {
                                    if (!modDataDir) { alert("No mod loaded."); return; }
                                    const rp = s.repl;
                                    const addStr2 = (rp.addSummary || []).map(a => `${a.count}× ${a.unit}`).join(" + ");
                                    const actMsg = addStr2 ? `Replace ${rp.dropCount} non-recruitable unit(s) at ${s.settlement} with ${addStr2}?` : `Drop ${rp.dropCount} non-recruitable unit(s) at ${s.settlement}?`;
                                    if (!confirm(`${actMsg}\n\n(${d.faction}) Drops: ${rp.removeUnits.join(", ")}.\nWrites the campaign descr_strat.txt (a backup, descr_strat.txt.provincia-bak, is saved first). Reload the mod (🔄) or restart the game to see it.`)) return;
                                    try {
                                      const r = await window.electronAPI.applyReplaceGarrison(modDataDir, d.faction, s.settlement, rp.removeUnits, rp.addUnits);
                                      if (r && r.ok) { pushToast(`Replaced garrison at ${s.settlement} (−${r.removedCount}/+${r.addedCount})`, "info", 6000); setPendingReload(true); setGarrDone(prev => new Set(prev).add(s.text)); }
                                      else alert("Replace failed: " + (r?.error || "unknown"));
                                    } catch (e) { alert(e?.message || String(e)); }
                                    return;
                                  }
                                  if (s.garrison) {
                                    if (!modDataDir) { alert("No mod loaded."); return; }
                                    const gunit = s.garrUnit ? s.garrUnit.unit : null;
                                    if (!gunit) { pushToast("No garrison unit suggested.", "info", 4000); return; }
                                    if (!confirm(`Add 1× ${gunit} to ${s.settlement}'s garrison in descr_strat?\n\n(${d.faction}) Writes the campaign descr_strat.txt (a backup, descr_strat.txt.provincia-bak, is saved first). Reload the mod (🔄) or restart the game to see it.`)) return;
                                    try {
                                      const r = await window.electronAPI.applyAddGarrison(modDataDir, d.faction, s.settlement, gunit);
                                      if (r && r.ok) { pushToast(`Added 1× ${gunit} to ${s.settlement}'s garrison (line ${r.insertedAtLine})`, "info", 6000); setPendingReload(true); setGarrDone(prev => new Set(prev).add(s.text)); }
                                      else if (r && /no garrison present/i.test(r.error || "")) pushToast(`No garrison at ${s.settlement} — station a general or captain there first, then re-run.`, "info", 7000);
                                      else alert("Add garrison failed: " + (r?.error || "unknown"));
                                    } catch (e) { alert(e?.message || String(e)); }
                                    return;
                                  }
                                  if (!modDataDir) { alert("No mod loaded."); return; }
                                  const warn = s.ok ? "" : "\n\n⚠ This swap goes OVER your budget floor — apply anyway?";
                                  if (!confirm(`Apply this swap to descr_strat?\n\nIn ${s.character}'s army (${d.faction}):\n  ${s.oldUnit} → ${s.newUnit}${warn}\n\nWrites the campaign descr_strat.txt (a backup, descr_strat.txt.provincia-bak, is saved first). Reload the mod / restart the game to see it.`)) return;
                                  try {
                                    const r = await window.electronAPI.applyArmySwap(modDataDir, d.faction, s.character, s.oldUnit, s.newUnit);
                                    if (r && r.ok) { pushToast(`Applied: ${s.oldUnit} → ${s.newUnit} (line ${r.changedLine})`, "info", 6000); setPendingReload(true); setGarrDone(prev => new Set(prev).add(s.text)); }
                                    else alert("Swap failed: " + (r?.error || "unknown"));
                                  } catch (e) { alert(e?.message || String(e)); }
                                }}
                                title={garrDone.has(s.text) ? "Applied — click 🔄 Reload when you're done" : (s.ok ? "Write this change to the campaign descr_strat.txt (backup taken first)" : "This swap exceeds your budget floor")}
                                disabled={garrDone.has(s.text)}
                                style={{ flexShrink: 0, background: garrDone.has(s.text) ? "#3a4a3a" : (s.ok ? "#5a9b88" : "#8a6a3a"), color: "#fff", border: "1px solid " + (garrDone.has(s.text) ? "#3a4a3a" : (s.ok ? "#5a9b88" : "#a07a3a")), borderRadius: 4, padding: "3px 10px", cursor: garrDone.has(s.text) ? "default" : "pointer", opacity: garrDone.has(s.text) ? 0.7 : 1, fontSize: "0.76rem", fontWeight: 600 }}>
                                {garrDone.has(s.text) ? "✓ Applied" : ((s.spendArmy || s.spendGarr) ? "Add ➕" : s.replace ? (s.noRecruit ? "Drop ✕" : s.trim ? "Trim ✂" : "Replace ♻") : s.garrison ? "Recruit ↗" : "Apply")}
                              </button>
                            </div>
                          ))}
                        </div>
                        {spendUsed > 0 && <div style={{ marginTop: 8, fontSize: "0.74rem", color: "#9fb88f" }}
                          title={`Headroom ${headroom} − upkeep reserved for the fixes above − the 💰 spend rows = ~${spendLeft} left. Every unit is drawn from the faction's own RIS-gated recruit pools.`}>
                          💰 Spend plan: the 💰 rows add ~<b>{spendUsed}</b>/turn of new troops, using up the budget headroom — ~<b>{spendLeft}</b>/turn would remain above your {armyBudgetFloor} floor after applying everything.</div>}
                        {hiddenTrimN > 0 && <div style={{ marginTop: 8, fontSize: "0.74rem", color: "#9fb88f" }}>✂ {hiddenTrimN} town{hiddenTrimN > 1 ? "s are" : " is"} over-garrisoned (could save ~{hiddenTrimSave}/turn), but you're under budget — keeping the extra garrison is fine.</div>}
                        <div style={{ marginTop: 6, fontSize: "0.7rem", color: "#8aa" }}>Each apply writes to descr_strat (CRLF-safe, backup saved) and marks the row ✓ — the panel does NOT reload per change. Apply as many as you like, then click <b>🔄 Reload</b> above (or restart the game) to refresh.</div>
                      </div>
                    );
                  })()}
                </>)}
              </div>
            </div>
          </div>,
          document.body
        );
}
