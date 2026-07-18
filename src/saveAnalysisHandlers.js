// Save-analysis / economy / army-setup + vision + trade IPC handlers,
// extracted from main.js (2026-07-15). register(ipcMain, deps) wires crack-save,
// get-save-economy, the budget/tax handlers, the apply-* army/garrison editors,
// get-army-setup, vision + trade-network crackers, and scan-saves-timeline. The
// heavy parsers/models are lazy-require()d inside each handler (paths rewritten
// to src-relative); _writeLog + the reassigned lastSaveBuf are injected (the
// latter via a getter). Read handlers are covered by save-fixture harness tests;
// apply-* writers by the mod-sandbox tests. Logic unchanged.
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { Worker } = require("worker_threads");

const CRACK_WORKER_PATH = path.join(__dirname, "saveCrackWorker.js");
const TIMELINE_WORKER_PATH = path.join(__dirname, "timelineRowWorker.js");

function registerSaveAnalysisHandlers(ipcMain, { _writeLog, getLastSaveBuf }) {
  // Run a heavy save crack in a worker thread so it never blocks the Electron
  // main thread (a ~5s synchronous crack froze all IPC/window events). The
  // worker reads the save file itself when given a savePath — keeping the 30-45
  // MB read AND the parse off the main thread — or uses a passed live buffer.
  // It returns the small result object and the crack's own [trade]/[diplo]
  // diagnostics, which we replay into provincia.log. Rejects on worker
  // failure so callers can fall back to a synchronous crack (never a regression).
  const runCrackWorker = (mode, payload) => new Promise((resolve, reject) => {
    let worker;
    try { worker = new Worker(CRACK_WORKER_PATH); }
    catch (e) { reject(e); return; }
    worker.once("message", (msg) => {
      worker.terminate();
      if (msg && Array.isArray(msg.logs)) { for (const line of msg.logs) { try { _writeLog(line); } catch { /* */ } } }
      if (msg && msg.ok) resolve(msg.result);
      else reject(new Error(msg && msg.error ? msg.error : "crack worker failed"));
    });
    worker.once("error", (err) => { worker.terminate(); reject(err); });
    worker.postMessage({ mode, ...payload });
  });

  // The economy and trade-network panels BOTH fire on a save-file change and
  // BOTH need the same tradeOnly crack (~3s). Coalesce it: the first handler to
  // ask spawns ONE "economy" worker (which does the shared tradeOnly crack +
  // Financial Overview and returns { cr, economy }); the other handler awaits the
  // same in-flight promise and reuses `cr`. This is IN-FLIGHT ONLY — the entry is
  // deleted the moment the crack settles — so there is NO persistent cache and
  // therefore no mod-edit staleness risk (the next save load re-cracks fresh).
  // Keyed by (savePath, mtime, size, modDataDir); mtime+size change if the save
  // is rewritten, modDataDir if the mod changes.
  const _inflightCrack = new Map();
  const getSharedEconomyCrack = async (savePath, modDataDir) => {
    const st = await fs.promises.stat(savePath);
    const key = `${savePath}|${st.mtimeMs}|${st.size}|${modDataDir}`;
    let p = _inflightCrack.get(key);
    if (!p) {
      p = runCrackWorker("economy", { savePath, modDataDir });
      _inflightCrack.set(key, p);
      const done = () => { _inflightCrack.delete(key); };
      p.then(done, done);
    }
    return p;
  };

  // Crack + extract ONE timeline row in a worker. Resolves { ok:true, row } or
  // { ok:false, error, file } for a per-save crack failure (mirrors the CLI's
  // per-file try/catch); REJECTS only on worker-infra failure (spawn/'error'),
  // which the caller treats as "fall back to the serial main-thread scan".
  const crackRowInWorker = (savePath, mod, factionOverride) => new Promise((resolve, reject) => {
    let worker;
    try { worker = new Worker(TIMELINE_WORKER_PATH); }
    catch (e) { reject(e); return; }
    worker.once("message", (msg) => { worker.terminate(); resolve(msg || { ok: false, error: "no message", file: path.basename(savePath) }); });
    worker.once("error", (err) => { worker.terminate(); reject(err); });
    worker.postMessage({ savePath, mod, factionOverride });
  });

  // Fan the per-save cracks out across CPU cores (bounded concurrency), so a
  // folder of N saves scans in ~N/cores × the per-save time instead of N× on the
  // frozen main thread. Order doesn't matter — assembleTimeline sorts by turn.
  const crackRowsInParallel = async (files, mod, factionOverride) => {
    const cap = Math.max(1, Math.min(files.length, ((os.cpus() && os.cpus().length) || 4) - 1));
    const rows = [], errors = [];
    let idx = 0;
    const runOne = async () => {
      while (idx < files.length) {
        const f = files[idx++];
        const r = await crackRowInWorker(f, mod, factionOverride); // rejects → propagates → sync fallback
        if (r.ok) rows.push(r.row);
        else errors.push({ file: r.file || path.basename(f), error: r.error });
      }
    };
    await Promise.all(Array.from({ length: cap }, runOne));
    return { rows, errors };
  };

  // Shape a { campaigns, errors, scanned } timeline into the renderer payload
  // (strip internal-only fields, attach per-turn deltas). Same as the serial path.
  const finalizeTimeline = ({ campaigns, errors, scanned }, computeDelta) => {
    // _ownerByCity is KEPT since 2026-07-17 — the timeline player animates
    // ownership per turn from it (~200 small entries/row, negligible payload).
    const strip = (r) => { const { _diplomacy, _family, ...keep } = r; return keep; };
    return {
      scanned,
      errors,
      campaigns: campaigns.map((c) => ({
        player: c.player,
        saves: c.rows.length,
        turns: c.rows.map(strip),
        deltas: c.rows.slice(1).map((r, i) => ({ fromTurn: c.rows[i].turn, toTurn: r.turn, ...computeDelta(c.rows[i], r) })),
      })),
    };
  };


ipcMain.handle("crack-save", async (_event, savePath, modDataDir) => {
  try {
    const { crackSave } = require("./saveCracker.js");
    const buf = await fs.promises.readFile(savePath); // async: saves are 30-45 MB — don't block the event loop on I/O
    const cracked = crackSave(buf, modDataDir);
    // 0.9.860: attach the per-faction Financial Overview breakdown (income by
    // category, expenditure by category, net) read from the stored econ-history
    // KPI block. This is the REAL in-game breakdown (matches the Finance & Family
    // panel to the denarius), not a derivation. Failure is non-fatal — the rest
    // of the crack still returns.
    try {
      const { parseFinancialOverview } = require("./economyParser.js");
      cracked.economy = parseFinancialOverview(buf, cracked);
      const pf = cracked.economy && cracked.economy.playerFaction;
      const pe = pf && cracked.economy.byFaction ? cracked.economy.byFaction[pf] : null;
      if (pe) _writeLog(`[economy] ${pf} income=${pe.income?.total} expend=${pe.expenditure?.total} net=${pe.net} treasury=${pe.treasury}`);
    } catch (e2) { _writeLog(`[economy] parse failed: ${e2 && e2.message}`); }
    return cracked;
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) };
  }
});

// 0.9.860: dedicated Financial Overview IPC. Cracks the save and returns ONLY
// the per-faction economy breakdown (income/expenditure by category, net,
// treasury) read from the stored econ-history KPI block — the REAL in-game
// numbers. Decoupled from the live/calibrate pipelines (which use the lighter
// extras parser) so the economy panel can fetch on-demand per save-file change,
// exactly like the trade-network effect. Returns { error } on failure.
ipcMain.handle("get-save-economy", async (_event, savePath, modDataDir) => {
  try {
    if (!savePath) return { error: "no save path" };
    // Off-main-thread + coalesced: getSharedEconomyCrack runs ONE worker that does
    // the shared tradeOnly crack + Financial Overview; the trade-network handler
    // (which fires on the same save load) reuses that crack instead of re-cracking.
    let economy;
    try {
      economy = (await getSharedEconomyCrack(savePath, modDataDir)).economy;
    } catch (werr) {
      // Fallback: worker unavailable/failed → run synchronously (blocks briefly,
      // but never breaks the panel). Identical to the pre-worker behaviour.
      _writeLog(`[economy] worker fallback (${werr && werr.message}) — running on main thread`);
      const { crackSave } = require("./saveCracker.js");
      const { parseFinancialOverview } = require("./economyParser.js");
      const buf = await fs.promises.readFile(savePath);
      economy = parseFinancialOverview(buf, crackSave(buf, modDataDir, { economyOnly: true }));
    }
    const pf = economy && economy.playerFaction;
    const pe = pf && economy.byFaction ? economy.byFaction[pf] : null;
    if (pe) _writeLog(`[economy] ${path.basename(savePath)} ${pf} income=${pe.income?.total} expend=${pe.expenditure?.total} net=${pe.net} treasury=${pe.treasury}`);
    else _writeLog(`[economy] ${path.basename(savePath)} no player-faction economy (pf=${pf})`);
    return economy;
  } catch (e) {
    _writeLog(`[economy] get-save-economy failed: ${e && e.message}`);
    return { error: e && e.message ? e.message : String(e) };
  }
});

// IPC: the SAVE'S PLAYER faction budget — read from recs[0], the player's econ
// record (the save is centered on the player; verified recs[0]==player net=-536
// on the Gades save). This is the one faction whose projected income we can read
// reliably from a turn-1 save (general faction attribution is ambiguous).
ipcMain.handle("get-save-player-budget", async (_event, savePath) => {
  try {
    if (!savePath) return { error: "no save path" };
    const buf = await fs.promises.readFile(savePath); // async: saves are 30-45 MB — don't block the event loop on I/O
    const x = require("./saveCrackerExtras.js");
    const eco = require("./economyParser.js");
    const recs = x.parseFactionTreasuries(buf);
    if (!Array.isArray(recs) || !recs.length) return { error: "no faction records" };
    const b = eco.readFinancialBlock(buf, recs[0].offset);
    const d = b && eco.decodeFinancialBlock(b);
    if (!d || d.net == null) return { error: "could not decode player econ block" };
    return { net: d.net, taxes: d.income && d.income.taxes, income: d.income && d.income.total, army_upkeep: d.expenditure && d.expenditure.army_upkeep, treasury: recs[0].treasury };
  } catch (e) { return { error: e && e.message ? e.message : String(e) }; }
});

// IPC: ALL factions' projected income from ONE save (cracked 2026-06-07). The
// econ records are in descr_strat faction order with the player swapped to recs[0];
// returns { byFaction:{name:{net,income:{taxes,total},treasury,...}}, player, confidence }.
ipcMain.handle("get-all-faction-budgets", async (_event, savePath, modDataDir, playerHint) => {
  try {
    if (!savePath || !modDataDir) return { error: "savePath + modDataDir required" };
    const buf = await fs.promises.readFile(savePath); // async: saves are 30-45 MB — don't block the event loop on I/O
    const as = require("./armySetup.js");
    const r = as.attributeAllBudgets(buf, modDataDir, playerHint);
    if (r && r.byFaction) _writeLog(`[budgets] ${path.basename(savePath)} player=${r.player} located=${r.playerLocated}${r.hinted ? "(hint)" : ""} confidence=${(r.confidence * 100).toFixed(0)}% (${r.matched}/${r.total})`);
    return r;
  } catch (e) { return { error: e && e.message ? e.message : String(e) }; }
});

// IPC: VIRTUAL TAX-SETTER (2026-06-07) — from ONE turn-2+ save, compute the
// optimal tax bracket per settlement for EVERY faction (highest bracket keeping
// population growth ≥ 0, using RTW's hard-coded flat per-bracket growth modifier:
// low +0.5 / normal 0 / high −0.5 / very_high −1.0), plus an estimated net at
// those taxes. Player settlements use the reliable per-settlement tax byte; AI
// ones can read unset. Returns armySetup.optimalTaxPlan().
ipcMain.handle("get-optimal-taxes", async (_event, savePath, modDataDir, playerHint, economyPath) => {
  try {
    if (!savePath || !modDataDir) return { error: "savePath + modDataDir required" };
    const buf = await fs.promises.readFile(savePath); // async: saves are 30-45 MB — don't block the event loop on I/O
    const as = require("./armySetup.js");
    const { crackSave } = require("./saveCracker.js");
    const cracked = crackSave(buf, modDataDir);
    // USER RULE: turn-2 save = growth ONLY; budget comes from a TURN-1 save.
    let economyBudgets = null;
    if (economyPath && economyPath !== savePath) {
      try { economyBudgets = as.attributeAllBudgets(fs.readFileSync(economyPath), modDataDir, playerHint); }
      catch (e) { _writeLog(`[opt-tax] economy save read failed: ${e && e.message}`); }
    }
    const r = as.optimalTaxPlan(buf, modDataDir, cracked, playerHint, economyBudgets);
    if (r && r.byFaction) {
      const nf = Object.keys(r.byFaction).length;
      const ns = Object.values(r.byFaction).reduce((s, f) => s + (f.totalSettlements || 0), 0);
      _writeLog(`[opt-tax] growth=${path.basename(savePath)} economy=${economyPath ? path.basename(economyPath) : "(same)"} budgetTurn1=${r.budgetTurn1} player=${r.player} located=${r.playerLocated} turnReady=${r.turnReady} factions=${nf} settlements=${ns} dist=low ${r.counts.low}/norm ${r.counts.normal}/high ${r.counts.high}/vhigh ${r.counts.very_high}`);
      if (!r.turnReady) _writeLog(`[opt-tax] WARNING: no growth in save (turn-1?) — optimal-tax plan needs a turn-2+ save`);
    }
    return r;
  } catch (e) { _writeLog(`[opt-tax] failed: ${e && e.message}`); return { error: e && e.message ? e.message : String(e) }; }
});

// IPC: ROUGH strat-only tax plan (2026-06-08) — computes base growth → optimal
// bracket for a faction from descr_strat + descr_regions + EDB ONLY (no save).
// ⚠ ~60% accurate (governor growth/squalor effects + fertility/overcrowding
// coupling are engine-internal and don't decompose from static files — verified).
// The EXACT plan still needs an all-Normal turn-2 save (optimalTaxPlan, 67/67).
ipcMain.handle("get-strat-tax-plan", async (_event, modDataDir, faction, savePath) => {
  try {
    if (!modDataDir) return { error: "modDataDir required" };
    const gm = require("./growthModel.js");
    // If a save is supplied, read the per-settlement marker−1528 development value
    // (settlementFields.growthDevValue) and feed it in → far more accurate save-aware
    // growth (~95% within 0.5% / ~89% bracket, all factions) vs the no-save model (~82%).
    let opts;
    if (savePath && fs.existsSync(savePath)) {
      try {
        const { crackSave } = require("./saveCracker.js");
        const cr = crackSave(await fs.promises.readFile(savePath), modDataDir);
        const growthDevByCity = {};
        const sf = (cr && cr.settlementFields) || {};
        // committed pops from the calibration save → the tax base tracks the actual
        // campaign state (turn-1 saves equal descr_strat; mid-campaign saves diverge).
        const popByCity = {};
        for (const c of Object.keys(sf)) { const pv = sf[c].committedPopulation; if (pv > 0) popByCity[c] = pv; }
        for (const c of Object.keys(sf)) { const g = sf[c].growthDevValue; if (g != null) growthDevByCity[c] = { v1528: g, v1556: sf[c].growthDevValue2 }; }
        // governor trait growth effects (Farming/Fertility/Health) per settlement
        let govEffectByCity = {};
        try {
          const te = require("./traitEffects.js");
          govEffectByCity = te.govEffectByCityFromSave(cr, te.parseTraitEffects(modDataDir), modDataDir);
        } catch (e) { _writeLog(`[strat-tax] governor-trait read failed: ${e && e.message}`); }
        opts = {};
        if (Object.keys(growthDevByCity).length) opts.growthDevByCity = growthDevByCity;
        if (Object.keys(govEffectByCity).length) { opts.govEffectByCity = govEffectByCity; _writeLog(`[strat-tax] ${Object.keys(govEffectByCity).length} governors with growth-affecting traits applied`); }
        if (!Object.keys(opts).length) opts = undefined;
      } catch (e) { _writeLog(`[strat-tax] save read failed (${e && e.message}); using no-save model`); }
    }
    // NO-SAVE governor effects: when there's no loaded save (or its governor read
    // yielded nothing), fall back to the STARTING governors seeded in descr_strat so
    // governor-trait squalor (e.g. Estates) is still applied at game start.
    if (!opts || !opts.govEffectByCity) {
      try {
        const te = require("./traitEffects.js");
        const stratGov = te.govEffectByCityFromStrat(modDataDir, te.parseTraitEffects(modDataDir));
        if (Object.keys(stratGov).length) {
          opts = opts || {};
          opts.govEffectByCity = stratGov;
          _writeLog(`[strat-tax] ${Object.keys(stratGov).length} starting governors (descr_strat) with growth-affecting traits applied (no-save)`);
        }
      } catch (e) { _writeLog(`[strat-tax] strat-governor read failed: ${e && e.message}`); }
    }
    const r = gm.computeStratTaxPlan(modDataDir, faction, opts);
    if (r && r.byFaction) {
      const ns = Object.values(r.byFaction).reduce((s, f) => s + (f.settlements ? f.settlements.length : 0), 0);
      const mode = r.saveAware ? "SAVE-AWARE (marker−1528)" : "no-save EDB model";
      _writeLog(`[strat-tax] ${faction || "(all)"}: ${ns} settlements via ${mode}; est ~${Math.round((r.accuracy?.bracketMatch || 0) * 100)}% exact bracket`);
      r.staleWarning = _modCopyWarning(modDataDir);
      if (r.staleWarning) _writeLog(`[strat-tax] STALE-MOD WARNING: ${r.staleWarning}`);
    }
    return r;
  } catch (e) { _writeLog(`[strat-tax] failed: ${e && e.message}`); return { error: e && e.message ? e.message : String(e) }; }
});

// Stale-mod-copy guard (2026-06-10): the user keeps several RIS copies side by side
// (My Mods/RIS, RIS beta, RIS Classic, …). Analyzing one copy while the game runs a
// newer sibling produced phantom "mechanics" twice in one session. If any SIBLING mod
// folder has a NEWER descr_strat than the selected one, surface a warning string.
function _modCopyWarning(modDataDir) {
  try {
    const rel = path.join("world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
    const mine = path.join(modDataDir, rel);
    if (!fs.existsSync(mine)) return null;
    const myTime = fs.statSync(mine).mtimeMs;
    const modRoot = path.dirname(modDataDir);            // .../My Mods/RIS beta
    const family = path.dirname(modRoot);                 // .../My Mods
    const newer = [];
    const me = path.resolve(modDataDir).toLowerCase();
    for (const sib of fs.readdirSync(family)) {
      const p = path.join(family, sib, "data", rel);
      if (path.resolve(family, sib, "data").toLowerCase() === me || !fs.existsSync(p)) continue;
      if (fs.statSync(p).mtimeMs > myTime + 60 * 1000) newer.push(sib);
    }
    if (!newer.length) return null;
    return `Sibling mod folder(s) ${newer.join(", ")} have a NEWER descr_strat than the selected mod — if your campaign runs one of those, the plan is computed from stale files. Point Provincia at the copy the game actually loads.`;
  } catch { return null; }
}

// IPC: STATIC turn-1 budget @ optimal taxes (2026-06-09) — the no-save Army Setup
// unit budget. Brackets come from the validated growth model (save-aware when a
// save is supplied, pure no-save otherwise); income from src/incomeModel.js — the
// turn-1 income model cracked from mod files (taxes 713/town ×(1+EDB taxable%)
// ×bracketMult, farming 73.5×(farmN+farmLevel), mining 50×mine_resource, trade
// land/sea fit, wages 200×named+50×admiral, corruption 6.43×Σdist-to-capital).
// Validated vs the 10-faction turn-1 corpus: median |budget err| 7%, worst 27%.
// Returns computeTurn1Budget() + per-settlement optimalBracket/growth merged in.
// IPC: per-region mining prospects for the region panel (2026-07-17) — deposit
// list + predicted income per mine level from the cracked mining formula
// (incomeModel.mineProspects; validated to the denarius on live saves).
// IPC: per-region model metrics for the Unrest/Income/Corruption/Growth map
// modes (2026-07-17). Sweeps every faction through the turn-1 budget model
// (income+corruption per settlement) and the population projection (growth+PO).
// ~1-2 min cold on RIS's 239 factions, cached per modDataDir; yields between
// factions so other IPC stays responsive; { busy } while a sweep runs.
let _mapMetricsCache = { key: null, data: null, busy: false };
ipcMain.handle("get-map-mode-metrics", async (_event, modDataDir) => {
  try {
    if (!modDataDir) return { error: "modDataDir required" };
    if (_mapMetricsCache.key === modDataDir && _mapMetricsCache.data) return _mapMetricsCache.data;
    if (_mapMetricsCache.busy) return { busy: true };
    _mapMetricsCache.busy = true;
    const t0 = Date.now();
    const im = require("./incomeModel.js");
    const pp = require("./popProjection.js");
    const ge = require("./growthEval.js");
    const stratPath = path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
    const facList = Object.keys(ge.parseStrat(stratPath) || {});
    const byRegion = {};
    let maxIncome = 1, maxCorr = 1;
    for (const fac of facList) {
      try {
        const b = im.computeTurn1Budget(modDataDir, fac, null, { _noTribute: true });
        for (const s of (b && b.settlements) || []) {
          const e = byRegion[s.region] = byRegion[s.region] || {};
          e.settlement = s.settlement; e.faction = fac;
          e.income = s.totalIncome; e.corruption = s.corruption;
          if (s.totalIncome > maxIncome) maxIncome = s.totalIncome;
          if (s.corruption > maxCorr) maxCorr = s.corruption;
        }
      } catch { /* faction fails → its regions stay dark */ }
      try {
        const p = pp.projectPopulation(modDataDir, fac, 1);
        for (const s of (p && p.settlements) || []) {
          const e = byRegion[s.region] = byRegion[s.region] || {};
          e.growth = s.growthPctPerTurn; e.po = s.po;
        }
      } catch { /* ditto */ }
      await new Promise((r) => setImmediate(r));
    }
    const data = { byRegion, maxIncome, maxCorr, factions: facList.length, ms: Date.now() - t0 };
    _mapMetricsCache = { key: modDataDir, data, busy: false };
    _writeLog(`[map-metrics] swept ${facList.length} factions, ${Object.keys(byRegion).length} regions in ${data.ms}ms`);
    return data;
  } catch (e) {
    _mapMetricsCache.busy = false;
    return { error: e && e.message ? e.message : "map metrics failed" };
  }
});

// IPC: sea-trade lanes with flow values (2026-07-17) — Trade Lanes map mode.
ipcMain.handle("get-trade-lanes", async (_event, modDataDir) => {
  try {
    if (!modDataDir) return { error: "modDataDir required" };
    const im = require("./incomeModel.js");
    const flow = im.seaFlowPtsByLane(modDataDir);
    const goods = im.seaLaneGoods(modDataDir); // "X>Y" -> [{good, qty, value}]
    const values = im.seaLaneValues(modDataDir); // "X>Y" -> export denarii
    const lanes = Object.entries(flow).map(([k, v]) => {
      const gt = k.indexOf(">");
      return { from: k.slice(0, gt), to: k.slice(gt + 1), flow: +v || 0, goods: goods[k] || [], value: Math.round(values[k] || 0) };
    });
    // Land-trade pairs (road inspector): directed {from,to,goods,value}.
    const land = im.landLaneData(modDataDir);
    const landLanes = Object.keys({ ...land.values, ...land.goods }).map((k) => {
      const gt = k.indexOf(">");
      return { from: k.slice(0, gt), to: k.slice(gt + 1), goods: land.goods[k] || [], value: Math.round(land.values[k] || 0) };
    });
    // region -> settlement display name (descr_regions: region on col-0 line,
    // settlement on the next indented line), for the map's lane inspector.
    const names = {};
    try {
      const fsx = require("fs"), px = require("path");
      const rt = fsx.readFileSync(px.join(modDataDir, "world", "maps", "base", "descr_regions.txt"), "latin1").split(/\r?\n/);
      for (let i = 0; i < rt.length; i++) {
        if (/^\S/.test(rt[i]) && rt[i + 1] && /^\s/.test(rt[i + 1])) names[rt[i].trim()] = rt[i + 1].trim().replace(/_/g, " ");
      }
    } catch { /* names optional */ }
    return { lanes, names, landLanes };
  } catch (e) {
    return { error: e && e.message ? e.message : "trade lanes failed" };
  }
});

// IPC: regions whose settlement has a built road (hinterland_roads chain).
// Trade Lanes draws land roads only between road-having settlements — a region
// with no roads (e.g. Pluvium/Corsicosardinia at start) shows no road segment,
// matching the game (2026-07-19). Parsed from the mod's own descr_strat so it
// matches the RIS regions the rest of the trade-lane code uses.
ipcMain.handle("get-road-regions", async (_event, modDataDir) => {
  try {
    if (!modDataDir) return { error: "modDataDir required" };
    const gv = require("./growthEval.js");
    const strat = gv.parseStrat(require("path").join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"));
    const regions = [];
    for (const f of Object.values(strat || {})) for (const sd of (f.settlements || [])) {
      if (sd.region && (sd.buildings || []).some((b) => /hinterland_roads/i.test(b.chain || ""))) regions.push(sd.region);
    }
    return { regions };
  } catch (e) {
    return { error: e && e.message ? e.message : "road regions failed" };
  }
});

// IPC: region adjacency graph (2026-07-17) — for the Threat/Reach map modes.
// Sets → arrays for IPC. Cached inside incomeModel per modDataDir.
ipcMain.handle("get-region-adjacency", async (_event, modDataDir) => {
  try {
    if (!modDataDir) return { error: "modDataDir required" };
    const adj = require("./incomeModel.js").regionAdjacency(modDataDir);
    const out = {};
    for (const k of Object.keys(adj)) out[k] = [...adj[k]];
    return { adjacency: out };
  } catch (e) {
    return { error: e && e.message ? e.message : "adjacency failed" };
  }
});

ipcMain.handle("get-mine-prospects", async (_event, modDataDir) => {
  try {
    if (!modDataDir) return { error: "modDataDir required" };
    return { prospects: require("./incomeModel.js").mineProspects(modDataDir) };
  } catch (e) {
    return { error: e && e.message ? e.message : "mine prospects failed" };
  }
});

ipcMain.handle("get-turn1-budget", async (_event, modDataDir, faction, savePath, asAI, taxH, corr, humanDifficulty) => {
  try {
    if (!modDataDir || !faction) return { error: "modDataDir + faction required" };
    const gm = require("./growthModel.js");
    const te = require("./traitEffects.js");
    const im = require("./incomeModel.js");
    // 1. optimal brackets from the growth model (same path as get-strat-tax-plan).
    // Calibration-save assembly extracted to src/calibSaveOpts.js (2026-06-12,
    // testable). PO anchor: live-verified 2026-06-11 — the save's publicOrder
    // field equals the in-game % exactly (Camerinum 125 / Croton 85 / Rome 210).
    // growthDevByCity (save-aware dev growth) is deliberately NOT passed for
    // bracket planning: it reproduces THIS turn's growth tick, which embeds the
    // harvest roll and seasonal/transient dips (live 2026-06-11: a julii turn with
    // every town at −0.5% @normal dragged the whole plan to low). Brackets come
    // from the no-save model baseline (validated 26/26 vs live turn-1 panels);
    // the calibration save contributes the rolled TRAITS + committed POPS (and
    // the exact PO anchor).
    let opts;
    let poAnchorByCity = null; // { city: { po, bracket } } — EXACT stored PO from the calibration save
    let setBracketByCity = null; // { city: bracket } — the rate the PLAYER SET in-game (save)
    let saveApplied = false, saveError = null;
    if (savePath) {
      const cs = require("./calibSaveOpts.js").buildCalibSaveOpts(modDataDir, savePath);
      opts = cs.opts || undefined;
      poAnchorByCity = cs.poAnchorByCity;
      setBracketByCity = cs.setBracketByCity || null;
      saveApplied = cs.saveApplied; saveError = cs.saveError;
      const saveBn = String(savePath).split(/[\\/]/).pop();
      if (saveError) _writeLog(`[turn1-budget] calibration-save issue (${saveError})${saveApplied ? "" : "; using no-save model"}`);
      if (saveApplied) _writeLog(`[turn1-budget] calibration save applied: "${saveBn}" → ${cs.counts.governors} governors, ${cs.counts.pops} pops, ${cs.counts.poAnchors} PO anchors`);
    }
    if (!opts || !opts.govEffectByCity) {
      try {
        const stratGov = te.govEffectByCityFromStrat(modDataDir, te.parseTraitEffects(modDataDir));
        if (Object.keys(stratGov).length) { opts = opts || {}; opts.govEffectByCity = stratGov; }
      } catch {}
    }
    const plan = gm.computeStratTaxPlan(modDataDir, faction, opts);
    const pf = plan && plan.byFaction && plan.byFaction[String(faction).toLowerCase()];
    const bracketByCity = {};
    const growthBySettlement = {};
    if (pf && pf.settlements) for (const s of pf.settlements) {
      const key = s.settlement || s.region;
      if (key && s.optimalBracket) bracketByCity[key] = s.optimalBracket;
      // NOTE (income-goal session): deliberately NO PO-based bracket downgrade here —
      // the team's remedy for low-PO towns is garrison-first (keep the tax bracket,
      // add units: the ⚔+N suggestion), per the live Neapolis decision 2026-06-11.
      growthBySettlement[key] = { optimalBracket: s.optimalBracket, baseGrowthEst: s.baseGrowthEst, borderline: s.borderline };
    }
    // SAVE-SET BRACKETS WIN (2026-06-14): when a calibration save is attached it knows
    // the rate the player actually set per town — show THAT, not the app's "optimal"
    // guess, so save-attached taxes match the game (only the ±5% hidden H roll remains,
    // closed by the optional paste). Falls back to optimal where the save lacks a rate.
    // BRACKET DIAGNOSTIC (2026-06-14): before merging, snapshot the optimal so the log
    // can show, per town, optimal→saveSet→final and flag every override. This is the
    // line that tells us at a glance whether the panel is showing the app's recommended
    // bracket or the rate baked into the attached save (a fresh turn-1 save is all
    // 'normal', which silently overrode the very_high Rome recommendation → 877 not 1318).
    const optimalSnapshot = { ...bracketByCity };
    // DISPLAY THE PLAN, NOT THE FRESH-SAVE DEFAULT (2026-06-15, v0.9.1119). Provincia
    // is a turn-1 PLANNER: the panel must show "set these rates → get this budget", so
    // the displayed per-town bracket AND the income are computed at the RECOMMENDED
    // (optimal) bracket. A calibration save taken at campaign start is all default
    // 'normal' (rates unset) — that default must NOT replace the recommendation, or
    // every town shows Normal and the plan disappears (the v1118 bug: all-normal 9266;
    // and the v1115 gate's asymmetry, which kept the HIGH recs but forced the LOW recs
    // back to normal → a −0.5% town wrongly showed Normal instead of Low, and the
    // faction read 11175). So: optimal drives the display; ONLY a bracket the player
    // ACTIVELY changed from the default (save bracket !== 'normal') overrides it — a
    // deliberate in-game choice the app should respect over its own recommendation.
    // live julii4: pure optimal {vhigh:5 high:1 low:15 norm:5} → taxes 9398, which the
    // game reproduces once those rates are set (the 9215 screenshot was pre-plan).
    // ALL-HUMAN balance mode (humanDifficulty set — "hard" since 2026-07-02, was "normal")
    // measures every faction at its 0-growth-OPTIMAL taxes, so it must NOT honor save-set
    // brackets — with a save attached those are the OTHER factions' AI-set (often Low-for-
    // growth) choices, not the optimal the harness is comparing (this was reading Rome at
    // AI-Low taxes 6810 vs optimal 10465).
    // Other modes keep a player's deliberate in-game tax choice (a non-default save bracket).
    if (setBracketByCity && !humanDifficulty) for (const c of Object.keys(setBracketByCity)) {
      if (setBracketByCity[c] && setBracketByCity[c] !== "normal") bracketByCity[c] = setBracketByCity[c];
    }
    if (pf && pf.settlements) {
      const BR = { low: "low", normal: "norm", high: "high", very_high: "vhigh" };
      const overrides = [];
      const finalDist = {};
      for (const s of pf.settlements) {
        const k = s.settlement || s.region;
        const fin = bracketByCity[k] || "normal";
        finalDist[BR[fin] || fin] = (finalDist[BR[fin] || fin] || 0) + 1;
        const opt = optimalSnapshot[k], set = setBracketByCity && setBracketByCity[k];
        // only an ACTIVELY-set (non-normal) save bracket actually overrides the rec
        if (set && set !== "normal" && opt && set !== opt) overrides.push(`${k}: optimal=${BR[opt] || opt}→player-set=${BR[set] || set}`);
      }
      const distStr = Object.entries(finalDist).map(([b, n]) => `${b}:${n}`).join(" ");
      _writeLog(`[turn1-budget] ${faction}: final brackets {${distStr}} | source=${setBracketByCity ? "OPTIMAL plan (player-set rates override)" : "OPTIMAL (no save)"}`);
      if (overrides.length) _writeLog(`[turn1-budget] ${faction}: save overrode optimal for ${overrides.length} towns → ${overrides.slice(0, 8).join(" | ")}${overrides.length > 8 ? ` | …+${overrides.length - 8}` : ""}`);
    }
    // 2. static income model at those brackets. When a CALIBRATION SAVE is provided,
    // its world-wide governor traits (incl. start-randomized personalities) replace
    // the descr_strat seeds for income too — opts.govEffectByCity came from the
    // save-aware path above.
    // PER-CAMPAIGN TAX CALIBRATION (H lock, 2026-06-12): taxH = { settlement:
    // { h } } from the renderer's pasted live tax readings (persisted per
    // modDir+faction). live = model × H, H quantized 0.05 — see src/taxCalib.js.
    const nTaxH = taxH && typeof taxH === "object" ? Object.keys(taxH).length : 0;
    if (nTaxH) _writeLog(`[turn1-budget] ${faction}: tax calibration applied for ${nTaxH} towns (per-campaign H lock)`);
    // PER-TOWN CORRUPTION CALIBRATION (2026-06-14): corr = { settlement: { corr } }
    // from the renderer's pasted live corruption — reproduced EXACTLY (road/pathfinding
    // distance isn't file-recoverable, but corruption is deterministic per files).
    const nCorr = corr && typeof corr === "object" ? Object.keys(corr).length : 0;
    if (nCorr) _writeLog(`[turn1-budget] ${faction}: corruption calibration applied for ${nCorr} towns`);
    const budget = im.computeTurn1Budget(modDataDir, faction, bracketByCity,
      { ...(opts && opts.govEffectByCity ? { govEffectByCity: opts.govEffectByCity } : {}),
        ...(opts && opts.popByCity ? { popByCity: opts.popByCity } : {}),
        // FIX 2026-07-08: forward the save's real bodyguard sizes so army upkeep is save-aware
        // (denarius-exact). Previously dropped here → the budget always used the no-save formula
        // even with a calibration save attached (army read ~170 low).
        ...(opts && opts.bodyguardUnitsByFaction ? { bodyguardUnitsByFaction: opts.bodyguardUnitsByFaction } : {}),
        ...(opts && opts.cultPenByCity ? { cultPenByCity: opts.cultPenByCity } : {}),
        ...(nTaxH ? { taxHByCity: taxH } : {}),
        ...(nCorr ? { corrByCity: corr } : {}),
        ...(asAI ? { asAI: true, isPlayer: false } : (humanDifficulty ? { humanDifficulty } : {})) });
    if (budget && !budget.error) budget.asAI = !!asAI;
    if (budget && !budget.error) {
      for (const s of budget.settlements) {
        const g = growthBySettlement[s.settlement] || growthBySettlement[s.region];
        if (g) { s.optimalBracket = g.optimalBracket; s.baseGrowthEst = g.baseGrowthEst; s.borderline = g.borderline; }
      }
      // SAVE-AWARE FLAG FIX (2026-06-12): was !!(plan && plan.saveAware) — but
      // plan.saveAware means "growth-dev values used", which has been deliberately
      // FALSE for bracket planning since the 2026-06-11 decoupling, so the budget
      // header claimed "(no save)" forever even though the save's governor traits
      // + committed pops WERE driving the numbers. The flag now reflects actual
      // calibration-save usage; saveWarning surfaces silent crack failures.
      budget.saveAware = saveApplied;
      if (savePath && !saveApplied) budget.saveWarning = "calibration save NOT applied" + (saveError ? ` — ${saveError}` : "");
      budget.growthAccuracy = plan && plan.accuracy;
      // public-order: EXACT anchor from the calibration save when present (stored PO is
      // the in-game % verbatim; bracket deltas rel. to low = 0/−30/−50/−70, live-verified
      // on the Croton/Sena full sweeps 2026-06-11); EXACT COMPONENT MODEL as fallback
      // (cracked 2026-06-12: julii 26-panel corpus — save-aware 26/26 within ±10pp
      // MAE 2.3pp, no-save 24/26 MAE 4.8pp; egypt 80-town component validation).
      try {
        const po = require("./poModel.js").computeStartingPO(modDataDir, faction,
          opts && opts.govEffectByCity ? { govEffectByCity: opts.govEffectByCity } : {});
        const POD = { low: 0, normal: -30, high: -50, very_high: -70 };
        let flagged = 0, exactN = 0;
        // Garrison-fix unit recommender: the cheapest GATED garrison-infantry unit (full RIS
        // recruitability via poolForSettlement — never bypass it) that covers a town's men-gap to
        // PO 85. men/unit = EDU soldiers ×4 (HUGE size, matching the garrison law). Shared cache so
        // EDB/EDU/descr_regions parse once for the whole faction, not once per town.
        const _garrCache = {};
        const _recommendGarrisonUnit = (buildings, regionName, menGap) => {
          const rp = require("./recruitPool.js");
          const pool = rp.poolForSettlement(modDataDir, faction, buildings, regionName, _garrCache);
          if (!pool || !pool.length) return null;
          const us = rp.parseUnitStats(modDataDir) || {};
          const cands = pool.map(u => ({ unit: u.unit, upkeep: u.upkeep, category: u.category, soldiers: (us[u.unit.toLowerCase()] || {}).soldiers }))
            .filter(u => u.category === "infantry" && u.soldiers && u.upkeep != null && !/general|bodyguard|captain/i.test(u.unit))
            .sort((a, b) => (a.upkeep - b.upkeep) || ((b.soldiers || 0) - (a.soldiers || 0)));
          if (!cands.length) return null;
          const best = cands[0], menPerUnit = best.soldiers * 4;
          const n = Math.max(1, Math.round(menGap / menPerUnit));  // round (not ceil): 1 unit that lands near the band is "good enough"
          return { unit: best.unit, n, soldiers: best.soldiers, menPerUnit, upkeep: best.upkeep, totalUpkeep: n * best.upkeep };
        };
        // GARRISON-REPLACE (slim-to-minimum). A town's STARTING garrison can hold units it can no
        // longer recruit there (mod AOR gating changed) — they can't be retrained. Suggest the
        // leanest RECRUITABLE garrison that keeps PO above the user's no-revolt floor (>70, set
        // 2026-07-01 from the live Neapolis read — NOT the 85 comfort band; 73 is "above 70 so
        // fine"): drop the non-recruitable units, keep the bodyguard + any recruitable ones, add
        // the fewest of a role-matched (dominant dropped cls) recruitable infantry to clear it.
        // Garrison law: PO% = 5·min(16, floor(70·men/pop)); men = EDU soldiers ×4 (HUGE), 80% cap.
        const _armySetup = require("./armySetup.js");
        const FLOOR_PO = 70;
        let _descrText = null, _regionToCity = {};
        try { _descrText = fs.readFileSync(_armySetup.findDescrStrat(modDataDir), "latin1"); } catch { }
        try { const dg = require("./descrStratGeneral.js"); _regionToCity = (dg.parseDescrRegions(fs.readFileSync(path.join(modDataDir, "world", "maps", "base", "descr_regions.txt"), "utf8")) || {}).regionToCity || {}; } catch { }
        const _menOf = (u, us) => ((us[String(u).toLowerCase()] || {}).soldiers || 0) * 4;
        const _garrPts = (men, pop) => Math.min(16, Math.floor(70 * men / pop));
        const _recommendGarrisonReplace = (s, prow) => {
          if (!_descrText || !prow || !prow.rows || !prow.rows.pop) return null;
          const rp = require("./recruitPool.js");
          const garr = _armySetup.getGarrisonUnits(_descrText, faction, s.settlement, _regionToCity);
          if (garr.length < 2) return null;                  // need bodyguard + ≥1 unit
          const pool = rp.poolForSettlement(modDataDir, faction, s.buildings, s.region, _garrCache) || [];
          const us = rp.parseUnitStats(modDataDir) || {};
          const poolSet = new Set(pool.map(u => u.unit.toLowerCase()));
          const rest = garr.slice(1);                        // [0] = general's bodyguard (kept)
          const nonRecruit = rest.filter(u => !poolSet.has(u.toLowerCase()));
          // MONOTONY (user 2026-07-01): a garrison stacked with ≥3 of ONE unit is rebuilt into a
          // diversified set even when every unit is recruitable (e.g. Paestum's 7× roman leves).
          const dupCount = {}; rest.forEach(u => { const k = u.toLowerCase(); dupCount[k] = (dupCount[k] || 0) + 1; });
          const monotonous = Object.values(dupCount).reduce((a, b) => Math.max(a, b), 0) >= 3;
          const pop = prow.rows.pop;
          const base = (s.poAtSet != null ? s.poAtSet : prow.poAt.normal) - prow.rows.garrison;
          const needPts = Math.max(0, Math.min(16, Math.ceil((FLOOR_PO + 1 - base) / 5)));
          const minMen = Math.ceil(needPts * pop / 70);
          const bgMen = prow.rows.men - rest.reduce((a, u) => a + _menOf(u, us), 0);
          // TRIM (user 2026-07-01): fully-recruitable, non-monotonous, but OVER-garrisoned at the
          // town's optimal ("perfect") tax — s.poAtSet already reflects it (a low-growth town gets a
          // LOW bracket → high PO → few units needed). Keep the cheapest units up to the men floor
          // (min 1), suggest dropping the rest. Nothing added.
          if (!nonRecruit.length && !monotonous) {
            // Only trim a town whose BASE public order (at its optimal tax, WITHOUT any garrison)
            // already holds above the no-revolt floor — i.e. genuinely over-provisioned. A town at or
            // below the floor (e.g. Paestum at V.High: base −15, only reaching PO 70 via the capped
            // garrison) is NOT over-garrisoned — it needs every unit (or a tax cut). Never trim it.
            if (base <= FLOOR_PO) return null;
            const items = rest.map((u, idx) => ({ u, idx, up: (us[u.toLowerCase()] || {}).upkeep || 0, m: _menOf(u, us) })).sort((a, b) => a.up - b.up);
            const keepIdx = new Set(); let tmen = bgMen;
            for (const it of items) { if (tmen >= minMen && keepIdx.size >= 1) break; keepIdx.add(it.idx); tmen += it.m; }
            const dropItems = items.filter(it => !keepIdx.has(it.idx));
            if (!dropItems.length) return null;  // sized right — nothing to trim
            const keepUnits = rest.filter((_, idx) => keepIdx.has(idx));
            const finalMenT = bgMen + [...keepIdx].reduce((a, idx) => a + _menOf(rest[idx], us), 0);
            const poAfterT = Math.max(0, Math.min(200, Math.round(base + 5 * _garrPts(finalMenT, pop))));
            return { removeUnits: dropItems.map(it => it.u), addUnits: [], addSummary: [], trim: true, dropCount: dropItems.length, keepUnits, poAfter: poAfterT, upkeepDelta: -dropItems.reduce((a, it) => a + it.up, 0) };
          }
          const toDrop = monotonous ? rest.slice() : nonRecruit;  // rebuild all non-bodyguard when monotonous
          const keptRecruit = monotonous ? [] : rest.filter(u => poolSet.has(u.toLowerCase()));
          const keptMen = bgMen + keptRecruit.reduce((a, u) => a + _menOf(u, us), 0);
          const gapMen = Math.max(0, minMen - keptMen);
          const clsCount = {};
          toDrop.forEach(u => { const c = (us[u.toLowerCase()] || {}).cls; if (c) clsCount[c] = (clsCount[c] || 0) + 1; });
          const domCls = Object.keys(clsCount).sort((a, b) => clsCount[b] - clsCount[a])[0];
          const inf = pool.filter(u => u.category === "infantry" && !/general|bodyguard|captain/i.test(u.unit));
          if (!inf.length) {
            // No recruitable infantry here — an EMPTY pool (no military building) or a cavalry-only
            // pool. Can't offer a replacement, but still FLAG the town so the audit surfaces EVERY
            // settlement with an un-retrainable garrison (user 2026-07-01: "check all settlements").
            const dropUp0 = toDrop.reduce((a, u) => a + ((us[u.toLowerCase()] || {}).upkeep || 0), 0);
            const poAfter0 = Math.max(0, Math.min(200, Math.round(base + 5 * _garrPts(keptMen, pop))));
            const noMil = !(s.buildings || []).some(b => /military_industrial_complex|mic_\d|(^|[:\s])garrison([:\s]|$)/i.test(String(b)));
            return { removeUnits: toDrop, addUnits: [], addSummary: [], noRecruit: true, noMil, dropCount: toDrop.length, keepUnits: keptRecruit, monotonous, poAfter: poAfter0, upkeepDelta: -dropUp0 };
          }
          // DIVERSIFIED replacement (user 2026-07-01: "don't want 7 of the same unit"): round-robin
          // across the DISTINCT recruitable infantry — dominant dropped cls first, then cheapest —
          // adding one at a time until the garrison clears the men floor; always keep ≥1 unit.
          const candidates = inf.slice().sort((a, b) => ((a.cls === domCls ? 0 : 1) - (b.cls === domCls ? 0 : 1)) || ((a.upkeep || 0) - (b.upkeep || 0)));
          const addUnits = [];
          let men = keptMen, gi = 0;
          while ((men < minMen || (!addUnits.length && !keptRecruit.length)) && addUnits.length < 40) {
            const u = candidates[gi % candidates.length];
            addUnits.push(u.unit);
            men += _menOf(u.unit, us);
            gi++;
          }
          const finalMen = keptMen + addUnits.reduce((a, u) => a + _menOf(u, us), 0);
          const poAfter = Math.max(0, Math.min(200, Math.round(base + 5 * _garrPts(finalMen, pop))));
          const dropUp = toDrop.reduce((a, u) => a + ((us[u.toLowerCase()] || {}).upkeep || 0), 0);
          const addUp = addUnits.reduce((a, u) => a + ((us[u.toLowerCase()] || {}).upkeep || 0), 0);
          const grp = new Map(); for (const u of addUnits) grp.set(u, (grp.get(u) || 0) + 1);
          const addSummary = [...grp.entries()].map(([unit, count]) => ({ unit, count }));
          return { removeUnits: toDrop, addUnits, addSummary, dropCount: toDrop.length, keepUnits: keptRecruit, monotonous, poAfter, upkeepDelta: addUp - dropUp };
        };
        for (const s of budget.settlements) {
          const br = s.optimalBracket || "normal";
          // The save's stored PO is exact ONLY for the save's own PLAYER faction; for every
          // OTHER faction the save carries an unreliable value (AI Rome's Paestum read 225 → 155
          // at V.High vs the component model's 65 and the in-game 70 — like governors, the engine
          // doesn't keep a live PO for AI factions). The all-human DETERMINISTIC overview compares
          // every faction on equal footing, so it uses the component model (designed-start PO),
          // never the per-save anchor. Other modes keep the anchor (the player's own save = exact).
          const a = (!humanDifficulty) && poAnchorByCity && (poAnchorByCity[s.settlement] || poAnchorByCity[s.region]);
          if (a) {
            s.poAtSet = a.po - POD[a.bracket] + POD[br];
            s.poAtLow = a.po - POD[a.bracket];
            s.poExact = true; exactN++;
          } else {
            const p = po[s.settlement] || po[s.region];
            if (!p) continue;
            s.poAtSet = p.poAt[br] != null ? p.poAt[br] : p.poAt.normal;
            s.poAtLow = p.poAt.low;
          }
          // Public order is NOT in 5-point steps — the culture penalty can be non-5 (Neapolis 88).
          // Do NOT snap to 5; the save-anchored path carries the EXACT in-game PO. Integer-round
          // only for clean display.
          if (s.poAtSet != null) s.poAtSet = Math.round(s.poAtSet);
          if (s.poAtLow != null) s.poAtLow = Math.round(s.poAtLow);
          // user bands 2026-06-11: 0-74 red, 75-84 orange, 85-99 light green, 100+ dark green.
          s.poRisk = s.poAtSet < 75 ? "red" : s.poAtSet < 85 ? "orange" : s.poAtSet < 100 ? "lightgreen" : "green";
          if (s.poRisk === "red") flagged++;
          // PRIORITY GARRISON SUGGESTION (user 2026-06-11, Neapolis <75 case): red-band
          // towns get a concrete "add ≈N men" fix to reach the 85+ band. EXACT garrison
          // law (2026-06-12): PO% = 5·floor(70·men/pop) → ΔPO per man = 350/pop, 80% cap.
          if ((s.poRisk === "red" || s.poRisk === "orange") && s.pop) {
            const target = 85;
            s.garrisonFixMen = Math.max(40, Math.ceil((target - s.poAtSet) / 350 * s.pop / 10) * 10);
            // name a concrete fix: cheapest gated garrison-infantry unit covering the gap
            try { const gu = _recommendGarrisonUnit(s.buildings, s.region, s.garrisonFixMen); if (gu) { gu.poAfter = Math.min(200, Math.round((s.poAtSet + gu.n * gu.menPerUnit * 350 / s.pop) / 5) * 5); s.garrisonUnit = gu; } } catch { }
          }
          // GARRISON-REPLACE: any town whose starting garrison holds non-recruitable units (mod
          // AOR gating changed). The replace supersedes the add-fix (it sizes the garrison too).
          try { const prow = po[s.settlement] || po[s.region]; const gr = _recommendGarrisonReplace(s, prow); if (gr) { s.garrisonReplace = gr; delete s.garrisonUnit; } } catch { }
        }
        let replaceN = 0; for (const s of budget.settlements) if (s.garrisonReplace) replaceN++;
        if (replaceN) _writeLog(`[turn1-budget] ${faction}: ${replaceN} town(s) have non-recruitable starting garrisons → replace suggestions attached`);
        if (exactN) _writeLog(`[turn1-budget] ${faction}: PO anchored EXACT from calibration save for ${exactN} towns`);
        if (flagged) _writeLog(`[turn1-budget] ${faction}: PO model flags ${flagged} revolt-risk towns (po<100 at set bracket)`);
      } catch (e) { _writeLog(`[turn1-budget] PO model failed (non-fatal): ${e && e.message}`); }
      // SAVE LEDGER (user 2026-07-02, the Rome +5054-vs-+2699 report): when a calibration
      // save is attached, read the faction's OWN econ ledger from it and ship it along —
      // the authoritative in-game net at the save's CURRENT tax rates. The renderer offers
      // it as a one-click budget and uses it to flag a difficulty-mode mismatch (the report
      // was the all-human/Normal mode read on an H/H campaign: ÷0.92 ⇒ ≈ +9% income).
      if (savePath) {
        try {
          const as2 = require("./armySetup.js");
          const ab = as2.attributeAllBudgets(await fs.promises.readFile(savePath), modDataDir, null);
          const led = ab && ab.byFaction && ab.byFaction[String(faction).toLowerCase()];
          if (led && Number.isFinite(led.net)) {
            budget.saveLedger = { net: led.net, incomeTotal: led.income && led.income.total, taxes: led.income && led.income.taxes,
              armyUpkeep: led.armyUpkeep, isPlayer: ab.player === String(faction).toLowerCase(), player: ab.player, verified: !!led.verified };
            _writeLog(`[turn1-budget] ${faction}: save ledger net=${led.net} (player=${ab.player}${budget.saveLedger.isPlayer ? ", THIS faction" : ""}) vs model net=${budget.totals && (budget.totals.armyBudget - budget.totals.armyUpkeep)}`);
          }
        } catch (e) { _writeLog(`[turn1-budget] save-ledger read failed (non-fatal): ${e && e.message}`); }
      }
      budget.staleWarning = _modCopyWarning(modDataDir);
      if (budget.staleWarning) _writeLog(`[turn1-budget] STALE-MOD WARNING: ${budget.staleWarning}`);
      const t = budget.totals;
      _writeLog(`[turn1-budget] ${faction}: ${budget.settlements.length} towns tier=${budget.tier} ${budget.saveAware ? "SAVE-AWARE" : "no-save"} | taxes=${t.taxes} farm=${t.farming} mine=${t.mining} trade=${t.trade} → income=${t.income}${t.tributeIn ? ` +tribute=${t.tributeIn}` : ""} − wages=${t.wages} − corruption=${t.corruption} = armyBudget=${t.armyBudget}${t.tributeOut ? ` | PAYS tribute=${t.tributeOut} to suzerain` : ""}`);
    } else _writeLog(`[turn1-budget] ${faction}: FAILED ${budget && budget.error}`);
    return budget;
  } catch (e) { _writeLog(`[turn1-budget] failed: ${e && e.message}`); return { error: e && e.message ? e.message : String(e) }; }
});

// IPC: mercenary pools from descr_mercenaries.txt (2026-06-08) — for the
// Mercenaries map layer. Returns { pools, byRegion:{region:{pools,units}}, poolNames }.
ipcMain.handle("get-mercenary-pools", async (_event, modDataDir) => {
  try {
    if (!modDataDir) return { error: "modDataDir required" };
    const mp = require("./mercenaryParser.js");
    const r = mp.parseMercenaries(modDataDir);
    if (r && r.pools) _writeLog(`[mercenaries] ${r.pools.length} pools, ${Object.keys(r.byRegion).length} regions covered`);
    return r;
  } catch (e) { _writeLog(`[mercenaries] failed: ${e && e.message}`); return { error: e && e.message ? e.message : String(e) }; }
});

// IPC: add a region to a mercenary pool (edits descr_mercenaries.txt, CRLF-safe, backup).
ipcMain.handle("add-region-to-merc-pool", async (_event, modDataDir, poolName, region) => {
  try {
    if (!modDataDir || !poolName || !region) return { error: "missing args" };
    const mp = require("./mercenaryParser.js");
    const p = mp.findDescrMercenaries(modDataDir);
    if (!p || !fs.existsSync(p)) return { error: "descr_mercenaries.txt not found" };
    const text = fs.readFileSync(p, "latin1");
    const r = mp.addRegionToPool(text, poolName, region);
    if (!r.ok) return { error: r.error, already: !!r.already };
    try { fs.copyFileSync(p, p + ".provincia-bak"); } catch (e) { _writeLog(`[merc-add] backup failed: ${e && e.message}`); }
    fs.writeFileSync(p, r.text, "latin1");
    _writeLog(`[merc-add] added region "${region}" to pool "${poolName}" @line ${r.changedLine} ("${r.before}" → "${r.after}")`);
    return { ok: true, changedLine: r.changedLine, before: r.before, after: r.after, path: p };
  } catch (e) { _writeLog(`[merc-add] failed: ${e && e.message}`); return { error: e && e.message ? e.message : String(e) }; }
});

// IPC: list the current campaign's factions (descr_strat faction lines).
ipcMain.handle("get-campaign-factions", async (_event, modDataDir) => {
  try {
    if (!modDataDir) return { error: "modDataDir required" };
    const as = require("./armySetup.js");
    return { factions: as.listCampaignFactions(modDataDir) };
  } catch (e) { return { error: e && e.message ? e.message : String(e) }; }
});

// IPC: apply ONE unit swap to descr_strat (army-setup). Surgical single-line swap,
// CRLF preserved, with a timestamped backup of the file first.
ipcMain.handle("apply-army-swap", async (_event, modDataDir, faction, character, oldUnit, newUnit) => {
  try {
    if (!modDataDir || !faction || !character || !oldUnit || !newUnit) return { error: "missing args" };
    const as = require("./armySetup.js");
    const p = as.findDescrStrat(modDataDir);
    if (!p || !fs.existsSync(p)) return { error: "descr_strat.txt not found" };
    const text = fs.readFileSync(p, "latin1");
    const r = as.applySwap(text, faction, character, oldUnit, newUnit);
    if (!r.ok) return { error: r.error };
    // backup before writing (single rolling .provincia-bak + a one-shot timestamp)
    try { fs.copyFileSync(p, p + ".provincia-bak"); } catch (e) { _writeLog(`[army-swap] backup failed: ${e && e.message}`); }
    fs.writeFileSync(p, r.text, "latin1");
    _writeLog(`[army-swap] ${faction}/${character}: "${oldUnit}" → "${newUnit}" @line ${r.changedLine}`);
    return { ok: true, changedLine: r.changedLine, before: r.before, after: r.after, path: p };
  } catch (e) {
    _writeLog(`[army-swap] failed: ${e && e.message}`);
    return { error: e && e.message ? e.message : String(e) };
  }
});

// IPC: add one unit to a settlement's garrison army in descr_strat (CRLF-safe, backup).
ipcMain.handle("apply-add-garrison", async (_event, modDataDir, faction, settlementName, unitName) => {
  try {
    if (!modDataDir || !faction || !settlementName || !unitName) return { error: "missing args" };
    const as = require("./armySetup.js");
    const dg = require("./descrStratGeneral.js");
    const p = as.findDescrStrat(modDataDir);
    if (!p || !fs.existsSync(p)) return { error: "descr_strat.txt not found" };
    let regionToCity = {};
    try { const regPath = path.join(modDataDir, "world", "maps", "base", "descr_regions.txt"); regionToCity = (dg.parseDescrRegions(fs.readFileSync(regPath, "utf8")) || {}).regionToCity || {}; } catch { }
    const text = fs.readFileSync(p, "latin1");
    const r = as.applyAddGarrison(text, faction, settlementName, unitName, regionToCity);
    if (!r.ok) return { error: r.error };
    try { fs.copyFileSync(p, p + ".provincia-bak"); } catch (e) { _writeLog(`[add-garrison] backup failed: ${e && e.message}`); }
    fs.writeFileSync(p, r.text, "latin1");
    _writeLog(`[add-garrison] ${faction} ${settlementName}: +1 "${unitName}" @line ${r.insertedAtLine} (${r.anchor})`);
    return { ok: true, insertedAtLine: r.insertedAtLine, anchor: r.anchor, newLine: r.newLine, path: p };
  } catch (e) {
    _writeLog(`[add-garrison] failed: ${e && e.message}`);
    return { error: e && e.message ? e.message : String(e) };
  }
});

// IPC: append units to a NAMED CHARACTER's army in descr_strat (spend-headroom
// suggestions; CRLF-safe, backup, 20-unit cap enforced in armySetup).
ipcMain.handle("apply-add-army-units", async (_event, modDataDir, faction, character, unitNames) => {
  try {
    if (!modDataDir || !faction || !character || !Array.isArray(unitNames) || !unitNames.length) return { error: "missing args" };
    const as = require("./armySetup.js");
    const p = as.findDescrStrat(modDataDir);
    if (!p || !fs.existsSync(p)) return { error: "descr_strat.txt not found" };
    const text = fs.readFileSync(p, "latin1");
    const r = as.applyAddArmyUnits(text, faction, character, unitNames);
    if (!r.ok) return { error: r.error };
    try { fs.copyFileSync(p, p + ".provincia-bak"); } catch (e) { _writeLog(`[add-army-units] backup failed: ${e && e.message}`); }
    fs.writeFileSync(p, r.text, "latin1");
    _writeLog(`[add-army-units] ${faction}/${character}: +${r.addedCount} unit(s) [${unitNames.slice(0, r.addedCount).join(", ")}] @line ${r.insertedAtLine}${r.capClipped ? ` (CLIPPED from ${r.requested} — 20-unit cap)` : ""}`);
    return { ok: true, addedCount: r.addedCount, capClipped: r.capClipped, insertedAtLine: r.insertedAtLine, path: p };
  } catch (e) {
    _writeLog(`[add-army-units] failed: ${e && e.message}`);
    return { error: e && e.message ? e.message : String(e) };
  }
});

// IPC: replace a settlement garrison's non-recruitable units with a recruitable one in
// descr_strat (drop removeUnits — never the bodyguard — add addCount× addUnit; CRLF-safe, backup).
ipcMain.handle("apply-replace-garrison", async (_event, modDataDir, faction, settlementName, removeUnits, addUnits) => {
  try {
    if (!modDataDir || !faction || !settlementName) return { error: "missing args" };
    const as = require("./armySetup.js");
    const dg = require("./descrStratGeneral.js");
    const p = as.findDescrStrat(modDataDir);
    if (!p || !fs.existsSync(p)) return { error: "descr_strat.txt not found" };
    let regionToCity = {};
    try { const regPath = path.join(modDataDir, "world", "maps", "base", "descr_regions.txt"); regionToCity = (dg.parseDescrRegions(fs.readFileSync(regPath, "utf8")) || {}).regionToCity || {}; } catch { }
    const text = fs.readFileSync(p, "latin1");
    const r = as.applyReplaceGarrison(text, faction, settlementName, removeUnits || [], addUnits || [], regionToCity);
    if (!r.ok) return { error: r.error };
    try { fs.copyFileSync(p, p + ".provincia-bak"); } catch (e) { _writeLog(`[replace-garrison] backup failed: ${e && e.message}`); }
    fs.writeFileSync(p, r.text, "latin1");
    _writeLog(`[replace-garrison] ${faction} ${settlementName}: −${r.removedCount} non-recruitable, +${r.addedCount} unit(s) [${(r.addedLines || []).join(", ")}] (${r.anchor}; lineΔ ${r.lineDelta})`);
    return { ok: true, removedCount: r.removedCount, addedCount: r.addedCount, removedLines: r.removedLines, addedLines: r.addedLines, anchor: r.anchor, path: p };
  } catch (e) {
    _writeLog(`[replace-garrison] failed: ${e && e.message}`);
    return { error: e && e.message ? e.message : String(e) };
  }
});

// IPC: zero illegitimate weapon/armour upgrades on a character's army (CRLF-safe, backup).
ipcMain.handle("apply-upgrade-fix", async (_event, modDataDir, faction, character, opts) => {
  try {
    if (!modDataDir || !faction || !character) return { error: "missing args" };
    const as = require("./armySetup.js");
    const p = as.findDescrStrat(modDataDir);
    if (!p || !fs.existsSync(p)) return { error: "descr_strat.txt not found" };
    const text = fs.readFileSync(p, "latin1");
    const r = as.applyUpgradeFix(text, faction, character, opts);
    if (!r.ok) return { error: r.error };
    try { fs.copyFileSync(p, p + ".provincia-bak"); } catch (e) { _writeLog(`[upgrade-fix] backup failed: ${e && e.message}`); }
    fs.writeFileSync(p, r.text, "latin1");
    _writeLog(`[upgrade-fix] ${faction}/${character}: zeroed ${r.fixed} unit upgrade line(s)`);
    return { ok: true, fixed: r.fixed };
  } catch (e) { return { error: e && e.message ? e.message : String(e) }; }
});

// IPC: army-setup analysis for one faction (2026-06-07) — descr_strat army +
// upkeep + balance, recruitable pool (full RIS gating), retraining availability.
// Budget (virtual tax) is computed in the renderer from saveEconomy. Returns the
// armySetup.analyzeFaction object.
ipcMain.handle("get-army-setup", async (_event, faction, modDataDir, floor) => {
  try {
    if (!faction || !modDataDir) return { error: "faction + modDataDir required" };
    const as = require("./armySetup.js");
    const r = as.analyzeFaction(modDataDir, faction, null, typeof floor === "number" ? floor : -500);
    if (r && !r.error) _writeLog(`[army-setup] ${faction}: armyUpkeep=${r.armyUpkeep} units=${r.summary?.totalArmyUnits} pool=${(r.settlements||[]).map(s=>s.pool.length).join("/")} flags=[${(r.summary?.flags||[]).join("; ")}]`);
    else _writeLog(`[army-setup] ${faction}: ${r && r.error}`);
    return r;
  } catch (e) {
    _writeLog(`[army-setup] failed: ${e && e.message}`);
    return { error: e && e.message ? e.message : String(e) };
  }
});

// IPC: per-faction fog-of-war / explored map (2026-06-04). Returns the chosen
// faction's ever-explored tile grid (the corrected 1020×700 model — see
// findings-faction-knowledge-entities-2026-06-04.md). Record→faction is
// resolved robustly: engineOrder gives a fast primary pick, then we VERIFY by
// settlement coverage — a faction's own settlements are 100% on its own
// explored grid — and fall back to the best-covering record if the primary
// pick is poor. Self-validating, so it survives engineOrder's high-index
// off-by-one. `coverage` is returned so the UI can flag a weak match.
function readStratFactionOrder(modDataDir) {
  const candidates = [
    path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
    path.join(modDataDir, "world", "maps", "campaign", "alexander", "descr_strat.txt"),
    path.join(modDataDir, "world", "maps", "campaign", "barbarian_invasion", "descr_strat.txt"),
  ];
  for (const src of candidates) {
    if (!fs.existsSync(src)) continue;
    const text = fs.readFileSync(src, "utf8");
    const out = [];
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*faction\s+([a-z_0-9]+)/i);
      if (m && !out.includes(m[1])) out.push(m[1]);
    }
    return out;
  }
  return [];
}
ipcMain.handle("get-faction-vision", async (_event, savePath, modDataDir, factionName) => {
  try {
    if (!savePath || !fs.existsSync(savePath)) return { error: "no save path" };
    if (!factionName) return { error: "no faction" };
    const { findFactionRecords, parseFactionKnowledge } = require("./factionKnowledgeParser.js");
    const { deriveEngineFactionOrder } = require("./saveCrackerExtras.js");
    const buf = await fs.promises.readFile(savePath); // async: saves are 30-45 MB — don't block the event loop on I/O
    const recs = findFactionRecords(buf);
    if (!recs.length) return { error: "no faction records" };
    const GRID_W = 1020, GRID_H = 700, CELLS = GRID_W * GRID_H;
    const stratOrder = readStratFactionOrder(modDataDir);
    const engineOrder = deriveEngineFactionOrder(stratOrder);
    // Case-insensitive name match against both orders (the renderer may pass a
    // name whose casing differs from descr_strat).
    const ci = (arr, name) => {
      let k = arr.indexOf(name);
      if (k >= 0) return k;
      const low = String(name).toLowerCase();
      return arr.findIndex((x) => x && x.toLowerCase() === low);
    };
    const stratIdx = ci(stratOrder, factionName);
    // F's own settlement tiles (engine linear index) from the global tag-27 set.
    const ownTiles = [];
    if (stratIdx >= 0) {
      const fk = parseFactionKnowledge(buf);
      const seen = new Set();
      for (const r of fk.records || []) {
        for (const t of r.tuples || []) {
          if (t.tag === 27 && t.owner === stratIdx && t.tileX < GRID_W && t.tileY < GRID_H) {
            const li = t.tileY * GRID_W + t.tileX;
            if (!seen.has(li)) { seen.add(li); ownTiles.push(li); }
          }
        }
      }
    }
    const decodeGrid = (rec) => {
      const grid = new Uint8Array(CELLS);
      let gi = 0, i = rec.offset + 0x18, MAX = Math.min(rec.offset + rec.size, buf.length);
      while (i + 2 <= MAX && gi < CELLS) {
        const v = buf[i], c = buf[i + 1];
        if (c === 0) break;
        const lim = Math.min(c, CELLS - gi);
        if (v !== 0) grid.fill(v, gi, gi + lim);
        gi += lim; i += 2;
      }
      return { grid, decoded: gi };
    };
    const coverage = (grid) => {
      if (!ownTiles.length) return -1; // unknown (can't verify)
      let hit = 0;
      for (const li of ownTiles) if (grid[li] > 0) hit++;
      return hit / ownTiles.length;
    };
    // Primary pick via engineOrder (case-insensitive).
    let recIdx = ci(engineOrder, factionName);
    _writeLog(`[fog] request "${factionName}" -> engineIdx=${recIdx} stratIdx=${stratIdx} ownTiles=${ownTiles.length}`);
    let best = null;
    if (recIdx >= 0 && recIdx < recs.length) {
      const d = decodeGrid(recs[recIdx]);
      if (d.decoded >= 100000) best = { idx: recIdx, grid: d.grid, cov: coverage(d.grid), decoded: d.decoded };
    }
    // Robust fallback: if the primary pick can't be verified well, search all
    // records for the one whose grid best covers F's settlements.
    if (ownTiles.length && (!best || best.cov < 0.7)) {
      for (let k = 0; k < recs.length; k++) {
        const d = decodeGrid(recs[k]);
        if (d.decoded < 100000) continue;
        const cov = coverage(d.grid);
        if (!best || cov > best.cov) best = { idx: k, grid: d.grid, cov, decoded: d.decoded };
      }
    }
    if (!best) return { error: "no decodable vision record" };
    let exploredCount = 0;
    for (let k = 0; k < CELLS; k++) if (best.grid[k] > 0) exploredCount++;
    _writeLog(`[fog] ${factionName} rec#${best.idx} cov=${best.cov < 0 ? "n/a" : (100 * best.cov).toFixed(0) + "%"} explored=${exploredCount}`);
    return {
      faction: factionName, width: GRID_W, height: GRID_H,
      grid: Buffer.from(best.grid), coverage: best.cov, exploredCount,
    };
  } catch (e) {
    _writeLog(`[fog] get-faction-vision failed: ${e && e.message}`);
    return { error: e && e.message ? e.message : String(e) };
  }
});

// IPC: the faction list for the fog-of-war picker (2026-06-04). Returns ONLY
// factions whose vision record actually resolves from THIS save (engineOrder ↔
// record), with their explored-tile count — so the dropdown can never offer a
// name get-faction-vision can't honour (the prior empty/mismatched-dropdown
// bug). Excludes the rebel/slave records and the all-seeing record (explored ≈
// whole map) and dead/empty factions (explored < 50). Cheap: counts explored
// via the RLE walk without materialising grids.
ipcMain.handle("get-vision-faction-list", async (_event, savePath, modDataDir) => {
  try {
    if (!savePath || !fs.existsSync(savePath)) return { error: "no save path" };
    const { findFactionRecords } = require("./factionKnowledgeParser.js");
    const { deriveEngineFactionOrder } = require("./saveCrackerExtras.js");
    const buf = await fs.promises.readFile(savePath); // async: saves are 30-45 MB — don't block the event loop on I/O
    const recs = findFactionRecords(buf);
    const GRID_W = 1020, GRID_H = 700, CELLS = GRID_W * GRID_H;
    const stratOrder = readStratFactionOrder(modDataDir);
    const engineOrder = deriveEngineFactionOrder(stratOrder);
    const exploredOf = (rec) => {
      let i = rec.offset + 0x18, MAX = Math.min(rec.offset + rec.size, buf.length), total = 0, exp = 0;
      while (i + 2 <= MAX && total < CELLS) {
        const v = buf[i], c = buf[i + 1];
        if (c === 0) break;
        const lim = Math.min(c, CELLS - total);
        if (v !== 0) exp += lim;
        total += lim; i += 2;
      }
      return { exp, total };
    };
    const out = [];
    for (let i = 0; i < recs.length; i++) {
      const name = engineOrder[i];
      if (!name || /rebel|slave/i.test(name)) continue; // drop rebel/slave slots
      const { exp, total } = exploredOf(recs[i]);
      if (total !== CELLS) continue;                    // not a normal vision record
      if (exp < 50) continue;                           // dead / never-played faction
      if (exp > 0.85 * CELLS) continue;                 // all-seeing record
      out.push({ faction: name, explored: exp });
    }
    out.sort((a, b) => a.faction.localeCompare(b.faction));
    _writeLog(`[fog] faction-list: ${out.length} resolvable factions (of ${recs.length} records)`);
    return { factions: out };
  } catch (e) {
    _writeLog(`[fog] get-vision-faction-list failed: ${e && e.message}`);
    return { error: e && e.message ? e.message : String(e) };
  }
});

// IPC: trade-network derivation (src/tradeNetwork.js). DERIVED, not stored in
// the save — computes road/sea connectivity + trade-rights gating to list each
// settlement's trade partners (CONFIRMED structure) plus a relative trade-score
// (HYPOTHESIS, clearly labelled in the UI). Computed on demand per save-file
// change, not on the hot live-watch path (it loads + walks the map TGA, so it's
// too slow to run every snapshot). savePath may be either a full path or, when
// the live watcher is active, omitted to use the last watched save buffer.
ipcMain.handle("crack-trade-network", async (_event, savePath, modDataDir, campaign) => {
  try {
    const hasPath = !!(savePath && fs.existsSync(savePath));
    const liveBuf = hasPath ? null : getLastSaveBuf(); // live-watch path: reuse the buffer already in memory
    if (!hasPath && !liveBuf) return { error: "no save buffer available" };
    // Off-main-thread + crack reuse: when we have a savePath, reuse the economy
    // panel's shared tradeOnly crack (both panels fire on the same save load), so
    // this worker skips its own ~3s re-crack and only does the network compute.
    // Best-effort — if the shared crack isn't available, the trade worker cracks
    // itself. The live-buffer path (no savePath) always cracks in-worker.
    try {
      let preCracked = null;
      if (hasPath) {
        try { preCracked = (await getSharedEconomyCrack(savePath, modDataDir)).cr; } catch { preCracked = null; }
      }
      return await runCrackWorker("trade", { savePath: hasPath ? savePath : null, saveBuf: liveBuf, modDataDir, campaign, preCracked });
    } catch (werr) {
      // Fallback: worker unavailable/failed → run synchronously (never a regression).
      _writeLog(`[trade] worker fallback (${werr && werr.message}) — running on main thread`);
      const { computeTradeNetwork } = require("./tradeNetwork.js");
      const buf = hasPath ? await fs.promises.readFile(savePath) : liveBuf;
      return computeTradeNetwork(buf, modDataDir, campaign ? { campaign } : {});
    }
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) };
  }
});

// IPC: campaign-timeline scan (UI batch 2, feature 3). The app watches ONE
// live save; this scans a chosen folder of saves (e.g. the Feral autosave dir
// or a crash-save bundle), cracks each, sorts by the CRACKED turn number (not
// filename), and returns the per-turn arc + turn-to-turn deltas for the
// dominant (or all) campaign(s). Reuses scripts/campaign-timeline.js's
// buildTimeline + computeDelta verbatim, so the CLI and the in-app view share
// one source of truth — INCLUDING the family chain-break guard (deltas across
// different save chains are flagged, never fabricated). Heavy (cracks every
// save), so it's an explicit on-demand action, never on the hot live path.
ipcMain.handle("scan-saves-timeline", async (_event, dir, modDataDir, opts) => {
  try {
    // NOTE: this module lives at the repo-root scripts/, not src/scripts/ — so
    // the path is "../scripts/" now that this handler lives in src/. (It was
    // "./scripts/" when this code was in main.js at the repo root; the extraction
    // to src/ silently broke it. campaign-timeline.js + its ../src deps are in
    // build.files so it also resolves inside the packaged asar.)
    const { buildTimeline, computeDelta, collectUniqueSaves, assembleTimeline } = require("../scripts/campaign-timeline.js");
    if (!dir || !fs.existsSync(dir)) return { error: "Folder not found: " + dir };
    const factionOverride = opts && opts.faction ? opts.faction : null;
    const allCampaigns = !!(opts && opts.allCampaigns);

    const files = collectUniqueSaves([dir]);
    if (files.length === 0) return { scanned: 0, errors: [], campaigns: [] };

    // Crack every save in parallel worker threads — off the main thread AND
    // ~cores× faster than the old serial main-thread loop (which froze the app
    // for minutes on a big folder). On any worker-infra failure, fall back to
    // the serial buildTimeline so the scan still completes.
    try {
      const { rows, errors } = await crackRowsInParallel(files, modDataDir, factionOverride);
      return finalizeTimeline(assembleTimeline(rows, errors, files.length, factionOverride, allCampaigns), computeDelta);
    } catch (werr) {
      _writeLog(`[timeline] worker fallback (${werr && werr.message}) — cracking on main thread`);
      return finalizeTimeline(buildTimeline([dir], modDataDir, factionOverride, allCampaigns), computeDelta);
    }
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) };
  }
});

// IPC: save a campaign data file. Writes to userData (authoritative store).
// In dev, also mirrors to build/ so the React dev server can fetch it.
// In packaged apps, build/ lives inside the read-only asar — skip it.
// Save-as dialog wrapper for ad-hoc CSV exports etc. Renderer-driven.
}

module.exports = { registerSaveAnalysisHandlers };
