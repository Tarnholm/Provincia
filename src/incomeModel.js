// src/incomeModel.js
//
// STATIC turn-1 income model (2026-06-09, in progress): predict a faction's
// turn-1 Financial-Overview components (taxes / farming / trade / mining;
// wages / army upkeep) from the MOD FILES ONLY — descr_strat + EDB + regions +
// resources — so the Army Setup "turn-1 budget at optimal taxes" panel works
// with NO save loaded. Saves are used only to CRACK/VALIDATE this model
// (rtw-sav-parser/crack-income.js corpus; the per-save PLAYER faction is the
// clean truth — AI factions are skewed by difficulty scaling + not is_player
// EDB branches).
//
// RIS mechanics this must capture (surveyed 2026-06-09):
//   - taxable_income_bonus bonus N  (6152 lines!) — % modifiers on tax income,
//     heavily gated on empire size (size1..size10 aliases = major_event
//     "empire_sizeN", per-faction settlement-count brackets: 1 / 2-4 / 5-8 /
//     9-15 / 16-29 / 30-50 / 51-100 / 101-200 / 201-400 / 401+), is_player vs
//     AI, hidden_resource capital, temples, government tier.
//   - trade_base_income_bonus bonus N (295) — trade modifiers (markets, ports,
//     sieges, empire size).
//   - mine_resource N (16) — mining income (× resource value).
//   - farming_level / farming_level bonus N — farming income (with region farmN).
//   - trade_level_bonus / trade_fleet / road_level — trade plumbing.
// Empire-size atoms need EXACT-tier semantics and AI rows need is_player=false —
// both parameterized in growthEval.evalReq via ctx.empireTier / ctx.isPlayer.

"use strict";

const fs = require("fs");
const path = require("path");
const gv = require("./growthEval.js");

// ---- empire size tier from settlement count (major_event_scripts/sizeN_true.txt) ----
function empireTier(nSettlements) {
  const n = nSettlements | 0;
  if (n <= 1) return 1;
  if (n <= 4) return 2;
  if (n <= 8) return 3;
  if (n <= 15) return 4;
  if (n <= 29) return 5;
  if (n <= 50) return 6;
  if (n <= 100) return 7;
  if (n <= 200) return 8;
  if (n <= 400) return 9;
  return 10;
}

// ---- EDB income-capability pass (same walking logic as growthEval.parseEDB) ----
// capIndex["chain:level"] = { taxable:[{val,req}], trade:[…], tradeLvl:[…], mine:[…], fleet:[…] }
function parseEDBIncome(edbPath) {
  const lines = fs.readFileSync(edbPath, "latin1").split(/\r?\n/);
  const capIndex = {}, chainLevels = {};
  let curBuilding = null, levelsList = [], curLevel = null, inFC = false, fcPending = false;
  const aliases = {};
  let curAlias = null;
  const add = (kind, obj) => {
    if (!curBuilding || !curLevel) return;
    const key = curBuilding + ":" + curLevel;
    (capIndex[key] = capIndex[key] || { taxable: [], trade: [], factionTrade: [], tradeLvl: [], mine: [], fleet: [], walls: [], health: [], law: [] })[kind].push(obj);
  };
  for (const raw of lines) {
    const ln = raw.replace(/;.*$/, "");
    const am = ln.match(/^alias\s+(\S+)/);
    if (am) { curAlias = am[1]; continue; }
    if (curAlias) { const rq = ln.match(/^\s*requires\s+(.+)/); if (rq) { aliases[curAlias] = rq[1].trim(); curAlias = null; } else if (/^\s*\}/.test(ln)) curAlias = null; continue; }
    const bm = ln.match(/^building\s+(\w+)/);
    if (bm) { curBuilding = bm[1]; levelsList = []; curLevel = null; inFC = false; fcPending = false; continue; }
    const lm = ln.match(/^\s*levels\s+(.+)$/);
    if (lm) { levelsList = lm[1].trim().split(/\s+/).filter(w => w && w !== "{"); chainLevels[curBuilding] = levelsList.slice(); continue; }
    const tok = ln.trim().split(/\s+/);
    if (levelsList.length && tok[0] && levelsList.includes(tok[0]) && (tok[1] === "requires" || tok[1] === undefined || tok[1] === "{")) {
      curLevel = tok[0]; continue;
    }
    const _t = ln.trim();
    if (/^faction_capability\b/.test(_t)) { fcPending = true; continue; }       // factionwide effects block
    if (_t === "{") { if (fcPending) { inFC = true; fcPending = false; } continue; }
    if (_t === "}") { if (inFC) inFC = false; continue; }
    let m;
    if ((m = ln.match(/^\s*taxable_income_bonus\s+(?:bonus\s+)?(-?\d+)(?:\s+requires\s+(.+))?/))) { add("taxable", { val: +m[1], req: (m[2] || "").trim() }); continue; }
    if ((m = ln.match(/^\s*trade_base_income_bonus\s+(?:bonus\s+)?(-?\d+)(?:\s+requires\s+(.+))?/))) { add(inFC ? "factionTrade" : "trade", { val: +m[1], req: (m[2] || "").trim() }); continue; }
    if ((m = ln.match(/^\s*trade_level_bonus\s+(?:bonus\s+)?(-?\d+)(?:\s+requires\s+(.+))?/))) { add("tradeLvl", { val: +m[1], req: (m[2] || "").trim() }); continue; }
    if ((m = ln.match(/^\s*mine_resource\s+(-?\d+)(?:\s+requires\s+(.+))?/))) { add("mine", { val: +m[1], req: (m[2] || "").trim() }); continue; }
    if ((m = ln.match(/^\s*trade_fleet\s+(-?\d+)(?:\s+requires\s+(.+))?/))) { add("fleet", { val: +m[1], req: (m[2] || "").trim() }); continue; }
    if ((m = ln.match(/^\s*wall_level\s+(-?\d+)(?:\s+requires\s+(.+))?/))) { add("walls", { val: +m[1], req: (m[2] || "").trim() }); continue; }
    if ((m = ln.match(/^\s*population_health_bonus\s+(?:bonus\s+)?(-?\d+)(?:\s+requires\s+(.+))?/))) { add("health", { val: +m[1], req: (m[2] || "").trim() }); continue; }
    if ((m = ln.match(/^\s*law_bonus\s+(?:bonus\s+)?(-?\d+)(?:\s+requires\s+(.+))?/))) { add("law", { val: +m[1], req: (m[2] || "").trim() }); continue; }
  }
  return { capIndex, chainLevels, aliases };
}

// ---- descr_sm_resources: resource → { tradeValue, tier, mineable } ----
function parseResourceValues(modDataDir) {
  const p = path.join(modDataDir, "descr_sm_resources.txt");
  const out = {};
  if (!fs.existsSync(p)) return out;
  const txt = fs.readFileSync(p, "latin1");
  // JSON-ish blocks: "name": { ... "subtype": "mineable", ... "trade value": N, ... }
  const re = /"([a-z_0-9]+)"\s*:\s*\{([\s\S]*?)\n\t\}/g;
  let m;
  while ((m = re.exec(txt))) {
    const name = m[1].toLowerCase(), body = m[2];
    const tv = body.match(/"trade value"\s*:\s*(-?\d+)/);
    const tier = body.match(/"tier"\s*:\s*(-?\d+)/);
    const st = body.match(/"subtype"\s*:\s*"([a-z_]+)"/);
    out[name] = { tradeValue: tv ? +tv[1] : 0, tier: tier ? +tier[1] : 0, mineable: st ? st[1] === "mineable" : false, hidden: st ? st[1] === "hidden" : false };
  }
  return out;
}

// ---- per-settlement INCOME features for one faction (player or AI perspective) ----
// Returns { faction, tier, settlements: [ { region, settlement, pop, level, capital,
//   taxablePct, tradePct, tradeLvlSum, mineSum, fleetSum, farmLevel, farmN,
//   resources:[{name,tradeValue,mineable}], portLevel, roadLevel } ] }
function computeIncomeFeatures(modDataDir, faction, opts) {
  const isPlayer = !(opts && opts.isPlayer === false);
  const stratPath = path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
  const edbPath = path.join(modDataDir, "export_descr_buildings.txt");
  if (!fs.existsSync(stratPath) || !fs.existsSync(edbPath)) return { error: "descr_strat or EDB not found" };
  const { byRegion } = gv.parseRegions(modDataDir);
  const resourcesByRegion = gv.parseResources(stratPath);
  const resourceValues = parseResourceValues(modDataDir);
  const inc = parseEDBIncome(edbPath);
  const growthEDB = gv.parseEDB(edbPath); // farming levels/bonuses (same pass as growth)
  const factionGroups = gv.parseFactionGroups(modDataDir);
  const factions = gv.parseStrat(stratPath);
  const want = String(faction || "").toLowerCase();
  const f = factions[want];
  if (!f) return { error: `faction ${faction} not found in descr_strat` };
  const factionTokens = gv.factionTokenSet(want, factionGroups);
  const tier = empireTier(f.settlements.length);

  const out = [];
  let factionwideTrade = 0; // Σ faction_capability trade bonuses across all the faction's settlements (applied to every settlement)
  for (const s of f.settlements) {
    const region = byRegion[s.region];
    if (!region) continue;
    // AI PERSPECTIVE: the RIS campaign script DESTROYS government (gov1-4) and colony
    // buildings in every AI settlement at campaign start (building-state audit
    // 2026-06-10) — descr_strat lists them but the AI economy never has them. Drop
    // them from AI features (taxable points, PO, trade) to model the post-script state.
    const aiDropped = !isPlayer
      ? s.buildings.filter(b => !/^government|^colony$/i.test(b.chain))
      : s.buildings;
    const buildings = new Map();
    for (const b of aiDropped) {
      const order = inc.chainLevels[b.chain] || null;
      const idx = order ? order.indexOf(b.level) : 0;
      buildings.set(b.chain, idx < 0 ? 0 : idx);
    }
    const ctx = {
      hidden: region.hidden || new Set(), buildings, chainLevels: inc.chainLevels, aliases: inc.aliases,
      capital: s.capital, faction: want, factionTokens,
      homeland: [...(region.hidden || [])].some(h => h.startsWith("homeland")),
      sizeTier: 1, resources: resourcesByRegion[s.region] || new Set(),
      isPlayer, empireTier: tier,
    };
    // Split each % sum into BASE / SIZE-gated / WINTER-gated components so the crack
    // driver can test inclusion variants (the growth crack proved disabling_in_winter
    // lines are excluded from base values in-game; empire-size events may or may not
    // be active for the turn-1 econ block). Hierarchy: winter > size > base.
    const cat = (req) => /\bdisabling_in_winter\b/.test(req || "") ? "winter" : /\bsize\d+\b/.test(req || "") ? "size" : "base";
    const tax = { base: 0, size: 0, winter: 0 }, trade = { base: 0, size: 0, winter: 0 };
    let tradeLvlSum = 0, mineSum = 0, fleetSum = 0, wallLevel = -1, healthPips = 0, lawBonus = 0, lawWalls = 0, lawTerrain = 0;
    const explain = (opts && opts.explain) ? [] : null;
    // Wall/defense law lines carry `is_toggled "settlement condition"` — live-verified
    // ACTIVE in peace (Arsinoe +1 palisade, Kyrene +1 stone wall, Ptolemais +1 wall;
    // settlement-details law% reconciles only with them counted).
    const lawCtx = { ...ctx, aliases: { ...(ctx.aliases || {}) } };
    const lawReqOk = (req) => gv.evalReq((req || "").replace(/is_toggled\s+"[^"]*"/g, "factionwide"), lawCtx);
    let taxableRegionBase = 0, taxableBuilding = 0; // split for the region_base-only ×40 rule
    for (const b of aiDropped) {
      const cap = inc.capIndex[b.chain + ":" + b.level];
      if (!cap) continue;
      for (const x of cap.taxable) if (gv.evalReq(x.req, ctx)) { tax[cat(x.req)] += x.val; if (/^hinterland_region$/i.test(b.chain)) taxableRegionBase += x.val; else taxableBuilding += x.val; if (explain) explain.push({ chain: b.chain + ":" + b.level, val: x.val, req: x.req }); }
      for (const x of cap.trade) if (gv.evalReq(x.req, ctx)) { trade[cat(x.req)] += x.val; if (explain) explain.push({ kind: "trade", chain: b.chain + ":" + b.level, val: x.val, req: x.req }); }
      for (const x of (cap.factionTrade || [])) if (gv.evalReq(x.req, ctx)) factionwideTrade += x.val; // factionwide bonus — counted once, applied to ALL settlements after the loop
      for (const x of cap.tradeLvl) if (gv.evalReq(x.req, ctx)) tradeLvlSum += x.val;
      for (const x of cap.mine) if (gv.evalReq(x.req, ctx)) mineSum += x.val;
      for (const x of cap.fleet) if (gv.evalReq(x.req, ctx)) fleetSum += x.val;
      for (const x of (cap.walls || [])) if (gv.evalReq(x.req, ctx)) wallLevel = Math.max(wallLevel, x.val);
      for (const x of (cap.health || [])) if (gv.evalReq(x.req, ctx)) healthPips += x.val;
      for (const x of (cap.law || [])) if (lawReqOk(x.req)) {
        lawBonus += x.val;
        if (/^defenses$/i.test(b.chain)) lawWalls += x.val;
        else if (/^hinterland_region$/i.test(b.chain)) lawTerrain += x.val;
      }
    }
    const taxablePct = tax.base + tax.size + tax.winter, tradePct = trade.base + trade.size + trade.winter;
    // farming level. GROWTH semantics = max across chains (validated); for INCOME the
    // per-chain levels may ADD (farms + irrigation both feed farm income) — both exposed:
    // farmLevel (max, growth-style) and farmLevelSum (sum of per-chain maxima).
    let farmLevel = 0, farmLevelSum = 0, farmBonus = 0;
    for (const b of s.buildings) {
      const cap = growthEDB.capIndex[b.chain + ":" + b.level];
      if (!cap) continue;
      let fl = null;
      for (const x of cap.farming) if (gv.evalReq(x.req, { ...ctx, chainLevels: growthEDB.chainLevels, aliases: growthEDB.aliases })) fl = (fl == null) ? x.val : Math.max(fl, x.val);
      if (fl != null) { farmLevel = Math.max(farmLevel, fl); farmLevelSum += fl; }
      for (const x of (cap.farmBonus || [])) if (gv.evalReq(x.req, { ...ctx, chainLevels: growthEDB.chainLevels, aliases: growthEDB.aliases })) farmBonus += x.val;
    }
    // additive bonuses only apply on top of an existing farm chain (Fregellae pin, see growthEval)
    if (farmLevel > 0) { farmLevel += farmBonus; farmLevelSum += farmBonus; }
    const resList = [...(resourcesByRegion[s.region] || new Set())]
      .map(r => ({ name: r, ...(resourceValues[r] || { tradeValue: 0, mineable: false }) }))
      .filter(r => !r.hidden);
    const portLevel = (() => { for (const h of (region.hidden || [])) { const m = String(h).match(/^base_port_level(\d+)?/); if (m) return m[1] ? +m[1] : 1; } if (buildings.has("port_buildings")) return buildings.get("port_buildings") + 1; if (buildings.has("river_port")) return buildings.get("river_port") + 1; return 0; })();
    const roadLevel = buildings.has("hinterland_roads") ? buildings.get("hinterland_roads") + 1 : 0;
    out.push({
      region: s.region, settlement: region.settlement, pop: s.pop, level: s.level, capital: !!s.capital,
      taxExplain: explain || undefined,
      taxablePct, taxableRegionBase, taxableBuilding, tradePct, taxPctParts: tax, tradePctParts: trade, tradeLvlSum, mineSum, fleetSum, farmLevel, farmLevelSum, farmN: region.farmN || 0,
      wallLevel, healthPips, lawBonus, lawWalls, lawTerrain,
      resources: resList, portLevel, roadLevel,
      buildings: s.buildings.map(b => b.chain + ":" + b.level),
      ...(explain ? { taxableLines: explain } : {}),
    });
  }
  if (factionwideTrade) for (const o of out) { o.tradePct += factionwideTrade; if (o.tradePctParts) o.tradePctParts.faction = factionwideTrade; }
  return { faction: want, isPlayer, tier, nSettlements: f.settlements.length, settlements: out };
}

// ---- starting-army upkeep per faction (EDU stat_cost upkeep over descr_strat armies) ----
// NOTE: the engine's actual charge can deviate from the EDU sum (known ±15% scatter,
// see the income crack); this is the planning estimate the balance overview uses.
// mtime-keyed descr_strat line cache (armyUpkeepEDU + countCharacters re-read the
// 2 MB file per call — once per faction in the balance overview).
const _stratLinesCache = new Map();
function _stratLines(stratPath) {
  let mt = 0;
  try { mt = fs.statSync(stratPath).mtimeMs; } catch { }
  const hit = _stratLinesCache.get(stratPath);
  if (hit && hit.mt === mt) return hit.v;
  const v = fs.readFileSync(stratPath, "latin1").split(/\r?\n/);
  _stratLinesCache.set(stratPath, { mt, v });
  return v;
}

// EDCT Command table: trait (lowercase) → [{threshold, command}] per level.
// Cached by EDCT mtime (file is ~1 MB, hit per faction by the balance overview).
const _edctCmdCache = new Map();
function _commandTraitTable(modDataDir) {
  const p = path.join(modDataDir, "export_descr_character_traits.txt");
  let mt = 0;
  try { mt = fs.statSync(p).mtimeMs; } catch { return {}; }
  const hit = _edctCmdCache.get(p);
  if (hit && hit.mt === mt) return hit.v;
  const out = {};
  let cur = null, lvl = null;
  for (const raw of fs.readFileSync(p, "latin1").split(/\r?\n/)) {
    const ln = raw.replace(/;.*/, "").trim();
    let m = ln.match(/^Trait\s+(\S+)/i);
    if (m) { cur = m[1].toLowerCase(); out[cur] = []; lvl = null; continue; }
    if (!cur) continue;
    if (/^Level\s/i.test(ln)) { lvl = { threshold: 1, command: 0 }; out[cur].push(lvl); continue; }
    if (!lvl) continue;
    m = ln.match(/^Threshold\s+(\d+)/i); if (m) { lvl.threshold = +m[1]; continue; }
    m = ln.match(/^Effect\s+Command\s+(-?\d+)/i); if (m) { lvl.command = +m[1]; continue; }
  }
  _edctCmdCache.set(p, { mt, v: out });
  return out;
}
// trait points → command stars (points-vs-threshold law; +L1 floor for ladders ≤3 levels)
function _commandOfTraitsLine(traitsLine, table) {
  let cmd = 0;
  for (const t of traitsLine.split(",")) {
    const m = t.trim().match(/^(\S+)\s+(\d+)/);
    if (!m) continue;
    const L = table[m[1].toLowerCase()];
    if (!L || !L.length) continue;
    const pts = +m[2];
    let lev = 0;
    for (let i = 0; i < L.length; i++) if (pts >= L[i].threshold) lev = i + 1;
    if (lev === 0 && L.length <= 3 && pts > 0) lev = 1;
    if (lev > 0) cmd += L[lev - 1].command;
  }
  return cmd;
}

// Engine army upkeep (ledger f12) EXACT LAW (Capua disband probe 2026-06-11: faction
// reduced to leader+heir bodyguards alone → ledger 202 = 2 × 45×2.25):
//   regular units:   raw EDU stat_cost upkeep (no scaling — Capua 11-unit army exact)
//   bodyguard units: upkeep × men / (soldiers × sizeMult), where
//     men = soldiers×sizeMult + officers + 2×command   (ordinary family member)
//     men = 2 × (soldiers×sizeMult + officers)         (faction leader & heir — men doubling)
//   sizeMult 4 = HUGE unit-size setting (recruit card shows 27 = 6×4+3 officers).
//   Factions with no `heir` flag in descr_strat get an engine auto-heir at game start.
// Validation vs live ledgers: capua +0.5, julii +6 (0.02%), egypt +28 (0.06%),
// cyrene +13 (0.16%). Replaces the ×1.0122 global constant + leader/heir ×2 law.
const UPKEEP_SIZE_MULT = 4; // huge
function armyUpkeepEDU(modDataDir, faction) {
  const stratPath = path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
  if (!fs.existsSync(stratPath)) return null;
  let us;
  try { us = require("./recruitPool.js").parseUnitStats(modDataDir); } catch { return null; }
  const cmdTable = _commandTraitTable(modDataDir);
  const want = String(faction || "").toLowerCase();
  const lines = _stratLines(stratPath);
  let inWanted = false, regular = 0, units = 0;
  let pendingNamed = false, pendingLH = false, pendingCmd = 0;
  const bodyguards = []; // {upkeep, soldiers, officers, cmd, lh}
  for (const ln of lines) {
    const m = ln.match(/^faction\s+([a-z_0-9]+)\s*,/i);
    if (m) { inWanted = m[1].toLowerCase() === want; continue; }
    if (!inWanted) continue;
    if (/^character[\s,].*named character/i.test(ln)) {   // RIS writes `character\tName, named character` (tab, not comma) — match tab/space too, else every general's bodyguard is misread as a regular unit and the leader/heir miss the ×2
      pendingNamed = true;
      pendingLH = /,\s*(leader|heir)\s*,/i.test(ln);
      pendingCmd = 0;
      continue;
    }
    if (/^character[\s,]/i.test(ln)) { pendingNamed = false; continue; }
    if (pendingNamed && /^\s*traits\s/i.test(ln)) {
      pendingCmd = _commandOfTraitsLine(ln.replace(/^\s*traits\s+/i, ""), cmdTable);
      continue;
    }
    const u = ln.match(/^unit\s+(.+?)\s+exp\b/);
    if (!u) continue;
    const st = us[u[1].trim().toLowerCase()];
    units++;
    if (st && st.upkeep != null) {
      if (pendingNamed) bodyguards.push({ upkeep: st.upkeep, soldiers: st.soldiers, officers: st.officers || 0, cmd: pendingCmd, lh: pendingLH });
      else regular += st.upkeep;
    }
    pendingNamed = false;
  }
  // engine auto-heir: only one of leader/heir flagged in descr_strat (e.g. cyrene has
  // no heir line) but ≥2 named generals → the engine promotes one at game start
  const lhCount = bodyguards.filter(b => b.lh).length;
  if (lhCount === 1 && bodyguards.length >= 2) {
    const promote = bodyguards.find(b => !b.lh);
    if (promote) promote.lh = true;
  }
  let sum = regular;
  for (const b of bodyguards) {
    if (!b.soldiers) { sum += b.upkeep; continue; }
    const base = b.soldiers * UPKEEP_SIZE_MULT;
    const men = b.lh ? 2 * (base + b.officers) : base + b.officers + 2 * b.cmd;
    sum += Math.round(b.upkeep * men / base);
  }
  return { upkeep: Math.round(sum), units };
}

// ---- characters per faction from descr_strat (for the WAGES crack) ----
function countCharacters(modDataDir, faction) {
  const stratPath = path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
  if (!fs.existsSync(stratPath)) return null;
  const lines = _stratLines(stratPath);
  const want = String(faction || "").toLowerCase();
  let cur = null; const counts = { named: 0, general: 0, spy: 0, assassin: 0, diplomat: 0, merchant: 0, admiral: 0, princess: 0, family: 0 };
  let inWanted = false;
  for (const ln of lines) {
    const fm = ln.match(/^faction\s+([a-z_0-9]+)\s*,/i);
    if (fm) { cur = fm[1].toLowerCase(); inWanted = cur === want; continue; }
    if (!inWanted) continue;
    const cm = ln.match(/^character,?\s/i) || ln.match(/^character,/);
    if (/^character[\s,]/.test(ln)) {
      const t = ln.toLowerCase();
      if (/named character/.test(t)) counts.named++;
      else if (/\bgeneral\b/.test(t)) counts.general++;
      else if (/\bspy\b/.test(t)) counts.spy++;
      else if (/\bassassin\b/.test(t)) counts.assassin++;
      else if (/\bdiplomat\b/.test(t)) counts.diplomat++;
      else if (/\bmerchant\b/.test(t)) counts.merchant++;
      else if (/\badmiral\b/.test(t)) counts.admiral++;
      else if (/\bprincess\b/.test(t)) counts.princess++;
    }
    if (/^relative\s/.test(ln)) counts.family += Math.max(0, ln.split(",").length - 2);
  }
  return counts;
}

// ---- CRACKED CONSTANTS (2026-06-09, fit on the 10-faction turn-1 player corpus;
// see rtw-sav-parser/income-*.js drivers + derived/income-truth.json) ----
const CALIB = {
  // TAXES (LOG-CURVE REWORK 2026-06-10, tax-log-model/fit.js): per town
  //   T = K × 400·(ln pop − 4.4) × rate{0.8/1.0/1.2/1.5} × (1+taxable%/100) × govTax%
  // K = 1 for SINGLE-TOWN factions (Capua live quartet exact: 1401/1752/2103/2629)
  // and 0.5544 for multi-town factions — five of ten multi-town player rows sit at
  // 0.554±0.01 (carthage −0.4%, ptolemaic +0.2%, seleucid −1.2%, bactria +0.7%,
  // arverni +0.1%). The user's controlled live flips confirm the POP-DEPENDENT
  // structure (Arretium +372 = W(4500)×Δrate0.5×0.55×f). Mean |err| 6.6% (was 10.8%
  // flat-713). KNOWN DEVIANTS: julii −23%, getae −18%, mauryan +11% — whatever
  // splits them from the 0.554 five is the next reading to take in-game.
  // K_single calibrated on the live Capua quartet ABSOLUTE (W(6750)×f(0.81)×K = 1752
  // → K = 1.2244 = 4/3 × 0.92 — the engine single-town factor is likely a clean 4/3
  // city-state bonus under the documented hard-difficulty 0.92). K_multi 0.5544 =
  // 0.6 × 0.92. Both ÷0.92 give clean engine constants (4/3 and 0.6).
  taxLogK_multi: 0.5544, taxLogK_single: 0.8154, taxFlatSingle: -43.2,
  // EXACT TAX LAW (live julii scroll session 2026-06-11, 15 towns × 4 brackets):
  // taxes_town = taxBaseK·W(pop)·rate·gov + taxFlatPoint·pts·gov, where pts =
  // taxPctParts.base+size+winter (EDB taxable_income_bonus values — they apply FLAT
  // in denarii-per-point, NEVER as percentages; the old f-multiplier was an artifact).
  // The flat term is rate-INDEPENDENT (bracket flips move only the W part — verified
  // exactly on Rome/Camerinum/Croton/Sena/Locri full bracket sweeps). Whole-ledger
  // validation: julii turn-2 = 9,583 model vs 9,447 live (+1.4%, was +23%).
  // ROME-EXACT RETUNE (2026-06-14, 26-town Republic-of-Rome julii corpus with EXACT
  // in-game taxes + REAL save brackets, rtw-sav-parser/exact-tax-data.json): the
  // generalizable 2-param refit (Rome weighted to pin the headline) lands the CAPITAL
  // exactly — Rome 1318/1318 — while keeping the faction Σ exact (model 9,213 vs truth
  // 9,232, −0.2%): taxBaseK 0.4559→0.4683, taxFlatPoint 3.9→4.123. SAME structural form
  // (no constant → generalizes to egypt/cyrene), only K and the per-point coefficient
  // move. 22/26 towns within ±10, 24/26 within ±20. The 2 stubborn residuals are the
  // documented per-campaign fortune (Arpi +56 / Thurii −30): Arpi & Metapontum are
  // FEATURE-IDENTICAL (same buildings, pctAll −90, govTax 0, rate 1.5; differ only pop
  // 2250 vs 2500) yet tax 505 vs 583 — a gap no monotone pop-base consistent with Rome
  // (log-W) reproduces; not in any save byte (Hscan negative on 2 saves). See
  // rtw-sav-parser/exact-tax-crack.md.
  taxBaseK: 0.4683, taxFlatPoint: 4.0,
  // POWER-LAW POP TERM (2026-06-15, controlled live-game derivation — see
  // rtw-sav-parser/exact-tax-crack.md §SESSION 3). The population term is a POWER LAW,
  // not the log used above: K·W = taxPowC·pop^taxPowB. Derived by sweeping a single
  // settlement's population in-game (cheat add_population, governor removed, order held)
  // and reading tax across the full range 1k→31k. The log under-shot high population
  // (it flattens too early — exactly why Rome at 9000 read 877 in-model but 975 live);
  // the power law fits the clean neutral-governor sweep to ±9 (1000→466, 2500→628,
  // 9000→980, anchored on Rome's own with/without-general sweep). Confirmed: settlement
  // LEVEL is irrelevant to the curve (large_town == large_city at equal pop); the apparent
  // high-pop "cap" was SQUALOR in a building-stripped test town, not a tax cap — a real
  // governed/healthy settlement keeps climbing the power law without limit (verified to
  // 31k). taxFlatPoint stays 4.123: the capital-bonus quick-test read ~4.0 (+200 denarii /
  // +50 pts), but the 26-town faction-total live check (julii4 main-mod, game tax 9215)
  // pins 4.123 — at 4.0 the faction Σ over-shoots by +264, at 4.123 by +51 (the residual
  // power-law mid-pop bulge). Rome is FP-insensitive (pts≈−1) so stays exact either way.
  taxPowC: 45.0218, taxPowB: 0.33832,
  // PIECEWISE-LINEAR ABOVE THE KNEE (2026-06-15, controlled pop-sweep §SESSION 3 re-read):
  // the user's fine pop sweeps (Corfinium 100-step then 1000-step, stripped town, no gov)
  // show tax rising LINEARLY with pop above ~2-3k (constant Δ≈+57/1000 pop), NOT on the
  // concave power law. A 2-param power law fit to only Rome's endpoints (1000,9000) BOWS
  // ABOVE the straight truth between them — that bow IS the systematic mid-pop over-estimate
  // (corpus pop 3000-4500 ran ~3-5% high; Neapolis 382 vs live 365). So: keep the power law
  // up to the knee (it fits the low-pop convexity), then go LINEAR to the Rome 9000 anchor.
  // Continuous at the knee, exact at Rome. KNEE=2500 + FP=4.0: with FP restored to the
  // clean capital-derived 4.0 (+50 pts = +200 denarii, sweep-confirmed), the knee that
  // fits the clean targets is 2500 — where the Corfinium sweep actually shows linearity
  // starting (~2k). FP 4.123 had been a kludge compensating the mid-pop bulge; with the
  // bulge gone it pushed the faction Σ and low-pop towns off. FP 4.0 + knee 2500: julii4
  // Neapolis 366 (live 365), faction Σ 9158 (game 9215, −0.6%, was −184 at 4.123), corpus
  // mean-abs-err 14.2 (was 19.5).
  taxPopKnee: 2500,
  // LOW-POP ANCHOR (2026-06-15): the controlled no-gov W-sweeps show the power law is ~5.5
  // LOW at pop 1500 — in-game W(1500)=540 (julii3 Praeneste, governor removed, W-isolated)
  // AND the frozen shadow-mod corpus cluster (Corfinium/Perusia/Larinum, identical no-gov)
  // both read 540 vs power law 534.5. So below the knee the curve is piecewise-linear through
  // the controlled anchors W(1000)=466 (=power law) → W(1500)=540 → W(knee). Fixes the low-pop
  // faction-tax undershoot (the bulk of julii4's −0.6%) without touching the knee+ region
  // (Neapolis stays exact). W is pure population (engine mechanic), so this is mod-independent.
  taxW1500: 540,
  // W(pop) ANCHOR TABLE (2026-06-15) — the controlled no-governor julii4 readings pin the
  // pop→W curve directly (W isolated: governor removed, W = (live − flat)/mult). Piecewise-
  // linear between anchors; power law below 1000 and above 9000 (mega-cities climb it to 31k).
  //   1000:466  1500:540(Corfinium)  2250:614.8(Cosa+Arpi)  3750:701.6(Neapolis)  9000:980(Rome)
  // The 2250→3750 chord (slope 0.058) also passes through Metapontum (2500→628.9) and the
  // corpus 3000 (658) exactly. Replaces the single power-law/knee form: the power law was too
  // STEEP in the 2250-2500 band (Cosa/Arpi base +3.3 low, Metapontum +10 high) — the real
  // curve bends gently. All anchors confirmed by no-gov in-game readings.
  // WINTER-FREE re-anchor (2026-06-15): turn-1 tax no longer folds the disabling_in_winter
  // penalty, so W(pop) is re-derived from no-governor turn-1 game reads with taxPts =
  // base+size only — W = (live − 4·(base+size))/rate. Confirmed points: Sena 1200 low 252,
  // Arpi 2250 vh 562, Neapolis 3750 n 365, Arretium 4500 n 360, Rome 9000 vh 1465. Low-pop
  // (<1200) is provisional pending the Sena 100→2000 pop sweep.
  // 1500 anchor wired to the directly-measured taxW1500=540 (julii+cyrene no-gov reads, and
  // independently confirmed on all 6 basic pop-1500 Carthage towns 2026-06-16: each implies
  // W(1500)=540 exactly via truth−4·pts). Was an interpolated 515 — the measured 540 had been
  // sitting orphaned in CALIB.taxW1500 but never wired into the anchor table.
  // [12000, 925] added 2026-06-16 from the live Carthage tax-RATE experiment: Carthage
  // (pop 12000) reads Taxes 720/905/1090/1368 at low/normal/high/vh — the rate slope gives
  // W(12000) = (1090−905)/(1.2−1.0) = 925 EXACTLY (independent of buildings). Rome anchors
  // W(9000)=912.67, so the curve is NEARLY FLAT 9000→12000 (slope 0.004/pop), NOT the power
  // law's steep climb to 1080 — the old power-law extrapolation over-taxed every big city.
  // Pop >12000 still uses the power law (egypt mega-cities unverified at flat; left as-is).
  // [5000, 670] added 2026-06-16 from the live Hadrumetum tax-rate experiment (pop 5000,
  // Adrumet): Taxes 200/334/468/670 → W=(468−334)/0.2=670 (all 4 fit mult·670−336). Nearly
  // flat from the 4500 anchor (668), so the old 4500→9000 linear chord over-read mid-5000s.
  taxWanchors: [[1000, 430], [1200, 455], [1500, 540], [2200, 577.5], [2250, 580], [3000, 592.5], [3750, 649], [4500, 668], [5000, 670], [9000, 912.67], [12000, 925]],
  // ★ MEASURED popBase(pop) — the pure populace-tax-base curve, from the Bruttians controlled
  // experiment (2026-06-16): a 2-settlement faction stripped to core+gov+region_base, both
  // settlements swept across population at all 4 tax rates. Tax law cracked denarius-exact:
  //   tax_town = floor( rate · ( popBase(pop) + taxPointK·pts ) )   [MULTIPLICATIVE, not additive]
  //   rate ∈ {0.8,1.0,1.2,1.5}; pts = EDB taxable_income_bonus sum (empire-size region_base etc.).
  // popBase is TIER-INDEPENDENT (town=large_town=city identical) and always a half-integer (X.5),
  // so single-rate reads are exact. There is a −125 DISCONTINUITY at pop 9707 (verified real:
  // not squalor, not order, not tier — a fixed population threshold). Values are H/H in-game reads
  // (used directly for the player; the AI block divides out 0.92 separately).
  // Dense gap-fill points (2026-06-22) MEASURED from the 84-settlement live Ptolemaic turn-1 save:
  // the old coarse table linearly-interpolated the 2000→2500 and 2500→3000 gaps wrong (2100 read
  // 603.9, real 606.5). Each added point is the exact half-integer the in-game tax implies for a
  // positive-tax town at that pop (governors exact from the save; building points integer from EDB).
  popBasePre: [[400,301.5],[450,324.5],[500,347.5],[550,363.5],[600,373.5],[700,396.5],[800,419.5],[900,442.5],[1000,465.5],[1100,488.5],[1150,500.5],[1200,505.5],[1300,517.5],[1400,528.5],[1500,540.5],[1600,551.5],[1650,556.5],[1700,563.5],[1800,574.5],[2000,597.5],[2100,606.5],[2200,612.5],[2300,617.5],[2400,623.5],[2500,629.5],[2700,640.5],[2750,643.5],[2800,646.5],[3000,658.5],[3200,669.5],[3250,672.5],[3400,681.5],[3500,686.5],[3800,704.5],[4000,715.5],[4100,721.5],[4500,744.5],[5000,773.5],[5500,801.5],[6000,830.5],[6500,859.5],[7000,888.5],[7500,917.5],[8000,945.5],[8500,965.5],[9000,979.5],[9350,989.5],[9706,1000.5]],
  popBasePost: [[9707,875.5],[10000,879.5],[12000,908.5],[14000,936.5],[16000,965.5],[18000,994.5],[20000,1023.5],[24000,1080.5],[30000,1166.5],[34000,1215.5]],
  // ZERO TRADE PINS — fully dynamic (user mandate 2026-06-17: "0 pinns, dynamic at all
  // cost"). When true, every hardcoded measured trade value (tradeMeasuredByPlayer per-town
  // totals, landLaneRows per-route land, seaLaneF per-lane sea f, seaLaneSeeds observed lane
  // sets) is IGNORED, so trade is computed 100% from EDB + descr_strat + save and recomputes
  // when you edit any faction. The pin tables below are retained ONLY as validation reference
  // and are dead while this is true. Set false to restore the old calibrated path.
  dynamicTradeOnly: true,
  taxCliffPop: 9707, // pop at/above which the −125 step applies (popBasePost vs popBasePre)
  // WONDER TAX — world-wonder buildings (RIS temples_of_viking / temple_of_horse_2 chains)
  // that grant a taxable_income_bonus make their town use the CAPITAL tax treatment: the
  // points count multiplicatively inside the rate (M=40, ×rate) instead of the non-capital
  // flat M=4. Validated on the Oracle of Dodona (temple_of_viking_sp6, taxable_income_bonus
  // 8 requires faction_religion_group_hellenic): live Epirus Dodona turn-1 2026-06-17 reads
  // 455/568/682/853 at low/normal/high/vh = floor(rate·(popBase+40·Σ)), Σ=1 — EXACT (±1).
  // (User shorthand "+8%×rate×popBase"; for this town 40·Σ = 40 ≈ 0.076·popBase.) Match by
  // building level-name suffix so a relocated/upgraded wonder still triggers. Add other
  // tax wonders here once a live reading confirms they behave the same (Parthenon sp1 etc.).
  taxCapitalWonders: ["temple_of_viking_sp6"],
  taxPointK: 40,     // denarii per EDB taxable point, at Normal rate, INSIDE the rate multiply
  // DIFFICULTY (Feral docs, Battle_and_Campaign_Formulae.md): the human player's tax
  // and farm income scale by difficulty — Easy 1.20 / Normal 1.00 / HARD 0.92 /
  // Extreme 0.85. The user/team plays H/H, and every constant below was fit on H/H
  // ledgers, so 0.92 is baked in explicitly. (Hard also gives the human +400 bonus
  // denarii per round and +2 order, and the AI an income bonus scaling to 120% by
  // region count — the AI tax-floor we measured.)
  difficultyIncome: 0.92,
  // AI INCOME BONUS (hard; cracked empirically, ai-bonus-crack.js on 215 AI ledgers):
  // tiered by empire size. The raw ratios vs our 0.92-baked model were ×1.97/1.49/
  // 1.28/1.0; the AI does NOT pay the human 0.92 malus, so the pure AI bonus =
  // ratio × 0.92 → ≈ ×1.81 (1 town) / ×1.37 (2-4) / ×1.18 (5-9) / ×0.96≈1.0 (10+).
  aiBonusByTier: { 1: 1.81, 2: 1.37, 3: 1.18, 4: 1.08, 5: 1.0, 6: 1.0, 7: 1.0, 8: 1.0, 9: 1.0, 10: 1.0 }, // legacy (old vintage)
  // AI REFIT 2026-06-11 on a CURRENT-vintage fresh turn-1 save (215 AI ledgers):
  // farming bonus is FLAT 1.188 at every tier (medians 1.188 across tiers 1-8);
  // taxes need a tier-indexed correction on top of the flat-points model (folds the
  // AI hinterland lines' true response — tier-1 city-states earn ~2× modeled, the
  // old K_single mystery): medians below, tier 5 interpolated (no sample).
  aiFarmBonus: 1.188,
  // rescaled 2026-06-11b after dropping the script-destroyed gov/colony buildings
  // from AI features (the causal fix shifts the baseline; tiers re-centered on the
  // same 215-ledger refit):
  aiTaxFixByTier: { 1: 1.976, 2: 1.585, 3: 1.40, 4: 1.19, 5: 1.05, 6: 0.90, 7: 0.83, 8: 0.89, 9: 0.9, 10: 0.9 }, // legacy
  // AFFINE AI tax corrections (2026-06-11c, regression on 215 current-vintage ledgers):
  // truth = slope·modelNeutral + intercept per tier. Tier 1 is ~CONSTANT (the engine
  // guarantees AI city-states ≈3.9k tax regardless of size — the subsidy floor,
  // med|err| 1.7%); tier 2 R²=.83 med 6.7%; tiers 6-8 carry the multiplicative values.
  aiTaxAffineByTier: { 1: [0.30, 3309], 2: [1.78, -415], 3: [1.14, 706], 4: [1.31, -919], 5: [1.05, 0], 6: [0.90, 0], 7: [0.83, 0], 8: [0.89, 0], 9: [0.9, 0], 10: [0.9, 0] },
  // trade + corruption per-tier corrections (same 215-ledger refit; ratios are truth/model
  // AFTER the flat 1.188, so these multiply on top of it):
  aiTradeFixByTier: { 1: 0.66, 2: 0.66, 3: 0.94, 4: 1.0, 5: 1.0, 6: 1.34, 7: 1.29, 8: 0.91, 9: 1.0, 10: 1.0 },
  aiCorrFixByTier: { 1: 1.0, 2: 1.81, 3: 1.34, 4: 1.52, 5: 1.2, 6: 1.07, 7: 0.89, 8: 0.71, 9: 1.0, 10: 1.0 },
  aiAdminFixByTier: { 1: 1.27, 2: 0.86 }, // measured medians (n=14/28); other tiers too noisy → 1.0
  // farming = 80 × difficulty × Σ(region farmN + EDB farmLevel + governor Farming pts)
  // × Hanging-Gardens. THE ENGINE CONSTANT IS DOCUMENTED: EDB.md "farming_level: plus
  // 80 income (average harvest) per point" — our fitted 73.61 = 80 × 0.92 exactly.
  // EXACT 11/11 player factions at ratio 1.000 (mean |err| 0.01%).
  farmPointBase: 80,
  get farmPoint() { return this.farmPointBase * this.difficultyIncome; },
  // MINING CRACKED EXACT 2026-06-10 (mining-crack2.js): per mine town,
  //   mining = 5 × mine_resource(EDB level value: gold 12/20, silver 9/15, other 6/10)
  //              × Σ(quantity × tradeValue) of the region's MINEABLE resources
  // (quantities from the resource_quantity override). 5/6 corpus factions EXACT to the
  // denarius: arverni 600, athens 600, kush 180, seleucid 480, antigonid 900; oretani
  // reads 2× (one border silver tile likely attributed to the wrong region). The old
  // flat minePoint=50 was the arverni coincidence (its qtyVal happened to be 10).
  minePoint: 5,
  // trade = tradeLand×Σ_towns g·rv·(1+landPartners) + tradeSea×Σ_portTowns g·rv·√(seaPartners).
  // g = 1 + 10%×(trade_base_income_bonus points, base+winter buckets only) — the
  // 10%/point unit is DOCUMENTED (Feral EDB.md: "adds 10% to base value of land trade
  // & sea exports"); size-gated lines are inactive at turn 1 like taxes. landPartners =
  // pixel-adjacent regions owned by self/ally (≤199 = trade agreement); seaPartners =
  // self/ally PORT towns sharing a sea body. Refit 2026-06-10 (trade-qty-retest.js):
  // mean |err| 13.1%, more uniform (ptolemaic 1%, seleucid 0%, most others ±10-15%).
  tradeLand: 0.8656, // legacy aggregate (unused for land since the per-route law)
  // PER-ROUTE LAND LAW (2026-06-11, fit on 14 live scroll routes; A_X re-derived
  // against THIS model's adjacency graph — R²log .96 on 6 measured towns):
  // v(route) = K·popX^a·e^(p·tradePctX) × e^(r·roadY)·(rvX+rvY)^g·popY^−b
  // LAND LAW v3 (2026-06-12, julii 26-town t1 corpus 118 rights-rows + capua anchors,
  // R² 0.947 vs v2's 0.755): the TRADE-RIGHTS split was the missing structure —
  // partners without trade rights (suzerain/client links from become_protector)
  // trade at ×0.33 (our empirical no-rights median was 0.349 over 17 rows; Feral's
  // published Battle_and_Campaign_Formulae.md TRADE section gives the EXACT engine
  // constant 0.33 for "no trade rights with the owner" — adopted 2026-06-13). With the
  // rights tier separated, popY's sign FLIPS POSITIVE (+0.133 — routes to big towns
  // are richer; the old −0.109 was rights-contamination). Only the unmeasured-town
  // LAW fallback uses this; all corpus towns are landLaneRows-pinned.
  tradeRouteK: 0.2837, tradeRoutePopX: 0.2237, tradeRoutePct: 0.1563,
  tradeRouteRoad: -0.0728, tradeRouteRvX: 0.5939, tradeRouteRvY: 0.2746, tradeRoutePopY: 0.1333,
  tradeNoRights: 0.33,
  // LAND-TRADE LAW (cracked LIVE 2026-06-17 via ~30 descr_strat experiments; replaces the
  // bogus pop/road regression). route(X→Y) = (rateBase + ratePct·tradePctX) × (exportCargo
  // + importFrac·importCargo + const) × (1+min(roadX−1,roadY)) × (1+0.74·govTrade%).
  //   rate = 2.0 + 0.2·tradePct  — Rome tradePct5→3.0, Cosa1→2.2, Neapolis−5→1.0, inland−6→0.8
  //     (all denarius-exact; tradePct = net trade_base_income_bonus from market+pottery/salt/
  //      agroforestry industries − size penalty; NOT coastal/pop/capital — those were spurious).
  //   cargo = Σ qty×value (descr_strat qty × descr_sm value) of goods the OTHER side LACKS
  //     (exclusion rule; value-scaling proven: grain1/glass2/amber3; quantity LINEAR).
  //   import side counts at ½; const ≈6.5 (flat baseline ≈ ½ exporter's own goods value).
  tradeLandRateBase: 2.0, tradeLandRatePct: 0.2, tradeLandImportFrac: 0.5, tradeLandConst: 6.5,
  // LAND PARTNERS = type-0 REGION_FRONTIER edges from map.rwm (the game's exact connectivity,
  // 2026-06-18). f10 = per-frontier distance/cost; the far tail does not form a route.
  // Baktria: 5 traded all f10<=319, the 2 excluded (Margiane/Notia_Margiane) f10>=493 → cutoff ~400.
  // useFrontierGraph swaps pixel-adjacency for the frontier graph; falls back to adjacency if absent.
  useFrontierGraph: true, frontierF10Cutoff: 400,
  // LAND-LANE LIVE PINS (2026-06-12, three corpora: julii 26-town t1 scrolls
  // [jcrops/julii/routes-all.tsv — every town's land partner list COMPLETE, row
  // sums = scroll totals], capua clean-vintage scroll [Freg 91/Bov 60/Malev 184/
  // Nea 155 = live 491], kyzikos probe [Daskyleion 78]). Land rows are PER-SIDE
  // (each scroll shows its own row; reverse direction is the partner's own row).
  // Where a town has a pin set, it is the COMPLETE live partner list → land trade
  // = Σ pins (replaces the v3 regression for that town; unmeasured towns keep the
  // law). MEASURED MARGINALS (Campania wine 4→5 probe, per wine file-value pt):
  // →Fregellae +3, →Bovianum +2, →Maleventum +6 — per-lane multipliers are REAL
  // and lane-specific (like seaLaneF); the pins capture them at HEAD-strat cargo.
  // VINTAGE-BOUND: re-read after map/strat rebalances (any goods edit moves rows).
  // Generated by rtw-sav-parser/gen-land-pins.js.
  landLaneRows: {
    "Roma": { "Camertia-Nahartia": 64, "Sabinia-Aequia": 68, "Etruria_Meridionalis": 163, "Faliscia": 102, "Latium": 120 },
    "Umbria": { "Sassinia": 3, "Ager_Gallicus": 10, "Etruria_Orientalis": 13, "Picenum": 5, "Camertia-Nahartia": 9 },
    "Latium": { "Sabinia-Aequia": 7, "Marrucinia-Vestinia": 4, "Paelignia-Marsica": 7, "Roma": 11, "Latium_Novum": 8 },
    "Sabinia-Aequia": { "Camertia-Nahartia": 16, "Picenum": 7, "Marrucinia-Vestinia": 10, "Latium": 19, "Roma": 34 },
    "Camertia-Nahartia": { "Umbria": 4, "Picenum": 2, "Etruria_Orientalis": 4, "Sabinia-Aequia": 5, "Faliscia": 5, "Roma": 11 },
    "Ager_Gallicus": { "Sassinia": 5, "Umbria": 13, "Picenum": 6 },
    "Latium_Novum": { "Latium": 18, "Pentria-Carricinia": 16, "Campania": 37 },
    "Paelignia-Marsica": { "Latium": 6, "Marrucinia-Vestinia": 6, "Pentria-Carricinia": 4 },
    "Marrucinia-Vestinia": { "Picenum": 3, "Sabinia-Aequia": 6, "Frentania": 7, "Latium": 6, "Paelignia-Marsica": 8 },
    "Parthenope": { "Campania": 22, "Samnium": 21, "Hirpinia": 19, "Poseidonia": 18 },
    "Samnium": { "Pentria-Carricinia": 18, "Hirpinia": 20, "Campania": 46, "Parthenope": 37 },
    "Frentania": { "Marrucinia-Vestinia": 5, "Pentria-Carricinia": 6, "Daunia": 8 },
    "Poseidonia": { "Parthenope": 36, "Hirpinia": 31, "Lucania_Vetus": 36, "Lucania": 28 },
    "Daunia": { "Frentania": 14, "Pentria-Carricinia": 13, "Hirpinia": 14, "Peucetia": 14 },
    "Peucetia": { "Kanysion": 26, "Daunia": 27, "Calabria": 11, "Lucania_Vetus": 25, "Metapontion": 18, "Taras": 34 },
    "Kanysion": { "Peucetia": 10 },
    // CYRENE live land rows (scrolls 2026-06-11 morning, land-rows-corpus.json;
    // folded in with the cyrene sea-lane f pins, TASK B revalidation 2026-06-12):
    "Kyrenaike": { "Barke": 250, "Katabathmos": 95 },
    "Barke": { "Kyrenaike": 90, "Hesperos_Kyrenaike": 30 },
    "Katabathmos": { "Kyrenaike": 38, "Hesperos_Aigyptos": 14 },
    "Hesperos_Aigyptos": { "Katabathmos": 13 },
    "Hesperos_Kyrenaike": { "Euesperidai": 25, "Barke": 6, "Augila": 6, "Euphranta": 4, "Castrum_Psyllorum": 4 },
    "Euesperidai": { "Hesperos_Kyrenaike": 30, "Taucheira": 36 },
    "Taucheira": { "Euesperidai": 30 },
    "Lokroi_Epizephyrioi": { "Bruttium": 10 },
    "Thourioi": { "Lucania_Vetus": 12, "Metapontion": 9, "Bruttium": 12, "Chonia": 11 },
    "Metapontion": { "Peucetia": 8, "Lucania_Vetus": 10, "Taras": 14, "Calabria": 4, "Thourioi": 8 },
    "Kroton": { "Bruttium": 8, "Chonia": 6 },
    "Etruria_Septentrionalis": { "Apuania": 3, "Boia": 5, "Etruria_Occidentalis": 14 },
    "Etruria_Occidentalis": { "Etruria_Septentrionalis": 12, "Boia": 3, "Etruria": 9, "Etruria_Meridionalis": 12 },
    "Etruria_Meridionalis": { "Etruria_Occidentalis": 40, "Etruria": 37, "Velzna": 36, "Faliscia": 37, "Roma": 53 },
    "Etruria": { "Etruria_Occidentalis": 15, "Sassinia": 7, "Etruria_Orientalis": 22, "Etruria_Meridionalis": 21, "Velzna": 22 },
    "Etruria_Orientalis": { "Etruria": 11, "Umbria": 7, "Camertia-Nahartia": 5, "Velzna": 8 },
    "Faliscia": { "Velzna": 15, "Camertia-Nahartia": 9, "Etruria_Meridionalis": 16, "Roma": 13 },
    "Campania": { "Latium_Novum": 91, "Pentria-Carricinia": 60, "Samnium": 184, "Parthenope": 155 },
    "Arktonnesos": { "Mysia": 78 },
  },
  tradeSea: 1.1169, // sea aggregate re-anchored: julii total = 4,610 live with the land law in place // REFIT 2026-06-11 after the structural trade fixes
  // (qty-weighted rv + not-at-war partners + symmetric ally parse) — anchored to the
  // live julii ledger trade 4,610 (clean t2), keeping the old land:sea ratio 2.042.
  // Old 4.75/9.70 were fit on the broken features (empty julii ally set, Set-based rv).
  tradeBonusPct: 10,
  // wages = 200×named character + 50×admiral (EXACT on fresh saves).
  wageNamed: 200, wageAdmiral: 50,
  // corruption ("other" expenditure) — REFIT 2026-06-10 (corruption-refit.js), now
  // INCOME-PROPORTIONAL (live-confirmed: julii corr/income identical across tax flips):
  // corruption (REFIT 2 2026-06-12, live julii 6-town fresh battery — corruption-refit-2.md):
  // per-town % of GROSS income (tax+farm+mine+trade+admin), LINEAR law (corrB 0):
  // corr% = corrA·(d−corrD0) for d>corrD0. Fresh rmse 0.35pp, max |resid| 0.62pp
  // (all six ≤1pp); Egypt-80 out-of-sample rmse 3.06pp unchanged vs old curve.
  // corrLawPct 3 double-confirmed live via HarshJustice probe (Nossis/Locri): EDCT
  // ladder is Law +2/+4/+6 but HJ is an ANTI-TRAIT of Just — stripping Just/1 makes
  // the net settlement deltas +1/+3 → 2.97/2.93 pp/lawpt, exactly linear.
  corrA: 0.64, corrB: 0, corrD0: 11.25, corrLawPct: 2.5,
  corrNegLawShift: 4, // tiles of effective distance per NEGATIVE law point (Pisae console probe + cyrene trio)
  corrCap: 60, // far-distance saturation (live Egypt: d141/226/351 all read 59-64% — NOT the old 90% linear climb)
  seaLaneMaxDist: 40, riverBodyMaxCells: 1500, seaFlowRiverMult: 1.0, // river flows run hotter (Nile live 713/605/519) // sea-path tiles; lanes are local (live: Kyrenaica forms NO Aegean lanes; Sena→Nesactium ~15 allowed)
  // ENGINE SEA GRAPH (2026-06-22): use the map.rwm LANDING-FRONTIER graph (exact sea candidates +
  // distances) for sea-lane formation instead of the pixel-BFS. seaLaneMaxDistLF = generous bound
  // (the engine profit-ranks all sea-reachable ports; the slot limit caps the count, not distance).
  // GATED OFF by default: the landing-frontier graph is the CORRECT engine candidate+distance source
  // (extracted from map.rwm, validated — Kichyros now sees Stratos), but the per-route VALUE law was fit
  // on the old pixel-BFS distances, so switching the distance source alone under-shoots (Epirus Stratos
  // reads 7 vs game 218) AND regresses the BFS-fit factions (Carthage 6867→6524). Turning this on needs
  // the sea-value law RE-FIT to the engine distances + partner-selection refined. Toggle for dev/test.
  useLandingFrontiers: true, seaLaneMaxDistLF: 250, seaSelPopY: 1.0,
  // LANDING-FRONTIER sea value law (Epirus live per-route fit 2026-06-22): export = seaK_LF · landRate^G
  // · popX^2 · d^-3 · (cargo + seaConst_LF) · rights. Steep distance + pop² (engine each-port-own-export).
  seaK_LF: 2650, seaK_LF_vanilla: 770, seaPopExp: 0.48, seaBandOwn: 0.33, landBandOwn: 0.5, landOwnBoostVanilla: 3.12, tradeLandImportFracVanilla: 0, seaBandAgree: 0.66, seaBandForeign: 0.33, seaImportCut: 0.2, straitBorderMax: 2, seaInvalidF10: 1e9, seaDistFloor: 45, landK_LF: 600, landBordC: 0.05, landF10Floor: 20, landBandBump: 1.6, seaPopX_LF: 2.0, seaDist_LF: -3.0, seaConst_LF: 13, // seaK_LF = the 8×band×C constant of the exe formula (0.1·√pop+cargo)·band·C/dist
  // ★ VANILLA (map 0x78) sea law — EXE-cracked 2026-06-24 (MAP_REGIONS::routeValue FUN_1414a3e70):
  //   export = seaKV · (seaPopCoefV·fastSqrt(popX+popY) + cargoFull) · gate / dNav   (dNav = map.rwm landing-frontier distance).
  // cargo = Σ qty×descr_sm tradeValue of the exporter's goods the partner lacks (FULL value, NOT flat-1 — confirmed from the
  // route-value asm: IMUL qty×tradeValue). seaKV = engine 8×100=800. Pop coeff fit to 0.145 (≡ binary 0.1 over the engine's
  // ~2.1× population; land's exact 0.13·√descr-pop is the same identity). gates fit on the turn-1 scroll corpus
  // (scripts/vanilla-trade-gt.json): foreign 0.5, own 0.36 (internal naval trade penalised), trade-agreement 0.66.
  // K/popCoef/own-gate are a joint fit (scratchpad tune.js) min'ing the 6-faction turn-1 total error 234→120.
  seaKV: 800, seaPopCoefV: 0.1, seaGateForeignV: 0.5, seaGateOwnV: 0.33, seaGateAgreeV: 0.66,
  // TRUE same-faction sea gate (Carthage→own Lilybaeum, market-removed isolation 2026-06-25: base 168 vs the
  // SPQR-internal 0.36's 175) is a hair lower than the SPQR-group gate (Julii/Brutii/Scipii trade as 0.36).
  seaGateTrueOwnV: 0.33,
  // RIS-only protectorate (trade-agreement) sea gate — Rome's client factions (Bruttii/Taras/Samnites via
  // become_protector) trade nearer to own; the shared 0.66 under-reads them. Vanilla keeps seaGateAgreeV.
  seaGateAgreeRisV: 0.82,
  // Engine reads a larger-than-displayed trade population: the sea pop term = seaPopCoefV·√pin + seaBaseTerm
  // (constant). Controlled descr_strat experiments 2026-06-25 (Carthage cargo 22→72 AND pop 6k→90k) fix the
  // effective term to ~15 at displayed pin 9000 → 0.1·√pin + ~5.15. Reproduces both the pop-response (202→316 at
  // pop 6k→90k) and the cargo-response (202→474) to the denarius. seaKV=800 and own-gate=0.33 are PROVEN exact by
  // the cargo derivative ΔV/ΔC=272/50=5.44=800·M/dNav·gate (Gemini 2nd-analyst slope check); seaKV=800≡the binary
  // 8×100, own-gate 0.33≡the asm reachability ×0.33. baseTerm absorbs the bit-hack-vs-true-sqrt offset (~5.15).
  // OPEN: the +5.15's binary origin (NOT in routeValue/selector/pop-getter; land uses same getter & is linear).
  seaBaseTerm: 5.15,
  // strong flow: v = K·pop^exp·e^(pct·tradePct) — refit on 16 current-build flows
  // (full julii 26-scroll corpus + cyrene, 2026-06-11 evening; R²0.82, max ×1.61).
  // The pct coefficient ≈ the historic 0.127 sea exponent; pop is nearly irrelevant.
  seaFlowK: 63, seaFlowPopExp: 0.111, seaFlowPct: 0.133, // river lanes only (Nile fit)
  // OPEN-SEA EXACT (Capua t1 trio 2026-06-11: 426/13, 332/10, 100/3 — also pct-free:
  // Capua pct +6 and Praeneste pct −6 share the same constant)
  seaCargoK: 33,
  // DATA-DRIVEN sea law for UNPINNED lanes. v1: seaLawA/B/C (√popSum + cargo + cargo/d).
  seaLawA: 0.37, seaLawB: 8.98, seaLawC: 42.59,
  // v2 (2026-06-16): log-linear fit on the 26-route Carthage live corpus (per-route
  // EXPORT values transcribed from the in-game settlement-income scrolls). KEY FINDING:
  // export is governed by an INVERSE-DISTANCE power law and the EXPORTER's size, NOT by
  // cargo qty — export ≈ e^b0 · cargo^bCargo · e^(bTPct·tPct) · popExporter^bPopF ·
  // d^bD · popImporter^bPopT. The d exponent is ≈ −1.64 (short hops to the capital
  // dominate), which the old cargo/d term under-weighted, causing hub-cities to be
  // under-counted and remote towns over-counted. R²(log)=0.69, ΣpredΣtruth=0.95.
  // All inputs are mod/save-derived (descr_strat pop, EDB trade buildings, lane distance)
  // so it still auto-updates. cyrene/julii lanes stay PINNED (seaLaneF) → unaffected.
  // v3 (2026-06-16, CLEAN-DATA refit): the v2 fit was POLLUTED — every settlement panel
  // lists both EXPORT rows and IMPORT-shadow rows (import = export/5, engine-confirmed), and
  // v2 fit them all as exports. Reclassifying each route via the /5 law (the larger of a
  // bidirectional pair is the export; the ~1/5 partner row is its shadow) and refitting on
  // the 18 CLEAN sea exports lifts R²(log) 0.69→0.90 and per-route MAE 35.8→18.1. Applied to
  // all lanes (export = law, import = law/5): faction trade +1.2%, per-town MAE 33.5→29.4,
  // hub cities now tight (Carthage −84, Clupea +30, Tingi +5). b0 2.405→2.70 balances the
  // faction total (the clean sample skews to large routes). Inputs stay mod/save-derived.
  seaLaw2: { b0: 2.70, bCargo: -0.0313, bTPct: 0.0954, bPopF: 0.3530, bD: -0.6433, bPopT: 0.1821 },
  // ★ CRACKED SEA VALUE LAW (2026-06-18, Rome/Cosa/Sena amber qty5+qty40 pairs, gov out):
  //   sea(X→Y) = landRateX · rights · (seaMarginal·cargo + seaBaseK·popX^px·popY^py)
  //   - landRate = 2.0+0.2·tradePctX (same exporter rate as land); cargo = LINEAR qty×value
  //     exclusion (qty5 & qty40 give identical per-unit → no saturation, unlike old effQ).
  //   - MARGINAL per qty×value = landRate·6 (Rome→Fregellae 18.7, Cosa→Praeneste 12.8 measured).
  //   - rights OWN 1.0 / ALLY(protectorate) 0.74 / FOREIGN 0.43 (confirmed 3 ways: Rome→Capua
  //     1927 = own-rate×0.74; Sena→Nesactium ×0.43).
  //   - popBaseline = the no-special-cargo floor, rises with both pops (fit on 3 own/ally lanes:
  //     Rome→Fregellae 72, Rome→Capua 85, Cosa→Praeneste 42). seaFactor flat in fleet (fleet =
  //     lane-FORMATION only; fleet0 = no sea). Replaces the refuted pop-only seaLaw2.
  // ★★ SEA EXPORT — CRACKED STRUCTURE (2026-06-18, Kyrene controlled amber experiment, gov out):
  //   sea(X→Y) = seaK·popX^a·popY^b·d^c·(cargo + seaConst) · rights · gov
  //   SAME SHAPE AS LAND (rate × (cargo + const)) but with a STEEP DISTANCE factor instead of roads.
  //   - cargo = FULL-exclusion qty×value of X's goods Y lacks (amber test: Kyrene→Arsinoe baseline
  //     cargo 20, +120 amber = 140; both reproduce exactly). NOT the suppressed lanePts.
  //   - seaConst = 10.55 PINNED EXACT by amber dilution (Kyrene→Arsinoe 2183/443 = (140+C)/(20+C)).
  //   - distance d^c steep (Kyrene d24→14.5, d32→9.2 per-cargo ⇒ c≈−1.58 alone; ~−1.15 w/ pop terms).
  //     NOTE: d should be SEA-DEPTH-WEIGHTED path (user: shallow=full / medium≈½ range / deep=blocked,
  //     + a max-range cutoff) — the plain BFS d leaves ~18% on d16 routes. That's the final refinement.
  //   - rights: own/with-trade-rights 1.0, no-rights 0.5 (Quietus guide: trade rights = ×2 sea export).
  // distance exponent MEASURED LIVE 2026-06-18 (Issa→Asculum forced-corridor: shallow 546 →
  // full-medium 294 gov-out ⇒ medium=2.0× distance, value ∝ distance^-0.89). Re-fit on Cyrene
  // with c fixed: route = seaK·landRate^seaExpG·d^-0.89·(cargo+seaConst)·popX^.13·popY^.06·rights.
  // const re-confirmed ~10 (matches the amber-pinned 10.55). TODO tomorrow: swap d for the
  // depth-weighted white-pixel-port path distance (seaPortDist) + pin seaExpG with varied-cargo data.
  // v0.9.1159: seaExpG = 1.0 PROVEN (Carthage market great_forum→trader experiment 2026-06-18:
  // all routes, sea AND land, scaled by landRate^1.0 exactly — Clupea 592→465, Eryx 260→204, etc.).
  // Exporter rate is LINEAR landRate, identical to land trade; imports key off the partner's rate.
  // Refit K 14.27 / const 8.33 with g=1.0 (19% on Cyrene+Carthage). NOTE: amber-pinned const=10.55
  // gives 29% here (all under) → a ~1.25× factor is still missing in the cargo/reversed-lane term
  // (Barke⇄Euesperides asymmetry) — the next target. Distance = depth-weighted white-port path.
  seaK: 13, seaExpG: 1.0, seaPopX: 0.13, seaPopY: 0.06, seaDist: -0.89, seaConst: 9.86, seaImportFrac: 0.347,
  seaRightsForeign: 0.5,
  // EFF PER-UNIT WORTH CURVE (2026-06-12 probe battery refinement, replaces the
  // kink-4/0.32 form): a resource's q-th quantity unit is worth seaEffUnits[q−1]
  // (then seaEffTail per unit beyond the table). MEASURED, in exclusion-cargo pts
  // units (the f≈33 lane accounting):
  //   • units 1-4 = 1.0 each (Capua trio exact: eff(4)=4);
  //   • unit 5 = 0.42 — Campania wine 4→5 probe: Rome-lane live Δ = +14 = 33.2 ×
  //     0.42 (the memory's "0.84 at f=16.6" is the SAME datum in full-basket
  //     accounting — Campania basket 20 = 2× its exclusion cargo 10);
  //   • units 6-7 ≈ 0.30/0.28 — Messana wine-5/wine-7 Panormos rows 65 & 74:
  //     eff(5)=4.42/eff(7)=5.00 → f 14.7, ratio 1.131 vs live 1.138;
  //   • tail 0.28/unit — horses-9 probe pins eff(9) = 5.56 (Rome-lane Δ +85 =
  //     33.2 × (eff(9)−eff(3)); validated vs probe-vintage live 570/417 at ±6).
  seaEffUnits: [1, 1, 1, 1, 0.42, 0.30, 0.28],
  seaEffTail: 0.28,
  // SEA VALUE SYSTEM CLOSED (2026-06-12 probe chain): FILE VALUE RATIOS ARE CORRECT
  // (f_Freg = 20.0/value-pt EXACT across salt/glass/dyes/pottery deltas); the old
  // salt=3/timber=2 overrides were saturation artifacts — REMOVED.
  // MARKET-SATURATION LAW (glass/salt/dyes/pottery delta chain, live-proven):
  // a good's worth on a lane collapses to ~0.18× when the importer's holdings of it
  // from COMPETING routes beat the exporter's qty (relative rule: exporter qty >=
  // competitor qty keeps FULL worth; land competitor needs qty >= 3 to suppress —
  // the (RomaGlass,ParthGlass)->CapuaRow state table: (1,0)=(1,1)=(1,2)=259,
  // (1,3)=230, (3,3)=318). Zero-trade-value goods (stone/hemp/pitch/flax) never
  // compete (Praeneste stone-3 ships FULL past Parthenope's stone-4 at Capua) but
  // DO ship at value 1 (floored).
  seaSuppress: 0.18,
  // PER-LANE f (flow = f × Σ qtyShipped × fileValue). The f LAW IS STILL OPEN —
  // measured f spans 8–95 per lane+direction and regresses poorly on building/pop/
  // rights/distance features (R²log 0.71, f-regress.js 2026-06-12). Until cracked,
  // measured lanes carry their live-calibrated f (cross-campaign stable where
  // double-measured: Campania>Roma 332 capua-game vs 335 julii-game; Latium>Campania
  // shows the only player/AI split — ×0.49 when the PLAYER owns Praeneste, two
  // campaigns each way). Keyed 'ExporterRegion>ImporterRegion' → { ai, ply }:
  // ply applies when the exporter town belongs to the faction being computed as
  // player; ai otherwise. Missing regime falls back to the other; unmeasured lanes
  // run at seaCargoK (33).
  seaLaneF: {
    "Campania>Latium": { ply: 32.8, ai: 33.1 },
    "Campania>Roma": { ply: 33.2, ai: 33.5 },
    "Latium>Campania": { ai: 33.3, ply: 16.3 },
    "Roma>Latium_Novum": { ply: 50.3 },
    "Roma>Campania": { ply: 66.1 },
    "Latium_Novum>Roma": { ply: 30.7 },
    "Etruria_Meridionalis>Latium": { ply: 25.3 },
    "Etruria_Septentrionalis>Etruria_Meridionalis": { ply: 3.4 },
    "Parthenope>Latium_Novum": { ply: 14 },
    "Poseidonia>Bruttium": { ply: 20.3 },
    "Bruttium>Poseidonia": { ai: 15.5 },
    "Lokroi_Epizephyrioi>Chonia": { ply: 8.6 },
    "Thourioi>Taras": { ply: 17.8 },
    "Taras>Thourioi": { ai: 37.1 },
    "Metapontion>Chonia": { ply: 40.5 },
    "Chonia>Metapontion": { ai: 56.7 },
    "Etruria_Occidentalis>Roma": { ply: 8.6 },
    "Mamertina>Bruttium": { ply: 33 },
    "Arktonnesos>Pityoussa": { ply: 95 },
    "Arktonnesos>Kardia": { ply: 56 },
    "Pityoussa>Arktonnesos": { ai: 93.8 },
    "Histria>Ager_Gallicus": { ai: 75.5 },
    "Ingaunia>Etruria_Septentrionalis": { ai: 21.7 },
    "Corsica>Etruria_Occidentalis": { ai: 14.9 },
    "Lucania>Parthenope": { ai: 75 },
    "Issa>Daunia": { fix: 195 },
    "Issa>Peucetia": { fix: 260 },
    "Issa>Kanysion": { fix: 110 },
    // CYRENE measured lanes (live scrolls 2026-06-11 morning, cyrene-as-player game;
    // folded into CALIB during the TASK B revalidation 2026-06-12 — the v1097 eff
    // curve had re-based cargo pts, drifting cyrene trade to +15% on default f 33):
    // Kyr→Ars 430, Ars→Kyr 140 (Kyrene's import row 28 = ÷5 ✓), Kyr→Eues 265
    // (one-way; Eues side weak), Eues→Ptol 191, Ptol→Eues 174.
    // REFRESHED to the current mod (2026-06-16) from live cyrene1 reads — the prior
    // values were the old-mod vintage. f = export ÷ cargo; the export law itself
    // (base 1.1·√popSum + slope·cargo) is queued for the cross-faction sea-trade fit.
    "Kyrenaike>Taucheira": { ply: 13.438 },
    "Taucheira>Kyrenaike": { ply: 35.0 },
    "Kyrenaike>Euesperidai": { ply: 10.003 },
    "Euesperidai>Barke": { ply: 10.952 },
    "Barke>Euesperidai": { ply: 13.679 },
  },
  // LIVE-READ lane sets (see seaLanesByRegion seeding): exA/exB = that side
  // exports. Sources: capua t1 trio scroll, julii 26-town t1 corpus, mamertines
  // probe, kyzikos probe (all 2026-06-11/12, descr_strat git-HEAD vintage).
  // impA/impB = that side's IMPORT row (partner flow ÷5) is live at TURN 1 —
  // OBSERVED truth (2026-06-12 julii corpus reconciliation): the old "we are the
  // partner's nearest lane" heuristic (single capua observation) false-suppressed
  // Rome's Capua import 67 and Venusia/Canusium's Issa imports 52/22, all live
  // at julii t1. Default true for seeded lanes; the only observed t1-dark import
  // is Capua's Rome row (capua game: appeared at t2 as 59). Unseeded lanes keep
  // the nearest-lane heuristic.
  // VINTAGE-BOUND like all calibration: re-read after map/strat rebalances.
  seaLaneSeeds: [
    { a: "Campania", b: "Latium", exA: true, exB: true },
    { a: "Campania", b: "Roma", exA: true, exB: true, impA: false },
    { a: "Roma", b: "Latium_Novum", exA: true, exB: true },
    { a: "Roma", b: "Etruria_Occidentalis", exA: false, exB: true },
    { a: "Latium", b: "Etruria_Meridionalis", exA: false, exB: true },
    { a: "Etruria_Meridionalis", b: "Etruria_Septentrionalis", exA: false, exB: true },
    { a: "Etruria_Septentrionalis", b: "Ingaunia", exA: false, exB: true },
    { a: "Etruria_Occidentalis", b: "Corsica", exA: false, exB: true },
    { a: "Parthenope", b: "Latium_Novum", exA: true, exB: false },
    { a: "Parthenope", b: "Lucania", exA: false, exB: true },
    { a: "Poseidonia", b: "Bruttium", exA: true, exB: true },
    { a: "Lokroi_Epizephyrioi", b: "Chonia", exA: true, exB: false },
    { a: "Thourioi", b: "Taras", exA: true, exB: true },
    { a: "Metapontion", b: "Chonia", exA: true, exB: true },
    { a: "Mamertina", b: "Bruttium", exA: true, exB: false },
    { a: "Ager_Gallicus", b: "Histria", exA: false, exB: true },
    { a: "Daunia", b: "Issa", exA: false, exB: true },
    { a: "Peucetia", b: "Issa", exA: false, exB: true },
    { a: "Kanysion", b: "Issa", exA: false, exB: true },
    { a: "Arktonnesos", b: "Pityoussa", exA: true, exB: true },
    { a: "Arktonnesos", b: "Kardia", exA: true, exB: false },
  ],
  // MEASURED per-town trade overrides — PERMANENTLY EMPTIED (2026-06-12 sea-model
  // rebuild): the per-lane law (seaLaneSeeds + seaLaneF + fixed-point saturation
  // pts) reproduces the julii 26-town ledger at −2.0% pure-law (capua −2.0%,
  // kyzikos −1.9%), so the frozen per-town table is gone for good.
  // EGYPT PER-TOWN LIVE TRADE PINS (TASK B revalidation 2026-06-12): the v1093/1097
  // sea rebuild (fixed-point cargo flows, unmeasured lanes at seaCargoK 33) overshoots
  // egypt +33% (Nile-delta river lanes ~2× live; Red-Sea exotic-cargo lanes f≈1 vs 33)
  // while julii/capua/kyzikos stay exact. Until the per-lane f law is cracked, the
  // played-egypt budget pins each town to its live t1 scroll total (jcrops/egypt/
  // all.tsv A-rows, 83/84 towns, Σ 21,303 vs ledger 21,248; Alexandria 2412 is the
  // post-GoodTrader-probe reading, +38 inherent). VINTAGE-BOUND (descr_strat git
  // c60aade0c) — re-read after any rebalance, like the julii landLaneRows.
  tradeMeasuredByPlayer: {
    ptolemaic: {
      "Abila": 14, "Alexandria": 2412, "Amathous": 227, "Arsinoe_Klysma": 79, "Arsinoe_Krokodeilon_Polis": 390, "Askalon": 104, "Aspendos": 23, "Athribis": 103, "Azotos": 279, "Berenike_Deire": 40, "Berenike_Panchrysos": 245, "Berenike_Trogodytike": 158, "Berytos": 234, "Boubastis": 117, "Chalkis_Libanos": 48, "Delos": 343, "Dora": 146, "Erythrai": 126, "Etenna_Kotenna": 7, "Gadara": 94, "Gamala": 82, "Gaza": 1683, "Gerasa": 77, "Halikarnassos": 522, "Hebron": 58, "Herakleia_Phoinike": 7, "Hermou_Polis": 262, "Heroon_Polis": 203, "Ioppe": 692, "Itanos": 196, "Jerusalem": 168, "Kaunos": 548, "Kition": 198, "Knidos": 272, "Korakesion": 161, "Kos": 370, "Limyra": 179, "Lykon_Polis": 28, "Megale_Apollonos_Polis": 75, "Memphis": 391, "Mendes_Thmouis": 481, "Methymna": 100, "Mikra_Apollonos_Polis": 66, "Miletos": 625, "Mylasa": 364, "Myos_Hormos": 381, "Myra": 112, "Mytilene": 544, "Nagidos": 147, "Naukratis": 314, "Naxos": 660, "Oxyrhynchos": 282, "Pachora": 39, "Panos_Polis": 98, "Paphos": 573, "Patara": 241, "Pella_Peraia": 47, "Pelousion": 438, "Phaselis": 142, "Philadelpheia": 85, "Philotera": 102, "Premnis": 39, "Ptolemais_Hermeiou": 199, "Ptolemais_Phoinike": 429, "Ptolemais_Theron": 0, "Rhaithou": 84, "Sais": 57, "Salamis": 571, "Samareia": 130, "Samos": 657, "Samothrake": 0, "Sebennytos_Bousiris": 324, "Soloi": 598, "Syene_Elephantine": 78, "Tachompso_Pselkis": 32, "Tanis": 224, "Telmessos": 163, "Termessos": 17, "Thebes_Megale_Diospolis": 165, "Thera": 236, "Tlos": 32, "Xanthos": 37, "Zeszes": 29,
    },
    // CARTHAGE — COMPLETE 41/41 settlement trade, live turn-1 scrolls 2026-06-17
    // (save 'save_Autosave Carthage Turn 1.sav', taxRate Normal). Value = the
    // Turn-Income Trade line (= the settlement's authoritative trade income that
    // balances its on-scroll Net). Row-sums cross-validate the scroll header on all
    // 41 towns. Feral publishes NO trade-value formula (Battle_and_Campaign_Formulae
    // has no trade section) → live pins are the exactness route. Re-read after a
    // map/strat/goods rebalance (vintage-bound, like landLaneRows). Generated by
    // rtw-sav-parser/gen-trade-pins.js from carth-raw.json.
    carthage: { "Carthage": 2025, "Lilybaion": 641, "Panormos": 220, "Eryx": 218, "Melite": 0, "Caralis": 112, "Olbia_Sardinia": 8, "Neapolis_Sardinia": 175, "Sulci": 111, "Aleria": 3, "Hadrumetum": 319, "Leptis": 67, "Hippo": 84, "Iol": 58, "Tingi": 231, "Utica": 544, "Bulla": 46, "Clupea": 666, "Oea": 9, "Sabrata": 19, "Rusadir": 40, "Saldae": 34, "Ebusus": 122, "Malaca": 123, "Carteia": 125, "Segesta": 95, "Herakleia_Minoa": 23, "Meninx": 39, "Tunes": 155, "Vaga": 76, "Hippo_Diarrhytus": 325, "Gigthis": 17, "Euphranta": 6, "Karchedonike_Neapolis": 53, "Icosium": 58, "Thapsus": 9, "Leptis_Minor": 11, "Rusicade": 28, "Macomades_Minores": 12, "Sexi": 57, "Baria": 13 },
    // JULII — 26 core settlements, live turn-1 scrolls 2026-06-17 (current build).
    // Land rows re-confirmed identical to landLaneRows pins; full per-town totals
    // from each scroll's Trade line. Generated from julii2-raw.json.
    romans_julii: { "Rome": 1408, "Arretium": 87, "Sena_Gallica": 72, "Volaterrae": 104, "Corfinium": 16, "Falerii": 53, "Iguvium": 40, "Cosa": 421, "Teate": 30, "Pisae": 77, "Reate": 86, "Perusia": 31, "Camerinum": 31, "Maleventum": 121, "Larinum": 19, "Arpi": 94, "Venusia": 193, "Croton": 14, "Canusium": 32, "Thurii": 219, "Neapolis": 221, "Fregellae": 378, "Praeneste": 214, "Paestum": 324, "Epizephyrian_Locri": 53, "Metapontum": 159 },
  },
  seaFlowWeak: 0, // WEAK SLOT SIDES EXPORT NOTHING (julii corpus: Cosa's 'Pisae 9' row = the
  // IMPORT of Pisae→Cosa 41 (÷5 exact); every 'weak export' reading was a misread import)
};

// region → {x,y} coords (map_regions.tga black settlement pixels), cached per mod dir.
const _coordCache = {};
function regionCoords(modDataDir) {
  if (_coordCache[modDataDir]) return _coordCache[modDataDir];
  try {
    const dg = require("./descrStratGeneral.js");
    const { rgbToRegion } = dg.parseDescrRegions(fs.readFileSync(path.join(modDataDir, "world", "maps", "base", "descr_regions.txt"), "latin1"));
    const coords = dg.buildRegionCoords(fs.readFileSync(path.join(modDataDir, "world", "maps", "base", "map_regions.tga")), rgbToRegion);
    return (_coordCache[modDataDir] = coords);
  } catch (e) { return (_coordCache[modDataDir] = {}); }
}

// ---- LAND-TRADE FRONTIER GRAPH from map.rwm (the game's region-frontier connectivity, 2026-06-18) ----
// Land-trade partners = the TYPE-0 REGION_FRONTIER edges, read straight from map.rwm
// (type 0 = land border, type 1 = sea/impassable). This is the game's OWN terrain-classified
// adjacency: it correctly excludes Marakanda/Sogdiane (Baktria) and Komana+Kimiata (Pontus),
// which raw pixel-adjacency over-counts (+33..+61% for inland empires). Each frontier carries an
// f10 distance/cost float; the far tail (f10 > cutoff) does not form a land route. Whole-map parse
// is 100% symmetric (5422 land edges, 0 asymmetric) = byte-exact. map.rwm entry/frontier format is
// documented in the trade-network investigation notes.
const _frontierCache = {};
// map.rwm format version byte (cached): 0x78 = vanilla RTW:R, 0x7b = RIS's custom map. Used to gate the
// invalid-bridge detection (vanilla: bord≈1; RIS: the f10>150 cutoff its land calibration was tuned against).
const _mapVerCache = {};
function _mapVer(modDataDir) {
  if (_mapVerCache[modDataDir] != null) return _mapVerCache[modDataDir];
  let v = 0x7b;
  try { const fd = fs.openSync(path.join(modDataDir, "world", "maps", "base", "map.rwm"), "r"); const buf = Buffer.alloc(1); fs.readSync(fd, buf, 0, 1, 0); fs.closeSync(fd); v = buf[0]; } catch { /* no map → assume RIS */ }
  return (_mapVerCache[modDataDir] = v);
}
// RTW's bit-hack fast integer-sqrt — the same √ approximation the engine uses in its trade-value math.
function _fastSqrt(x){ const _b=new ArrayBuffer(4),_f=new Float32Array(_b),_i=new Int32Array(_b); _f[0]=x; _i[0]=(((_i[0]-0x3f800000)|0)>>1)+0x3f800000; return _f[0]; }
function frontierGraph(modDataDir) {
  if (!modDataDir) return {};
  if (_frontierCache[modDataDir]) return _frontierCache[modDataDir];
  const graph = {};
  try {
    const dg = require("./descrStratGeneral.js");
    const base = path.join(modDataDir, "world", "maps", "base");
    const { rgbToRegion } = dg.parseDescrRegions(fs.readFileSync(path.join(base, "descr_regions.txt"), "latin1"));
    const names = [...new Set(Object.values(rgbToRegion))];
    const b = fs.readFileSync(path.join(base, "map.rwm"));
    const byName = {}, byStored = {};
    for (const nm of names) {
      const pat = Buffer.from(nm + "\x00", "latin1");
      let i = b.indexOf(pat, b.length < 12000000 ? 0 : 12000000); // RIS's huge map needs the 12MB skip; vanilla (3.3MB) searches from 0
      while (i >= 0) {
        // entry header: [u16 namelen=len+1][name+NUL][u16 0][u16 settlen][settlement+NUL][u16 cultlen][culture+NUL][u32 flag][u32 storedIndex]
        if (i >= 2 && b.readUInt16LE(i - 2) === nm.length + 1 && b.readUInt16LE(i + nm.length + 1) === 0) {
          const sl = b.readUInt16LE(i + nm.length + 3);
          if (sl > 1 && sl < 48) {
            let p = i + nm.length + 5 + sl;            // after settlement
            const cl = b.readUInt16LE(p); p += 2 + cl;  // after culture
            byName[nm] = { bodyP: p, sidx: b.readUInt32LE(p + (b[0] >= 0x7b ? 4 : 0)) };
            byStored[b.readUInt32LE(p + (b[0] >= 0x7b ? 4 : 0))] = nm; // region index frontiers reference (RIS 0x7b body=[flag][index]; vanilla 0x78=[index] only)
            break;
          }
        }
        i = b.indexOf(pat, i + 1);
      }
    }
    for (const nm in byName) {
      let p = byName[nm].bodyP + (b[0] >= 0x7b ? 8 : 4); // body header to tilesA (RIS 0x7b=8B [flag][index]; vanilla 0x78=4B [index])
      const tA = b.readUInt32LE(p); p += 4 + tA * 4;     // tilesA
      const tB = b.readUInt32LE(p); p += 4 + tB * 4;     // tilesB
      const fc = b.readUInt32LE(p); p += 4;              // frontier count
      const list = [];
      if (fc <= 40) {
        for (let k = 0; k < fc; k++) {
          const r = b.readUInt32LE(p); p += 4;
          const f10 = b.readFloatLE(p); p += 4;
          const ty = b[p]; p += 1 + 4 + 4;               // type byte, then two skipped u32s
          let bord = 0;
          for (let a = 0; a < 5; a++) { const c = b.readUInt32LE(p); if (a === 0) bord = c; p += 4 + c * 4; }  // 5 border-tile arrays; [0] count = shared-border length (pixels)
          const rn = byStored[r];
          // bord = the SHARED-BORDER LENGTH (adjacent pixel count). A STRAIT/land-bridge crossing (island
          // Korkyra↔Phoinike, gulf Ambrakia↔Stratos) has bord≈1; a true land border has bord≈7-13. This
          // distinguishes sea crossings (trade by SEA) from real borders (trade by LAND).
          if (rn) list.push({ region: rn, type: ty, f10: f10, bord });
        }
      }
      graph[nm] = list;
    }
  } catch (e) { /* no map.rwm (or parse fail) → empty graph; land loop falls back to pixel adjacency */ }
  return (_frontierCache[modDataDir] = graph);
}

// ---- SEA-TRADE LANDING-FRONTIER GRAPH from map.rwm (the game's exact sea connectivity, 2026-06-22) ----
// Each region's LANDING_FRONTIERS (the engine's sea-access records, stored in map.rwm right AFTER the
// REGION_FRONTIER array) list the regions reachable by sea + the engine's exact sea DISTANCE. This is the
// candidate set + distance the engine uses for sea trade — each port fills its slots with the highest-PROFIT
// landing-frontier partners (value-ranked, NOT nearest; e.g. Epirus's Kichyros picks rich Korkyra+Stratos
// over the nearer-but-poor Leukas). The old model used a pixel-BFS for sea distance (wrong: Leukas read d8
// vs the engine's d33.9) and a hard 40-distance cap that killed far-but-rich routes (Stratos d53, Uria d108).
// Record layout per landing frontier: u32 region_index, f32 sea_distance, u32 _, u32 _, u32 _, then a
// length-prefixed array of landing tiles (8 bytes each). Returns {region: [{region, dist}]}.
const _landingCache = {};
function landingFrontierGraph(modDataDir) {
  if (!modDataDir) return {};
  if (_landingCache[modDataDir]) return _landingCache[modDataDir];
  const graph = {};
  try {
    const dg = require("./descrStratGeneral.js");
    const base = path.join(modDataDir, "world", "maps", "base");
    const { rgbToRegion } = dg.parseDescrRegions(fs.readFileSync(path.join(base, "descr_regions.txt"), "latin1"));
    const names = [...new Set(Object.values(rgbToRegion))];
    const b = fs.readFileSync(path.join(base, "map.rwm"));
    const byName = {}, byStored = {};
    for (const nm of names) {
      const pat = Buffer.from(nm + "\x00", "latin1");
      let i = b.indexOf(pat, b.length < 12000000 ? 0 : 12000000); // RIS's huge map needs the 12MB skip; vanilla (3.3MB) searches from 0
      while (i >= 0) {
        if (i >= 2 && b.readUInt16LE(i - 2) === nm.length + 1 && b.readUInt16LE(i + nm.length + 1) === 0) {
          const sl = b.readUInt16LE(i + nm.length + 3);
          if (sl > 1 && sl < 48) {
            let p = i + nm.length + 5 + sl;
            const cl = b.readUInt16LE(p); p += 2 + cl;
            byName[nm] = { bodyP: p }; byStored[b.readUInt32LE(p + (b[0] >= 0x7b ? 4 : 0))] = nm;
            break;
          }
        }
        i = b.indexOf(pat, i + 1);
      }
    }
    for (const nm in byName) {
      let p = byName[nm].bodyP + (b[0] >= 0x7b ? 8 : 4);  // body header to tilesA (RIS 0x7b=8B; vanilla 0x78=4B)
      const tA = b.readUInt32LE(p); p += 4 + tA * 4;       // tilesA
      const tB = b.readUInt32LE(p); p += 4 + tB * 4;       // tilesB
      const fc = b.readUInt32LE(p); p += 4;                // region-frontier count — skip them
      for (let k = 0; k < fc; k++) { p += 17; for (let a = 0; a < 5; a++) { const c = b.readUInt32LE(p); p += 4 + c * 4; } }
      const lc = b.readUInt32LE(p); p += 4;                // landing-frontier count
      const list = [];
      if (lc <= 200) {
        for (let k = 0; k < lc; k++) {
          const ridx = b.readUInt32LE(p);                  // sea-connected region index
          const dEuclid = b.readFloatLE(p + 4);            // +4 = straight-line distance
          const dNav = b.readFloatLE(p + 8);               // +8 = NAVIGABLE (pathfinding) sea distance; -1 = unreachable
          p += 20;
          const tc = b.readUInt32LE(p); p += 4 + tc * 8;   // landing-tiles array
          const rn = byStored[ridx];
          // The engine values trade by the NAVIGABLE distance (around peninsulas), not straight-line; a
          // negative dNav means there is no direct sea path (blocked by land) → not a trade candidate.
          if (rn && dNav > 0 && dNav < 5000) list.push({ region: rn, dist: dNav, dEuclid });
        }
      }
      graph[nm] = list;
    }
  } catch (e) { /* no map.rwm → empty; sea loop falls back to the pixel BFS */ }
  return (_landingCache[modDataDir] = graph);
}

const BRACKET_MULT = { low: 0.8, normal: 1.0, high: 1.2, very_high: 1.5 };

// ---- region adjacency from map_regions.tga (for land-trade partners) ----
const _adjCache = {}, _adjLenCache = {};
function regionBorderLen(modDataDir) { regionAdjacency(modDataDir); return _adjLenCache[modDataDir] || {}; }
function regionAdjacency(modDataDir) {
  if (_adjCache[modDataDir]) return _adjCache[modDataDir];
  const adj = {}, blen = {}; _adjLenCache[modDataDir] = blen;
  try {
    const dg = require("./descrStratGeneral.js");
    const { rgbToRegion } = dg.parseDescrRegions(fs.readFileSync(path.join(modDataDir, "world", "maps", "base", "descr_regions.txt"), "latin1"));
    const buf = fs.readFileSync(path.join(modDataDir, "world", "maps", "base", "map_regions.tga"));
    const W = buf.readUInt16LE(12), H = buf.readUInt16LE(14), desc = buf[17];
    const dataOff = 18 + buf[0];
    const bottomLeft = (desc & 0x20) === 0;
    const key = (col, rowTop) => { const r = bottomLeft ? (H - 1 - rowTop) : rowTop; const o = dataOff + (r * W + col) * 3; return buf[o + 2] + "," + buf[o + 1] + "," + buf[o]; };
    const add = (a, b) => { (adj[a] = adj[a] || new Set()).add(b); (adj[b] = adj[b] || new Set()).add(a); const kk = a < b ? a + "|" + b : b + "|" + a; blen[kk] = (blen[kk] || 0) + 1; };
    // 8-NEIGHBORHOOD (2026-06-11, Nile-delta proof): regions touching only
    // DIAGONALLY across a 1px river are land-adjacent in the engine (Alexandria
    // land-trades Naukratis across the Nile; they touch corner-to-corner) — and
    // that adjacency excludes them from sea lanes, freeing the port slots for the
    // real river lanes (Alexandria⇄Sebennytos/Mendes/Tanis, all live-verified).
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = key(x, y); const ra = rgbToRegion[k];
      if (!ra) continue;
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const k2 = key(nx, ny); if (k2 === k) continue;
        const rb = rgbToRegion[k2]; if (rb && rb !== ra) add(ra, rb);
      }
    }
  } catch { /* adjacency unavailable → land partners count 0 */ }
  return (_adjCache[modDataDir] = adj);
}

// ---- region → adjacent SEA BODIES (map_regions.tga: 16 distinct 41,140,X sea colors
// = named sea zones; ports sharing a body are sea-trade partners) ----
const _seaCache = {};
function regionSeaBodies(modDataDir) {
  if (_seaCache[modDataDir]) return _seaCache[modDataDir];
  const out = {};
  try {
    const dg = require("./descrStratGeneral.js");
    const { rgbToRegion } = dg.parseDescrRegions(fs.readFileSync(path.join(modDataDir, "world", "maps", "base", "descr_regions.txt"), "latin1"));
    const buf = fs.readFileSync(path.join(modDataDir, "world", "maps", "base", "map_regions.tga"));
    const W = buf.readUInt16LE(12), H = buf.readUInt16LE(14), desc = buf[17];
    const dataOff = 18 + buf[0];
    const bottomLeft = (desc & 0x20) === 0;
    const colorAt = (col, rowTop) => { const r = bottomLeft ? (H - 1 - rowTop) : rowTop; const o = dataOff + (r * W + col) * 3; return buf[o + 2] + "," + buf[o + 1] + "," + buf[o]; };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const reg = rgbToRegion[colorAt(x, y)];
      if (!reg) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const k2 = colorAt(nx, ny);
        if (k2.startsWith("41,140,")) (out[reg] = out[reg] || {})[k2] = 1;
      }
    }
    for (const r of Object.keys(out)) out[r] = Object.keys(out[r]);
  } catch { /* no sea data → sea partners 0 */ }
  return (_seaCache[modDataDir] = out);
}

// ---- MINEABLE quantity-value per region (resource_quantity override) ----
// `resource gold, 2, x, y` = quantity 2 at tile x,y; region resolved via map_regions
// pixels. mineQtyVal = Σ quantity × tradeValue over MINEABLE resources — the exact
// multiplier in the cracked mining formula.
const _mineQtyCache = {};
function mineQtyValByRegion(modDataDir) {
  if (_mineQtyCache[modDataDir]) return _mineQtyCache[modDataDir];
  const out = {};
  try {
    const dg = require("./descrStratGeneral.js");
    const { rgbToRegion } = dg.parseDescrRegions(fs.readFileSync(path.join(modDataDir, "world", "maps", "base", "descr_regions.txt"), "latin1"));
    const buf = fs.readFileSync(path.join(modDataDir, "world", "maps", "base", "map_regions.tga"));
    const W = buf.readUInt16LE(12), H = buf.readUInt16LE(14), desc = buf[17];
    const dataOff = 18 + buf[0];
    const bottomLeft = (desc & 0x20) === 0;
    const regionAt = (x, yGame) => {
      const rowTop = H - 1 - yGame;
      const r = bottomLeft ? (H - 1 - rowTop) : rowTop;
      let reg = rgbToRegion[buf[dataOff + (r * W + x) * 3 + 2] + "," + buf[dataOff + (r * W + x) * 3 + 1] + "," + buf[dataOff + (r * W + x) * 3]];
      if (reg) return reg;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const o = dataOff + ((r + dy) * W + (x + dx)) * 3;
        reg = rgbToRegion[buf[o + 2] + "," + buf[o + 1] + "," + buf[o]];
        if (reg) return reg;
      }
      return null;
    };
    const resVal = parseResourceValues(modDataDir);
    const ovr = path.join(modDataDir, "original_overrides", "resource_quantity", "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
    const src = fs.existsSync(ovr) ? ovr : path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
    for (const raw of fs.readFileSync(src, "latin1").split(/\r?\n/)) {
      const t = raw.includes(";") ? raw.slice(0, raw.indexOf(";")) : raw;
      const m = t.match(/^resource\s+(\w+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (!m) continue;
      const e = resVal[m[1].toLowerCase()];
      if (!e || !e.mineable || !e.tradeValue) continue;
      const reg = regionAt(+m[3], +m[4]);
      if (reg) out[reg] = (out[reg] || 0) + (+m[2]) * e.tradeValue;
    }
  } catch { /* no quantities → mining falls back to 0-value regions */ }
  return (_mineQtyCache[modDataDir] = out);
}

// ---- WONDERS (descr_strat `landmark` lines, tile→region via map_regions pixels) ----
// CRACKED 2026-06-10: the Hanging Gardens give their owner +20% FARMING income
// FACTIONWIDE — seleucid (owner) sat at exactly ratio 1.202 while all ten other
// player factions fit 1.000-1.002; ×1.2 lands seleucid at 1.002 (wonder-check.js).
// Other wonders show no measurable farming/trade effect in the corpus (ptolemaic owns
// pyramids+pharos+mausoleum and fits 1.000) — only gardens is modeled.
const _wonderCache = {};
function wonderOwners(modDataDir) {
  if (_wonderCache[modDataDir]) return _wonderCache[modDataDir];
  const out = {};
  try {
    const dg = require("./descrStratGeneral.js");
    const { rgbToRegion } = dg.parseDescrRegions(fs.readFileSync(path.join(modDataDir, "world", "maps", "base", "descr_regions.txt"), "latin1"));
    const buf = fs.readFileSync(path.join(modDataDir, "world", "maps", "base", "map_regions.tga"));
    const W = buf.readUInt16LE(12), H = buf.readUInt16LE(14), desc = buf[17];
    const dataOff = 18 + buf[0];
    const bottomLeft = (desc & 0x20) === 0;
    const regionAt = (x, yGame) => {
      const rowTop = H - 1 - yGame;
      const r = bottomLeft ? (H - 1 - rowTop) : rowTop;
      let reg = rgbToRegion[buf[dataOff + (r * W + x) * 3 + 2] + "," + buf[dataOff + (r * W + x) * 3 + 1] + "," + buf[dataOff + (r * W + x) * 3]];
      if (reg) return reg;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const o = dataOff + ((r + dy) * W + (x + dx)) * 3;
        reg = rgbToRegion[buf[o + 2] + "," + buf[o + 1] + "," + buf[o]];
        if (reg) return reg;
      }
      return null;
    };
    const stratPath = path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
    const strat = gv.parseStrat(stratPath);
    const ownerOfRegion = {};
    for (const [fac, f] of Object.entries(strat)) for (const sd of f.settlements) ownerOfRegion[sd.region] = fac;
    for (const raw of _stratLines(stratPath)) {
      const m = raw.match(/^landmark\s+(\w+)\s+(\d+)\s*,\s*(\d+)/);
      if (!m) continue;
      const reg = regionAt(+m[2], +m[3]);
      out[m[1].toLowerCase()] = { region: reg, owner: reg ? (ownerOfRegion[reg] || null) : null };
    }
  } catch { /* no wonders */ }
  return (_wonderCache[modDataDir] = out);
}

// Cross-faction tradePct (×10, same units as colonyMByRegion) for EVERY region. An import from a FOREIGN
// partner rides that partner's own market/trade-building bonus (its export leg was boosted by it), but each
// budget's colonyMByRegion only covers its own faction's regions — so a foreign import (e.g. Seleucid Antioch
// importing Rhodes' goods) silently dropped Rhodes' market bonus. Built once per mod dir (cached).
const _tradePctAllCache = {};
function tradePctByRegionAll(modDataDir) {
  if (_tradePctAllCache[modDataDir]) return _tradePctAllCache[modDataDir];
  const out = {};
  try {
    const ctx = tradePartnerCtx(modDataDir);
    for (const f of new Set(Object.values(ctx.ownerOfRegion))) {
      try { const F = computeIncomeFeatures(modDataDir, f); for (const s of (F.settlements || [])) out[s.region] = (s.tradePct || 0) * 10; } catch { /* skip faction */ }
    }
  } catch { /* no ctx */ }
  return (_tradePctAllCache[modDataDir] = out);
}

// ---- region ownership + starting allies (trade agreements) + all port towns ----
const _tradeCtxCache = {};
function tradePartnerCtx(modDataDir) {
  if (_tradeCtxCache[modDataDir]) return _tradeCtxCache[modDataDir];
  const ownerOfRegion = {}, allies = {}, wars = {}, portTowns = [], popOfRegion = {}, roadOfRegion = {};
  try {
    const stratPath = path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
    const strat = gv.parseStrat(stratPath);
    for (const [fac, f] of Object.entries(strat)) for (const sd of f.settlements) {
      ownerOfRegion[sd.region] = fac;
      popOfRegion[sd.region] = sd.pop || 400;
      // road LEVEL (model units: none 0, roads 1, paved_roads 2, highways 3) — needed
      // for the trade road multiplier (the importer's road level CAPS the exporter's bonus).
      { const _rb = (sd.buildings || []).find(b => /hinterland_roads/.test(b.chain));
        roadOfRegion[sd.region] = _rb ? ({ roads: 1, paved_roads: 2, highways: 3 }[_rb.level] || 1) : 0; }
      if (sd.buildings && sd.buildings.some(b => /port/i.test(b.chain))) portTowns.push({ region: sd.region, fac });
    }
    // RELATIONSHIP CODES (descr_strat): 199 = alliance, 201 = at war. Both are listed
    // one-directionally with EITHER faction first (RIS lists client-first: "samnites,
    // 199 romans_julii") — register BOTH directions or julii's ally set comes out
    // empty (live-caught 2026-06-11: all client neighbours missing from trade).
    const add = (map, a, b) => {
      (map[a] = map[a] || new Set()).add(b);
      (map[b] = map[b] || new Set()).add(a);
    };
    for (const raw of fs.readFileSync(stratPath, "latin1").split(/\r?\n/)) {
      const t = raw.includes(";") ? raw.slice(0, raw.indexOf(";")) : raw;
      const m = t.match(/^faction_relationships\s+(\w+)\s*,\s*(\d+)\s+(\w+)/);
      if (!m) continue;
      if (+m[2] <= 199) add(allies, m[1].toLowerCase(), m[3].toLowerCase());
      else if (+m[2] === 201) add(wars, m[1].toLowerCase(), m[3].toLowerCase());
    }
  } catch { /* none */ }
  return (_tradeCtxCache[modDataDir] = { ownerOfRegion, allies, wars, portTowns, popOfRegion, roadOfRegion });
}

// Quantity-weighted TRADE resource value per region: Σ qty × tradeValue over all
// non-hidden resources (descr_strat resource lines carry an explicit quantity column
// — "resource dyes, 2, x, y" — which the old per-settlement Set-based rv ignored;
// live scroll session 2026-06-11). Same coord→region attribution as the mine parser.
const _tradeQtyCache = {};
function tradeQtyValByRegion(modDataDir) {
  if (_tradeQtyCache[modDataDir]) return _tradeQtyCache[modDataDir];
  const out = {};
  try {
    const dg = require("./descrStratGeneral.js");
    const { rgbToRegion } = dg.parseDescrRegions(fs.readFileSync(path.join(modDataDir, "world", "maps", "base", "descr_regions.txt"), "latin1"));
    const buf = fs.readFileSync(path.join(modDataDir, "world", "maps", "base", "map_regions.tga"));
    const W = buf.readUInt16LE(12), H = buf.readUInt16LE(14), desc = buf[17];
    const dataOff = 18 + buf[0];
    const bottomLeft = (desc & 0x20) === 0;
    const regionAt = (x, yGame) => {
      const rowTop = H - 1 - yGame;
      const r = bottomLeft ? (H - 1 - rowTop) : rowTop;
      let reg = rgbToRegion[buf[dataOff + (r * W + x) * 3 + 2] + "," + buf[dataOff + (r * W + x) * 3 + 1] + "," + buf[dataOff + (r * W + x) * 3]];
      if (reg) return reg;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const o = dataOff + ((r + dy) * W + (x + dx)) * 3;
        reg = rgbToRegion[buf[o + 2] + "," + buf[o + 1] + "," + buf[o]];
        if (reg) return reg;
      }
      return null;
    };
    const resVal = parseResourceValues(modDataDir);
    const ovr = path.join(modDataDir, "original_overrides", "resource_quantity", "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
    const src = fs.existsSync(ovr) ? ovr : path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
    for (const raw of fs.readFileSync(src, "latin1").split(/\r?\n/)) {
      const t = raw.includes(";") ? raw.slice(0, raw.indexOf(";")) : raw;
      const m = t.match(/^resource\s+(\w+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (!m) continue;
      const e = resVal[m[1].toLowerCase()];
      if (!e || e.hidden || !e.tradeValue) continue;
      const reg = regionAt(+m[3], +m[4]);
      if (reg) out[reg] = (out[reg] || 0) + (+m[2]) * e.tradeValue;
    }
  } catch { /* none */ }
  return (_tradeQtyCache[modDataDir] = out);
}

// Per-region per-resource QUANTITY maps + per-resource value map — the cargo basis
// for the sea-lane shortfall law (Mamertines probe crack 2026-06-12):
//   cargo(X→Y) per resource r:  qtyY == 0            → eff(qtyX)
//                               qtyY == 1, shortfall ≥ 2 → eff(qtyX − qtyY)
//                               otherwise              → 0  (importer covered)
//   × value_r  (descr_sm trade value, ZERO floored to 1 — Capua probe 2026-06-11
//   night: the whole Praeneste→Capua flow = its stone 3 × 33 = 99 → /5 = the live
//   20 import row; salt/timber re-valued via CALIB.seaResValueOverride, grid-fit
//   2026-06-12: strong-row median |f−33| collapsed 30% → 1.2%).
// eff(q) = min(q,4) + 0.32·max(0,q−4): kink-at-4 fits BOTH the horses 3→9 probe
// (+85 = 33×2.6) and the exact Capua→Rome wine(4,0) → 4 (kink-at-3 would give 3.43
// and break the exact 332/335 trio rows). Slaves never ship as cargo.
// DEEP-WATER ROUTE PENALTY FALSIFIED (deep-sea-fit.js 2026-06-12 + Messana live:
// the forced-deep Messana→Consentia lane flows at full f=1.0).
const _tradeQtyMapsCache = {};
function tradeQtyMapsByRegion(modDataDir) {
  if (_tradeQtyMapsCache[modDataDir]) return _tradeQtyMapsCache[modDataDir];
  const out = { qty: {}, values: {}, rawValues: {} };
  try {
    const dg = require("./descrStratGeneral.js");
    const { rgbToRegion } = dg.parseDescrRegions(fs.readFileSync(path.join(modDataDir, "world", "maps", "base", "descr_regions.txt"), "latin1"));
    const buf = fs.readFileSync(path.join(modDataDir, "world", "maps", "base", "map_regions.tga"));
    const W = buf.readUInt16LE(12), H = buf.readUInt16LE(14), desc = buf[17];
    const dataOff = 18 + buf[0];
    const bottomLeft = (desc & 0x20) === 0;
    const regionAt = (x, yGame) => {
      const rowTop = H - 1 - yGame;
      const r = bottomLeft ? (H - 1 - rowTop) : rowTop;
      let reg = rgbToRegion[buf[dataOff + (r * W + x) * 3 + 2] + "," + buf[dataOff + (r * W + x) * 3 + 1] + "," + buf[dataOff + (r * W + x) * 3]];
      if (reg) return reg;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const o = dataOff + ((r + dy) * W + (x + dx)) * 3;
        reg = rgbToRegion[buf[o + 2] + "," + buf[o + 1] + "," + buf[o]];
        if (reg) return reg;
      }
      return null;
    };
    const resVal = parseResourceValues(modDataDir);
    const src = path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
    let _qtyDisabled = false;
    for (const raw of fs.readFileSync(src, "latin1").split(/\r?\n/)) {
      const t = raw.includes(";") ? raw.slice(0, raw.indexOf(";")) : raw;
      // VANILLA lists every resource TWICE — once under `resource_quantity_enabled`, once under
      // `resource_quantity_disabled` (same tile). The engine counts the ENABLED set only, so skip everything
      // after the disabled marker. RIS has no such split (each resource once) → this is a no-op there.
      if (/resource_quantity_disabled/.test(t)) { _qtyDisabled = true; continue; }
      if (_qtyDisabled) continue;
      const m = t.match(/^\s*resource\s+(\w+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (!m) continue;
      const name = m[1].toLowerCase();
      const e = resVal[name];
      if (!e || e.hidden || name === "slaves") continue;
      const reg = regionAt(+m[3], +m[4]);
      if (!reg) continue;
      (out.qty[reg] = out.qty[reg] || {})[name] = ((out.qty[reg] || {})[name] || 0) + (+m[2]);
      if (out.values[name] == null) out.values[name] = Math.max(1, e.tradeValue || 0);
      if (out.rawValues[name] == null) out.rawValues[name] = e.tradeValue || 0;
    }
  } catch { /* none */ }
  return (_tradeQtyMapsCache[modDataDir] = out);
}

// Legacy aggregate view { region: { resource: eff3(qty)×value } } — kept for the
// external probe scripts that consume it; the sea law now uses tradeQtyMapsByRegion.
const _tradeGoodsCache = {};
function tradeGoodsByRegion(modDataDir) {
  if (_tradeGoodsCache[modDataDir]) return _tradeGoodsCache[modDataDir];
  const { qty, values } = tradeQtyMapsByRegion(modDataDir);
  const eff = (q) => Math.min(q, 3) + 0.43 * Math.max(0, q - 3);
  const out = {};
  for (const reg of Object.keys(qty)) {
    out[reg] = {};
    for (const name of Object.keys(qty[reg])) out[reg][name] = eff(qty[reg][name]) * values[name];
  }
  return (_tradeGoodsCache[modDataDir] = out);
}

// SEA LANES — GLOBAL CAPACITY MATCHING (cracked 2026-06-11, task #15): every port has
// (1+portLevel) lane slots; eligible counterpart ports = own/ally/trade-rights factions,
// NOT land-adjacent (adjacency exclusion reproduces all observed lane sets). Pairs match
// greedily by ascending port distance (coastal-centroid approximation); a lane is WEAK
// when either side burns its LAST slot, else strong. Leg values (icon-verified exclusion
// cargo): strong = 20·e^(0.127·pct)·cargoOut + 7.2·cargoIn; weak = 2.4·e^(0.127·pct)·cargoOut.
const _seaLaneCache = {};
function seaLanesByRegion(modDataDir) {
  if (_seaLaneCache[modDataDir]) return _seaLaneCache[modDataDir];
  const out = {};
  try {
    const { ownerOfRegion, allies, wars, popOfRegion } = tradePartnerCtx(modDataDir);
    const adjacency = regionAdjacency(modDataDir);
    const dg = require("./descrStratGeneral.js");
    const { rgbToRegion } = dg.parseDescrRegions(fs.readFileSync(path.join(modDataDir, "world", "maps", "base", "descr_regions.txt"), "latin1"));
    const buf = fs.readFileSync(path.join(modDataDir, "world", "maps", "base", "map_regions.tga"));
    const W = buf.readUInt16LE(12), H = buf.readUInt16LE(14), dataOff = 18 + buf[0];
    const isSea = (o) => buf[dataOff + o * 3 + 2] === 41 && buf[dataOff + o * 3 + 1] === 140;
    // PORT TILE per region = the coastal pixel nearest the CITY tile (the engine
    // anchors the port structure there; near-tie lane ordering depends on it —
    // Cosa→Praeneste vs →Pisae differ by ~0.1 tile and flip the strength assignment).
    const cityPx = {};
    {
      const sites = dg.buildRegionCoords(buf, rgbToRegion); // city black pixels (top-row space y-flipped)
      for (const r of Object.keys(sites)) cityPx[r] = [sites[r].x, H - 1 - sites[r].y];
    }
    const cent = {}, bestD = {};
    for (let y = 0; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const o = y * W + x;
      if (isSea(o)) continue;
      const reg = rgbToRegion[buf[dataOff + o * 3 + 2] + "," + buf[dataOff + o * 3 + 1] + "," + buf[dataOff + o * 3]];
      if (!reg || !cityPx[reg]) continue;
      if (isSea(o + 1) || isSea(o - 1) || isSea(o + W) || isSea(o - W)) {
        const d = Math.hypot(x - cityPx[reg][0], y - cityPx[reg][1]);
        if (bestD[reg] == null || d < bestD[reg]) { bestD[reg] = d; cent[reg] = [x, y]; }
      }
    }
    // port list with levels from descr_strat building level names ordered by EDB
    const inc = parseEDBIncome(path.join(modDataDir, "export_descr_buildings.txt"));
    const portOrder = inc.chainLevels["port_buildings"] || [];
    const strat = gv.parseStrat(path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"));
    const ports = [];
    // region base_port_level (descr_regions hidden resource) — the FLOW-VALUE law was
    // fit on this port definition; the slot count keeps using the built port chain.
    const basePort = {};
    {
      // descr_regions: region name at column 0, then indented attribute lines (one holds
      // base_port_level_N). Parse per-region — a lazy cross-newline regex mis-assigned levels
      // to the wrong region (Carthage base_port_level_3 read as 0), corrupting sea-lane slots.
      const rtxt = fs.readFileSync(path.join(modDataDir, "world", "maps", "base", "descr_regions.txt"), "latin1");
      let curReg = null;
      for (const line of rtxt.split(/\r?\n/)) {
        if (/^\S/.test(line)) curReg = line.trim();
        else if (curReg) { const m = line.match(/base_port_level_(\d)/); if (m) basePort[curReg] = +m[1]; }
      }
    }
    for (const [fac, f] of Object.entries(strat)) for (const sd of f.settlements) {
      const pb = (sd.buildings || []).find(b => /^port_buildings$/i.test(b.chain));
      if (!pb || !cent[sd.region]) continue;
      const idx = portOrder.indexOf(pb.level);
      // SLOTS = 1 + the REGION'S base_port_level (2026-06-11 Nile-delta proof:
      // Sebennytos/Tanis built port level 0 yet hold 3 live lanes; Rome base 2 → 3 ✓).
      // The built chain level does NOT set lane capacity.
      ports.push({ region: sd.region, fac, level: (idx >= 0 ? idx : 0) + 1, pop: sd.pop || 1500, basePort: basePort[sd.region] || 0 });
    }
    // ★ VANILLA (map 0x78) SEA-TRADE PARTNER SELECTION — EXE-CRACKED 2026-06-24 (MAP_REGIONS::
    // calculate_sea_trade_income FUN_1414a57f0 + routeValue FUN_1414a3e70): GREEDY top-N by per-route VALUE.
    // Each port fills slots=min(3,1+base_port) with the HIGHEST-VALUE sea-reachable partners. Value =
    // (seaPopCoefV·fastSqrt(popX+popY) + cargoFull)·gate / dNav, gate = own×1 / foreign×0.5 / war×0. Pool =
    // ANY sea-reachable settlement (region+0x158≠0, positive dNav) that is NOT a land-frontier neighbour — NO
    // port-building requirement (own portless coastal regions like Lilybaeum qualify). Distance + candidate set
    // come from the map.rwm LANDING_FRONTIERS (dNav), NOT the pixel BFS. When self picks P, P always gets a
    // 0.2×value IMPORT row (the /5 tariff); a full 2-row mutual link forms only when P ranks self back.
    // RIS (0x7b) keeps its own graph below.
    if (_mapVer(modDataDir) < 0x7b) {
      const lfg = landingFrontierGraph(modDataDir);
      const portTownSet = new Set(ports.map(p => p.region));
      const { qty: _GQ, rawValues: _RV } = tradeQtyMapsByRegion(modDataDir);
      const _cargoV = (X, Y) => { const ga = _GQ[X] || {}, gb = _GQ[Y] || {}; let c = 0; for (const r in ga) if (!(r in gb)) c += ga[r] * (_RV[r] || 0); return c; };
      const _fsq = (x) => { const b = new ArrayBuffer(4), f = new Float32Array(b), i = new Int32Array(b); f[0] = x; i[0] = (((i[0] + 0xc0800000) | 0) >> 1) + 0x3f800000; return f[0]; };
      const _dNav = (X, Y) => { const e = (lfg[X] || []).find(z => z.region === Y); return e ? e.dist : null; };
      // PASS 1 — each port greedily picks its export partners by route value.
      // POOL (map.rwm candidate builder FUN_14149e4f0, empirically port-town + own + ally — portless non-ally
      // islands like Caralis are NOT in it; own portless coastal like Lilybaeum IS, via the own-faction branch).
      const exportPick = {}; // region -> [{to, d}]
      for (const p of ports) {
        const F = p.fac, A = p.region;
        const adjA = adjacency[A];
        const isLandNbr = (r) => adjA && (adjA.has ? adjA.has(r) : adjA.includes(r));
        const allyFacs = new Set(allies[F] || []);
        if (/^romans?_/.test(F)) for (const rf of ["romans_senate", "romans_julii", "romans_brutii", "romans_scipii"]) if (rf !== F) allyFacs.add(rf);
        const cands = [];
        for (const fr of (lfg[A] || [])) {
          const r = fr.region, d = fr.dist;
          if (r === A || !(d > 0) || isLandNbr(r)) continue;
          const o = ownerOfRegion[r];
          if (!o || o === "slave") continue;
          const trueOwn = (o === F);
          const own = trueOwn || (/^romans?_/.test(F) && /^romans?_/.test(o)); // SPQR (julii/brutii/scipii/senate) = one Roman state
          if (!(portTownSet.has(r) || own || allyFacs.has(o))) continue; // pool: port town, own, or ally
          const _agr = allyFacs.has(o);
          const gate = (!own && wars[F] && wars[F].has(o)) ? 0 : (trueOwn ? CALIB.seaGateTrueOwnV : own ? CALIB.seaGateOwnV : _agr ? CALIB.seaGateAgreeV : CALIB.seaGateForeignV);
          if (gate === 0) continue;
          const pin = (popOfRegion[A] || 1500) + (portTownSet.has(r) ? (popOfRegion[r] || 1500) : 0);
          const val = (CALIB.seaPopCoefV * _fsq(pin) + _cargoV(A, r)) * gate / d;
          cands.push({ r, d, val });
        }
        cands.sort((a, b) => b.val - a.val);
        // slots = min(3, 1+base_port) — the engine caps trade fleets at 3 ("+1 trade fleet" per port level,
        // hard cap 3, byte-confirmed FUN_1414a57f0). Without the cap, big ports over-pick low-value far hubs
        // (e.g. Alexandria/Sidon/Sinope phantom-exporting to Rhodes), inflating those hubs' import income.
        exportPick[A] = cands.slice(0, Math.min(3, 1 + (p.basePort || 0))).map(c => ({ to: c.r, d: c.d, val: c.val }));
      }
      // PASS 2 — assemble per-region lanes: own export rows (impLive when the partner ranks me back) + 0.2×
      // import-only rows for every inbound export I did not pick back.
      const inbound = {}; // P -> [{from, val}] exporters targeting P (by route value)
      for (const A in exportPick) for (const c of exportPick[A]) (inbound[c.to] = inbound[c.to] || []).push({ from: A, val: c.val });
      const ranksBack = (P, A) => (exportPick[P] || []).some(c => c.to === A);
      const portByRegion = {}; for (const p of ports) portByRegion[p.region] = p;
      const out2 = {};
      // process every region that EXPORTS or that RECEIVES an inbound export (portless importers like Lilybaeum
      // are not in `ports`, but still show a 0.2× import row from their suzerain port).
      for (const A of new Set([...Object.keys(exportPick), ...Object.keys(inbound)])) {
        const p = portByRegion[A];
        const picks = exportPick[A] || [], pickedSet = new Set(picks.map(c => c.to));
        const ownPop = p ? p.pop : (popOfRegion[A] || 1500), ownPort = p ? 1 : 0;
        const lanes = picks.map(c => ({
          to: c.to, d: c.d, weak: false, inWeak: false, impLive: ranksBack(c.to, A),
          toPop: popOfRegion[c.to] || 1500, toPort: portTownSet.has(c.to) ? 1 : 0,
          ownPop, ownPort, invalidBridge: false, toNearest: true,
        }));
        // IMPORT slot cap: a settlement RECEIVES imports only from its top-N inbound exporters by value
        // (N = min(3, 1+port), same fleet cap as exports). Live-confirmed: Rhodes imports from Antioch(153)
        // + Thessalonica(82) but NOT the lower Sinope(51)/Alexandria/Sidon despite those exporting to it.
        const _impN = p ? Math.min(3, 2 + (p.basePort || 0)) : 1;
        const _inb = (inbound[A] || []).slice().sort((x, y) => y.val - x.val).slice(0, _impN);
        for (const { from: B } of _inb) {
          if (pickedSet.has(B)) continue; // mutual handled above
          lanes.push({
            to: B, d: _dNav(B, A) || _dNav(A, B) || 20, weak: true, inWeak: false, impLive: true,
            toPop: popOfRegion[B] || 1500, toPort: portTownSet.has(B) ? 1 : 0,
            ownPop, ownPort, invalidBridge: false, toNearest: true,
          });
        }
        out2[A] = lanes;
      }
      return (_seaLaneCache[modDataDir] = out2);
    }
    // sea-body membership per region + body pixel sizes (full-res) for river detection
    const bodiesOf = {}, bodySize = {};
    for (let y = 0; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const o = y * W + x;
      if (!isSea(o)) continue;
      const bid = buf[dataOff + o * 3];
      bodySize[bid] = (bodySize[bid] || 0) + 1;
      for (const no of [o + 1, o - 1, o + W, o - W]) {
        if (isSea(no)) continue;
        const reg = rgbToRegion[buf[dataOff + no * 3 + 2] + "," + buf[dataOff + no * 3 + 1] + "," + buf[dataOff + no * 3]];
        if (reg) { const l = (bodiesOf[reg] = bodiesOf[reg] || []); if (!l.includes(bid)) l.push(bid); }
      }
    }
    // SEA-PATH distances between port tiles (coarse 4px BFS over sea pixels) —
    // euclidean pairs ports across the peninsula (Neapolis↔Arpi bug); ships sail.
    // PER SEA BODY (2026-06-11, Nile crack): map_regions' 16 sea colors are separate
    // BODIES (Nile delta water 41,140,235 vs Mediterranean 41,140,236). Lanes form
    // WITHIN one body — the BFS only connects same-body cells. This both forms the
    // Nile river-lane network and severs cross-body strait phantoms (Locri⇄Messana).
    const ST = 4, GW = Math.ceil(W / ST), GH = Math.ceil(H / ST);
    const seaGrid = new Uint8Array(GW * GH); // 0 = land, else body id (B value + 1)
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      const x = Math.min(W - 1, gx * ST), y = Math.min(H - 1, gy * ST);
      const o = (y * W + x) * 3;
      if (buf[dataOff + o + 2] === 41 && buf[dataOff + o + 1] === 140) seaGrid[gy * GW + gx] = 1 + buf[dataOff + o];
    }
    const portCell = {};
    for (const p of ports) {
      const c = cent[p.region]; if (!c) continue;
      let best = null, bd = 1e9;
      const gx0 = Math.round(c[0] / ST), gy0 = Math.round(c[1] / ST);
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const gx = gx0 + dx, gy = gy0 + dy;
        if (gx < 0 || gy < 0 || gx >= GW || gy >= GH || !seaGrid[gy * GW + gx]) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = gy * GW + gx; }
      }
      if (best != null) portCell[p.region] = best;
    }
    const seaDist = {}; // region -> Map(otherRegion -> pathDist)
    const cellPorts = {};
    for (const p of ports) if (portCell[p.region] != null) (cellPorts[portCell[p.region]] = cellPorts[portCell[p.region]] || []).push(p.region);
    for (const p of ports) {
      const start = portCell[p.region]; if (start == null || seaDist[p.region]) continue;
      const dist = new Int32Array(GW * GH).fill(-1);
      dist[start] = 0;
      let frontier = [start];
      const found = new Map();
      while (frontier.length) {
        const next = [];
        for (const c of frontier) {
          if (cellPorts[c]) for (const r of cellPorts[c]) if (r !== p.region) found.set(r, dist[c] * ST);
          const cx = c % GW, cy = (c / GW) | 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
            const nc = ny * GW + nx;
            if (!seaGrid[nc] || dist[nc] >= 0) continue;
            dist[nc] = dist[c] + 1;
            next.push(nc);
          }
        }
        frontier = next;
      }
      seaDist[p.region] = found;
    }
    // ENGINE SEA GRAPH (2026-06-22): replace the pixel-BFS distances with the LANDING-FRONTIER graph
    // from map.rwm — the engine's exact sea candidates + distances. Each port then fills its slots with
    // the highest-PROFIT landing-frontier partners (value-ranked), matching the game (Epirus: Kichyros
    // picks rich Korkyra+Stratos over the nearer-but-poor Leukas). Falls back to the BFS if no graph.
    const _useLF = CALIB.useLandingFrontiers && !process.env.NO_LANDING_FRONTIERS;
    if (_useLF) {
      const lf = landingFrontierGraph(modDataDir);
      if (Object.keys(lf).length) {
        const portSet = new Set(ports.map(p => p.region));
        for (const p of ports) {
          const m = new Map();
          for (const e of (lf[p.region] || [])) if (portSet.has(e.region)) m.set(e.region, e.dist);
          seaDist[p.region] = m;
        }
      }
    }
    const _seaInvalid = new Set();
    if (_useLF) { const _van = _mapVer(modDataDir) < 0x7b; const _fg = frontierGraph(modDataDir); for (const rg in _fg) for (const e of _fg[rg]) if (e.type === 0 && (_van ? e.bord <= 2 : e.f10 > CALIB.seaInvalidF10)) _seaInvalid.add(rg + "|" + e.region); }
    // eligible pairs (sea-path ordered)
    const pairs = [];
    for (let i = 0; i < ports.length; i++) for (let j = i + 1; j < ports.length; j++) {
      const a = ports[i], b = ports[j];
      // eligibility = NOT AT WAR (like land trade — Sena Gallica lanes with neutral
      // Histria's Nesactium across the Adriatic rather than own far-away Pisae)
      if (a.fac !== b.fac && wars[a.fac] && wars[a.fac].has(b.fac)) continue;
      if (a.fac === "slave" || b.fac === "slave") continue;
      // Land-adjacency exclusion RE-CONFIRMED live (2026-06-11 cyrene scrolls): the
      // coastal chain Euesperidai–Taucheira–Barke–Kyrenaike lanes exactly as the rule
      // predicts (Kyrene⇄Arsinoe and Euesperides⇄Ptolemais both SKIP their adjacent
      // neighbor; no adjacent pair lanes).
      const adjA = adjacency[a.region];
      const _inval = _seaInvalid.has(a.region + "|" + b.region) || _seaInvalid.has(b.region + "|" + a.region);
      if (!_inval && adjA && (adjA.has ? adjA.has(b.region) : adjA.includes(b.region))) continue;
      const sd = seaDist[a.region] && seaDist[a.region].get(b.region);
      if (sd == null) continue; // no sea path
      // With the landing-frontier graph the engine has NO hard distance cap (it profit-ranks every
      // sea-reachable port and the slot limit caps the count); the old 40-tile cap was a BFS-era kludge
      // that wrongly killed far-but-rich routes (Epirus→Stratos d53, →Uria d108). Use a generous bound.
      if (sd > (_useLF ? CALIB.seaLaneMaxDistLF : CALIB.seaLaneMaxDist)) continue;
      // RIVER LANES (2026-06-11 Nile crack): the Nile is its own small sea body
      // (41,140,235); river ports lane near-all-pairs without consuming sea slots
      // (Sebennytos holds 3 lanes on a level-0 port). Pairs sharing a SMALL body
      // (< riverBodyMaxCells at 4px) lane unconditionally.
      const shared = (bodiesOf[a.region] || []).filter(x => (bodiesOf[b.region] || []).includes(x));
      const river = shared.some(bid => (bodySize[bid] || 1e9) < CALIB.riverBodyMaxCells);
      pairs.push({ a, b, d: sd, river, inval: _inval });
    }
    pairs.sort((x, y) => x.d - y.d);
    // SEEDED LIVE LANES (probe corpora 2026-06-11/12: capua t1 trio, julii 26-town
    // t1, mamertines, kyzikos): the greedy matcher's distance metric misses the
    // engine's (movement-cost pathing, port-side choice, ally-tier preference —
    // directed-slot model, see memory). Where a campaign's lane set was READ LIVE
    // it is pinned here; seeded ports take ONLY their seeded lanes, the unseeded
    // world keeps the greedy law. exA/exB = that side exports (live strength).
    const seeded = new Set();
    const portOf = {};
    for (const p of ports) portOf[p.region] = p;
    for (const sd of (CALIB.dynamicTradeOnly ? [] : (CALIB.seaLaneSeeds || []))) {
      const A = portOf[sd.a], B = portOf[sd.b];
      if (!A || !B) continue;
      seeded.add(sd.a); seeded.add(sd.b);
      const d = (seaDist[sd.a] && seaDist[sd.a].get(sd.b)) != null ? seaDist[sd.a].get(sd.b) : 24;
      // impLive: this side's import row (partner flow ÷5) observed live at t1
      // (seeded lanes carry the corpus truth; default true — see seaLaneSeeds note)
      (out[sd.a] = out[sd.a] || []).push({ to: sd.b, weak: !sd.exA, inWeak: !sd.exB, impLive: sd.impA !== false, toPop: B.pop, toPort: B.basePort, ownPop: A.pop, ownPort: A.basePort, d, seeded: true });
      (out[sd.b] = out[sd.b] || []).push({ to: sd.a, weak: !sd.exB, inWeak: !sd.exA, impLive: sd.impB !== false, toPop: A.pop, toPort: A.basePort, ownPop: B.pop, ownPort: B.basePort, d, seeded: true });
    }
    const slots = {};
    // SLOTS = built port chain level (live 2026-06-18: Carthage dockyard = 3 sea exports, not 4 —
    // the symmetric scroll shows 3 exports + 3 imports, and the value law can't produce Hadrumetum's
    // 21 as a d28 export so it's an import). Was 1+level (over by one).
    for (const p of ports) slots[p.region] = Math.max(1, p.level);
    // PER-EXPORTER lane formation (live-cracked 2026-06-18, Carthage→Hippo Diarrhytus): the engine
    // is per-exporter, NOT bidirectional pairing. Each port forms EXPORT lanes to its nearest
    // slots[X] eligible partners INDEPENDENTLY of the partner's own slot usage (Carthage claims
    // nearby Xupon_Zaxyir even though that port's 2 slots are spent on its own nearer Karaly/Sulky).
    // A lane out[X]→Y exports iff Y ∈ nearestSet[X]; it carries X's IMPORT from Y iff X ∈ nearestSet[Y].
    const partnersOf = {};
    for (const pr of pairs) {
      const A = pr.a.region, B = pr.b.region;
      if (pr.river) {
        (out[A] = out[A] || []).push({ to: B, weak: false, inWeak: false, toPop: pr.b.pop, toPort: pr.b.basePort, ownPop: pr.a.pop, ownPort: pr.a.basePort, river: true, d: pr.d });
        (out[B] = out[B] || []).push({ to: A, weak: false, inWeak: false, toPop: pr.a.pop, toPort: pr.a.basePort, ownPop: pr.b.pop, ownPort: pr.b.basePort, river: true, d: pr.d });
        continue;
      }
      if (seeded.has(A) || seeded.has(B)) continue; // pinned ports don't re-match
      // DIRECTIONAL distance: the navigable sea distance is ASYMMETRIC (A→B ≠ B→A around coastlines), and a
      // port's EXPORT is valued/ranked over the EXPORTER→partner path. Using the shared pair distance (the
      // a<b-ordered direction) picked the wrong partner — Kichyros ranked Leukas (Leukas→Kichyros 45.9) over
      // Stratos, but Kichyros→Stratos (47.8) is actually NEARER than Kichyros→Leukas (48.5). Use seaDist[X][Y].
      const _dAB = (seaDist[A] && seaDist[A].get(B)) || pr.d, _dBA = (seaDist[B] && seaDist[B].get(A)) || pr.d;
      (partnersOf[A] = partnersOf[A] || []).push({ to: B, d: _dAB, pop: pr.b.pop, port: pr.b.basePort, ownPop: pr.a.pop, ownPort: pr.a.basePort, inval: pr.inval });
      (partnersOf[B] = partnersOf[B] || []).push({ to: A, d: _dBA, pop: pr.a.pop, port: pr.a.basePort, ownPop: pr.b.pop, ownPort: pr.b.basePort, inval: pr.inval });
    }
    // PROFIT-RANKED selection (live 2026-06-18): the engine fills each port's slots with its most
    // PROFITABLE partners (trade value), not its nearest — Carthage takes Arik(Eryx) over the closer
    // Epikrateia/Adrumet because cargo wins. Rank by the export value's per-partner factors (the
    // exporter-constant K·landRateX·popX cancel): dist^seaDist · (export+0.35·import+const) · popY^.06 · rights.
    const { qty: _GQ, rawValues: _RV } = tradeQtyMapsByRegion(modDataDir);
    const _spd = seaPortDistDepth(modDataDir);
    const _ownerFac = {}; for (const p of ports) _ownerFac[p.region] = p.fac;
    const _cargoVal = (A, B, exportOnly) => { const a = _GQ[A] || {}, b = _GQ[B] || {}; let e = 0, i = 0; for (const r in a) if (!(r in b)) e += a[r] * (_RV[r] || 0); if (exportOnly) return e; for (const r in b) if (!(r in a)) i += b[r] * (_RV[r] || 0); return e + CALIB.seaImportFrac * i; };
    const nearestSet = {};
    for (const X in partnersOf) {
      const dFromX = _spd.distFrom(X) || {};
      for (const pp of partnersOf[X]) {
        const dw = dFromX[pp.to], dist = Math.max(1, (dw != null && isFinite(dw)) ? dw : pp.d);
        // NOTE: lane SELECTION ranks by profit potential WITHOUT the trade-rights penalty (live 2026-06-18:
        // Rome picks foreign Capua d21 over same-faction Neapolis d27.7 — rights only scale realized VALUE,
        // not which lanes form).
        // SELECTION pop-weight: with the landing-frontier graph the engine prefers BIGGER partners over
        // nearer-but-smaller ones (Epirus Kichyros picks Stratos+Korkyra pop-3500 over Leukas pop-2300);
        // the value-fit popY (0.06) is far too weak for that. seaSelPopY is a separate selection weight.
        if (_useLF) {
          // ENGINE selection ranks export candidates by route value / dist_navigable (popX constant per X).
          // Rank by the EXPORT cargo (what X ships out) over the EXPORTER→partner navigable distance — NOT
          // the import cargo (which belongs to the partner's own export decision). With equal export cargo the
          // nearer partner wins: Kichyros→Stratos (47.8) correctly beats Kichyros→Leukas (48.5), matching the
          // game (which trades Kichyros↔Stratos, not Leukas). Including the import made the poorer-but-richer-
          // imports Leukas wrongly win.
          pp.profit = (_cargoVal(X, pp.to, true) + CALIB.seaConst_LF) / Math.max(1, pp.d);
        } else {
          pp.profit = Math.pow(dist, CALIB.seaDist) * (_cargoVal(X, pp.to) + CALIB.seaConst) * Math.pow(Math.max(400, pp.pop), CALIB.seaPopY);
        }
      }
      partnersOf[X].sort((u, v) => v.profit - u.profit);
      nearestSet[X] = new Set(partnersOf[X].slice(0, slots[X] || 1).map(p => p.to));
    }
    for (const X in partnersOf) for (const pp of partnersOf[X]) {
      const Y = pp.to, isExp = nearestSet[X].has(Y), isImp = !!(nearestSet[Y] && nearestSet[Y].has(X));
      if (!isExp && !isImp) continue;
      (out[X] = out[X] || []).push({ to: Y, weak: !isExp, inWeak: false, impLive: isImp, toPop: pp.pop, toPort: pp.port, ownPop: pp.ownPop, ownPort: pp.ownPort, d: pp.d, invalidBridge: pp.inval });
    }
    // TURN-1 ACTIVATION (Capua t1/t2 probe 2026-06-11 night): a partner's REVERSE flow
    // is live at turn 1 only if our port is that partner's NEAREST open-sea lane
    // (Praeneste→Capua live at t1 — Capua is its lane #1; Rome→Capua appears at t2 —
    // Capua is Rome's lane #2). toNearest = this lane is the PARTNER's nearest lane.
    const nearestOf = {};
    for (const r of Object.keys(out)) {
      let best = null;
      for (const l of out[r]) if (!l.river && (best == null || l.d < best.d)) best = l;
      if (best) nearestOf[r] = best.to;
    }
    for (const r of Object.keys(out)) for (const l of out[r]) l.toNearest = nearestOf[l.to] === r;
  } catch { /* none */ }
  return (_seaLaneCache[modDataDir] = out);
}

// ★ DEPTH-WEIGHTED WHITE-PORT SEA DISTANCE (live-cracked 2026-06-18 forced-corridor experiment).
// Trade route distance = PORT(white pixel in map_regions) → PORT(white pixel), path cost summed over
// map_ground_types depth: shallow R196 ×1 / medium R128 ×2 (½-range) / deep R64 BLOCKED. Sea value
// ∝ distance^-0.89 (CALIB.seaDist). Narrow straits (Gibraltar) bridged across 1 land cell. Lazy
// Dijkstra per source port, cached. Returns { distFrom(srcRegion) -> { region: pixelDist } }; callers
// fall back to the formation BFS distance for any still-unreachable lane.
const _seaPortDistCache = {};
function seaPortDistDepth(modDataDir) {
  if (_seaPortDistCache[modDataDir]) return _seaPortDistCache[modDataDir];
  const base = path.join(modDataDir, "world", "maps", "base");
  const rbuf = fs.readFileSync(path.join(base, "map_regions.tga"));
  const RW = rbuf.readUInt16LE(12), RH = rbuf.readUInt16LE(14), rOff = 18 + rbuf[0];
  const gbuf = fs.readFileSync(path.join(base, "map_ground_types.tga"));
  const GW2 = gbuf.readUInt16LE(12), GH2 = gbuf.readUInt16LE(14), gOff = 18 + gbuf[0], sxr = GW2 / RW, syr = GH2 / RH;
  const gw = RW, gh = RH, N = gw * gh;
  const sea = new Uint8Array(N), cls = new Uint8Array(N), body = new Uint8Array(N); // body = sea-color (B); rivers are their own bodies
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { const o = rOff + (y * RW + x) * 3; if (rbuf[o + 2] === 41 && rbuf[o + 1] === 140) { const idx = y * gw + x; sea[idx] = 1; body[idx] = rbuf[o]; const go = gOff + (Math.round(y * syr) * GW2 + Math.round(x * sxr)) * 3, R = gbuf[go + 2]; cls[idx] = (gbuf[go + 1] || gbuf[go]) ? 1 : (R >= 180 ? 1 : R >= 100 ? 2 : 3); } }
  const dg = require("./descrStratGeneral.js");
  const { rgbToRegion } = dg.parseDescrRegions(fs.readFileSync(path.join(base, "descr_regions.txt"), "latin1"));
  const sites = dg.buildRegionCoords(rbuf, rgbToRegion);
  const regs = Object.keys(sites).map(r => ({ r, x: sites[r].x, y: sites[r].y }));
  const portCell = {}; // white-pixel port → nearest sea cell
  for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) { const o = rOff + (y * RW + x) * 3; if (rbuf[o] === 255 && rbuf[o + 1] === 255 && rbuf[o + 2] === 255) { let b = null, bd = 400; for (const s of regs) { const dd = (s.x - x) ** 2 + (s.y - y) ** 2; if (dd < bd) { bd = dd; b = s.r; } } if (b && !portCell[b]) { let best = null, bdd = 1e9; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const gx = x + dx, gy = y + dy; if (gx < 0 || gy < 0 || gx >= gw || gy >= gh || !sea[gy * gw + gx]) continue; const dd = dx * dx + dy * dy; if (dd < bdd) { bdd = dd; best = gy * gw + gx; } } portCell[b] = best; } } }
  const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.41], [1, -1, 1.41], [-1, 1, 1.41], [-1, -1, 1.41]];
  const JUMP = [[2, 0], [-2, 0], [0, 2], [0, -2]], BRIDGE = 14;
  const cache = {}, D = new Float64Array(N), seen = new Uint8Array(N), heap = new Int32Array(N * 4); // reused (distFrom is not re-entrant)
  function distFrom(src) {
    if (cache[src]) return cache[src]; const start = portCell[src]; const out = {}; cache[src] = out; if (start == null) return out;
    D.fill(Infinity); seen.fill(0); D[start] = 0; let hn = 0;
    const up = () => { let i = hn - 1; const c = heap[i]; while (i > 0) { const p = (i - 1) >> 1; if (D[heap[p]] <= D[c]) break; heap[i] = heap[p]; i = p; } heap[i] = c; };
    const down = () => { let i = 0; const c = heap[0]; for (; ;) { let l = 2 * i + 1, r = l + 1, m = i, md = D[c]; if (l < hn && D[heap[l]] < md) { m = l; md = D[heap[l]]; } if (r < hn && D[heap[r]] < md) m = r; if (m === i) break; heap[i] = heap[m]; i = m; } heap[i] = c; };
    heap[hn++] = start;
    while (hn > 0) { const c = heap[0]; heap[0] = heap[--hn]; if (hn) down(); if (seen[c]) continue; seen[c] = 1; const d0 = D[c], cx = c % gw, cy = (c / gw) | 0;
      for (const [dx, dy, diag] of NB) { const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue; const nc = ny * gw + nx; if (!sea[nc] || cls[nc] === 3) continue; const nd = d0 + cls[nc] * diag; if (nd < D[nc]) { D[nc] = nd; heap[hn++] = nc; up(); } }
      for (const [dx, dy] of JUMP) { const mx = cx + dx / 2, my = cy + dy / 2, nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue; const mc = my * gw + mx, nc = ny * gw + nx; if (sea[mc] || !sea[nc] || cls[nc] === 3) continue; const nd = d0 + BRIDGE; if (nd < D[nc]) { D[nc] = nd; heap[hn++] = nc; up(); } } }
    for (const t in portCell) if (portCell[t] != null && isFinite(D[portCell[t]])) out[t] = D[portCell[t]];
    return out;
  }
  // RIVER distance: Dijkstra CONFINED to the source's water body (can't shortcut across delta land via
  // the coast) and with NO strait-bridging (channels are continuous within the body). Fixes the Nile
  // shortcut (Tanis) + obstruction-fallback (Mendes) that the full-grid distFrom hits in the delta.
  const cacheR = {};
  function distFromRiver(src) {
    if (cacheR[src]) return cacheR[src]; const start = portCell[src]; const out = {}; cacheR[src] = out; if (start == null) return out;
    const bid = body[start];
    D.fill(Infinity); seen.fill(0); D[start] = 0; let hn = 0;
    const up = () => { let i = hn - 1; const c = heap[i]; while (i > 0) { const p = (i - 1) >> 1; if (D[heap[p]] <= D[c]) break; heap[i] = heap[p]; i = p; } heap[i] = c; };
    const down = () => { let i = 0; const c = heap[0]; for (; ;) { let l = 2 * i + 1, r = l + 1, m = i, md = D[c]; if (l < hn && D[heap[l]] < md) { m = l; md = D[heap[l]]; } if (r < hn && D[heap[r]] < md) m = r; if (m === i) break; heap[i] = heap[m]; i = m; } heap[i] = c; };
    heap[hn++] = start;
    while (hn > 0) { const c = heap[0]; heap[0] = heap[--hn]; if (hn) down(); if (seen[c]) continue; seen[c] = 1; const d0 = D[c], cx = c % gw, cy = (c / gw) | 0;
      for (const [dx, dy, diag] of NB) { const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue; const nc = ny * gw + nx; if (!sea[nc] || cls[nc] === 3 || body[nc] !== bid) continue; const nd = d0 + cls[nc] * diag; if (nd < D[nc]) { D[nc] = nd; heap[hn++] = nc; up(); } } }
    for (const t in portCell) if (portCell[t] != null && body[portCell[t]] === bid && isFinite(D[portCell[t]])) out[t] = D[portCell[t]];
    return out;
  }
  return (_seaPortDistCache[modDataDir] = { distFrom, distFromRiver });
}

// ---- SEA FLOW CARGO: fixed-point market-saturation shortfall points per lane ----
// flow(X→Y) = f_lane × pts(X→Y), pts = Σ_resources u × max(1, fileValue), where per
// resource r of EXPORTER X's own region basket:
//   importer own qty ≥ 2                  → excluded (covered)
//   importer own qty 1 and shortfall < 2  → excluded
//   else u = eff(qX − qY),  eff(q) = min(q,4) + 0.32·max(0,q−4)
// SATURATION (glass/salt probe chain 2026-06-12, live-proven): u ×= 0.18 when the
// importer's competing routes beat the exporter on r:
//   • LAND competitor (partner region's own qty): needs C ≥ 3 AND C > qX
//     (relative rule — exporter qty ≥ competitor keeps full worth)
//   • SEA competitor: any HIGHER-PRIORITY (nearer) lane already shipping r
//     (Rome's glass-1 keeps full worth at Fregellae while Neapolis' glass-3 there
//     collapses — priority beats quantity between sea suppliers)
//   • zero-trade-value goods never compete (Praeneste stone-3 ships full past
//     Parthenope stone-4) but ship at value 1.
// Flows depend on competitor flows → iterative relaxation, 3 passes suffice.
const _seaFlowPtsCache = {};
function seaFlowPtsByLane(modDataDir) {
  if (_seaFlowPtsCache[modDataDir]) return _seaFlowPtsCache[modDataDir];
  const lanesBy = seaLanesByRegion(modDataDir);
  const { qty: GQ, values: GV, rawValues: RAW } = tradeQtyMapsByRegion(modDataDir);
  const adjacency = regionAdjacency(modDataDir);
  const { ownerOfRegion, wars } = tradePartnerCtx(modDataDir);
  const coords = regionCoords(modDataDir);
  // per-unit worth curve (see CALIB.seaEffUnits — probe-measured diminishing returns)
  const effQ = (q) => {
    if (CALIB.dynamicTradeOnly) return q; // cracked sea law: cargo is LINEAR in quantity (qty5=qty40 per-unit)
    const U = CALIB.seaEffUnits, T = CALIB.seaEffTail;
    let v = 0;
    for (let i = 0; i < q; i++) v += i < U.length ? U[i] : T;
    return v;
  };
  const sup = CALIB.seaSuppress;
  // importer's incoming open-sea suppliers, priority = lane d, euclid tiebreak
  const inBy = {};
  for (const X of Object.keys(lanesBy)) for (const ln of lanesBy[X]) {
    if (ln.river || ln.weak) continue; // weak sides ship nothing → don't compete
    (inBy[ln.to] = inBy[ln.to] || []).push({ from: X, d: ln.d });
  }
  const eu = (a, b) => { const ca = coords[a], cb = coords[b]; return ca && cb ? Math.hypot(ca.x - cb.x, ca.y - cb.y) : 999; };
  for (const Y of Object.keys(inBy)) inBy[Y].sort((p, q) => (p.d - q.d) || (eu(Y, p.from) - eu(Y, q.from)) || (p.from < q.from ? -1 : 1));
  // land competitors' own qty at each importer (valued goods only)
  const landC = {};
  for (const Y of Object.keys(inBy)) {
    const own = ownerOfRegion[Y]; const m = {};
    for (const n of (adjacency[Y] || [])) {
      const o = ownerOfRegion[n];
      if (!o || o === "slave") continue;
      if (own && o !== own && wars[own] && wars[own].has(o)) continue;
      const q = GQ[n] || {};
      for (const r of Object.keys(q)) if ((RAW[r] || 0) >= 1) m[r] = Math.max(m[r] || 0, q[r]);
    }
    landC[Y] = m;
  }
  let shipped = {};
  let pts = {};
  for (let pass = 0; pass < 3; pass++) {
    const next = {};
    pts = {};
    for (const X of Object.keys(lanesBy)) for (const ln of lanesBy[X]) {
      if (ln.river) continue;
      const Y = ln.to;
      const gx = GQ[X] || {}, gy = GQ[Y] || {};
      const pri = inBy[Y] || [];
      let myRank = -1;
      for (let i = 0; i < pri.length; i++) if (pri[i].from === X) { myRank = i; break; }
      let p = 0; const ship = {};
      for (const r of Object.keys(gx)) {
        const qx = gx[r], qy = gy[r] || 0;
        if (qy >= 2) continue;
        if (qy === 1 && qx - qy < 2) continue;
        let u = effQ(qx - qy);
        if (u <= 0) continue;
        if ((RAW[r] || 0) >= 1) { // zero-trade-value goods never compete (stone law)
          const cl = (landC[Y] || {})[r] || 0;
          let seaHit = false;
          for (let i = 0; i >= 0 && i < myRank; i++) { const sh = shipped[pri[i].from + ">" + Y]; if (sh && sh[r]) { seaHit = true; break; } }
          if ((cl >= 3 && cl > qx) || seaHit) u *= sup;
        }
        ship[r] = qx - qy;
        p += u * Math.max(1, GV[r] || 0);
      }
      next[X + ">" + Y] = ship;
      pts[X + ">" + Y] = p;
    }
    shipped = next;
  }
  return (_seaFlowPtsCache[modDataDir] = pts);
}

// ---- protectorates (CRACKED 2026-06-10, tribute-rate-fit.js) ----
// RIS seeds protectorates via `console_command become_protector <suzerain> <client>`
// in the campaign script. Tribute = 50.0% of the client's pre-tribute NET PROFIT per
// turn (verified to the denarius on 38 client rows across two turn-3 saves; client
// econ-slot f19 → suzerain f8). Flows from turn 2 (turn 1 has no prior profit).
const TRIBUTE_RATE = 0.5;
const _protCache = {};
function parseProtectorates(modDataDir) {
  if (_protCache[modDataDir]) return _protCache[modDataDir];
  const clientsOf = {}, suzerainOf = {};
  try {
    const dir = path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign");
    for (const f of fs.readdirSync(dir)) {
      if (!/\.txt$/i.test(f) || /^descr_strat/i.test(f)) continue;
      const text = fs.readFileSync(path.join(dir, f), "latin1");
      if (!/become_protector/i.test(text)) continue;
      for (const raw of text.split(/\r?\n/)) {
        const t = raw.includes(";") ? raw.slice(0, raw.indexOf(";")) : raw;
        const m = t.match(/console_command\s+become_protector\s+(\w+)\s+(\w+)/i);
        if (!m) continue;
        const suz = m[1].toLowerCase(), cli = m[2].toLowerCase();
        (clientsOf[suz] = clientsOf[suz] || []).push(cli);
        suzerainOf[cli] = suz;
      }
    }
  } catch { /* no campaign script */ }
  return (_protCache[modDataDir] = { clientsOf, suzerainOf });
}

// ---- the deliverable: STATIC turn-1 budget for a faction at given tax brackets ----
// bracketByCity: { settlementName(or region): "low"|"normal"|"high"|"very_high" } —
// typically the OPTIMAL brackets from growthEval.computeFactionGrowth. Missing → normal.
// Returns { faction, tier, settlements:[…], totals:{ taxes, farming, mining, trade,
// income, wages, corruption, armyBudget } } — armyBudget = income − wages − corruption
// = the sustainable per-turn upkeep budget for armies (the Army Setup unit budget).
function computeTurn1Budget(modDataDir, faction, bracketByCity, opts) {
  const F = computeIncomeFeatures(modDataDir, faction, { isPlayer: !(opts && opts.isPlayer === false) });
  if (F.error) return F;
  const coords = regionCoords(modDataDir);
  const br = bracketByCity || {};
  const cap = F.settlements.length ? coords[F.settlements[0].region] : null;
  const adjacency = regionAdjacency(modDataDir);
  const seaOf = regionSeaBodies(modDataDir);
  // GOVERNOR INCOME TRAITS (user lead 2026-06-10): seeded named characters standing on
  // a settlement tile modify that town's income — EDCT Effect TaxCollection/Trading/
  // Mining points are DIRECT PERCENTAGES (export_vnvs: "+10% bonus on tax income",
  // "30% penalty"). 302 RIS towns have nonzero income governors at start.
  // opts.govEffectByCity: CALIBRATION override — a save-derived governor-effect map
  // (govEffectByCityFromSave on a fresh turn-1 save) replaces the descr_strat seeds.
  // The save carries the START-RANDOMIZED personality traits for all ~1000 world
  // characters (798 governed settlements), so one turn-1 save calibrates the whole
  // campaign's randomness — for every faction, not just the player.
  let govFx = {};
  if (opts && opts.govEffectByCity) govFx = opts.govEffectByCity;
  else { try { const te = require("./traitEffects.js"); govFx = te.govEffectByCityFromStrat(modDataDir, te.parseTraitEffects(modDataDir)) || {}; } catch { } }
  const wonders = wonderOwners(modDataDir);
  const mineQty = mineQtyValByRegion(modDataDir);
  const { ownerOfRegion, allies, wars, portTowns, popOfRegion, roadOfRegion } = tradePartnerCtx(modDataDir);
  const facLow = F.faction;
  // Hanging Gardens: +20% farming income factionwide for the owner (validated exact).
  const gardensMult = wonders.gardens && wonders.gardens.owner === facLow ? 1.2 : 1;
  // Trade partner eligibility = NOT AT WAR (live-verified 2026-06-11: Sena Gallica
  // trades with Histria's Nesactium — a neutral foreign faction; the old own/ally
  // rule also dropped all client neighbours via the one-directional ally parse).
  const warSet = (wars && wars[facLow]) || new Set();
  const isPartner = (other) => !!other && (other === facLow || !warSet.has(other));
  // TRADE RIGHTS at campaign start = protectorate links (live saves 2026-06-12:
  // capua's trade list = its suzerain julii ONLY; julii's = its 6 clients + senate).
  // Roman factions are auto-allied with the senate.
  const protRights = parseProtectorates(modDataDir);
  const tradeRightsSet = new Set();
  if (protRights.suzerainOf[facLow]) tradeRightsSet.add(protRights.suzerainOf[facLow]);
  for (const c of (protRights.clientsOf[facLow] || [])) tradeRightsSet.add(c);
  if (/^romans?_/.test(facLow)) tradeRightsSet.add("romans_senate");
  if (facLow === "romans_senate") for (const f of ["romans_julii", "romans_brutii", "romans_scipii"]) tradeRightsSet.add(f);
  // VANILLA (map 0x78) land trade gives band 1.0 to descr_strat ALLIES (relationship ≤199),
  // not just protectorate trade-rights. Live Julii t1: Tarentum(Apulia, ally romans_brutii) reads
  // 31 (band 1.0 → law 30) where the rights-only band 0.33 gave 10; the Roman houses are
  // mutually allied at start. Macedon has ZERO allies (fully neutral), so this set = {macedon}
  // and the change is a strict no-op there. RIS keeps its own band ladder (this set is only read
  // by the vanilla branch). own faction is added so the predicate is self-contained.
  const _landAlliedBand = new Set([facLow, ...tradeRightsSet, ...((allies && allies[facLow]) || [])]);
  const tradeQtyVal = tradeQtyValByRegion(modDataDir);
  // per-region per-resource quantities (raw, slaves excluded) + descr_sm values, for the
  // qty-weighted exclusion cargo of the cracked land-trade law.
  const { qty: _goodsQty, rawValues: _rawVal } = tradeQtyMapsByRegion(modDataDir);
  // VANILLA (map 0x78): engine cargo = qty × (tradeable flag), NOT qty × trade-value — proven by vanilla's
  // high-value goods (gold=15) massively over-predicting trade. Flat-1 for any good with a nonzero descr_sm
  // value. RIS (0x7b) keeps its trade-value calibration (its goods are nearly all value-1, so it's ~the same).
  const _goodsVal = _mapVer(modDataDir) < 0x7b
    ? Object.fromEntries(Object.keys(_rawVal).map(k => [k, _rawVal[k] > 0 ? 1 : 0]))
    : _rawVal;
  const _landCargo = (Areg, Breg) => { // A's goods that B lacks, Σ qty×value
    const a = _goodsQty[Areg] || {}, b = _goodsQty[Breg] || {}; let c = 0;
    for (const r in a) if (!(r in b)) c += a[r] * (_goodsVal[r] || 0);
    return c;
  };
  const seaLanes = seaLanesByRegion(modDataDir);
  const seaPartnersOf = (region) => {
    const bodies = seaOf[region];
    if (!bodies || !bodies.length) return 0;
    const bset = new Set(bodies);
    let n = 0;
    for (const pt of portTowns) {
      if (pt.region === region || !isPartner(pt.fac)) continue;
      if ((seaOf[pt.region] || []).some(b => bset.has(b))) n++;
    }
    return n;
  };
  let taxes = 0, farming = 0, mining = 0, tradeLandSum = 0, tradeSeaSum = 0, corrSum = 0, admin = 0;
  const sets = [];
  // OFFICE-HOLDING governors (Quaestor/Praetor/Propraetor/Consul…) suppress their
  // town's corruption to ZERO (live-verified 2026-06-11: Praeneste d3, Reate d8,
  // Cosa d16 and capital Rome all read corruption 0 while equal-distance towns pay).
  const OFFICE_RE = /\b(Quaestor|Aedile|Praetor|Propraetor|Consul|Proconsul|Censor)\b/i;
  const popOv = (opts && opts.popByCity) || null; // committed-pop override (live-save budgets / corpus scoring)
  // PER-CAMPAIGN TAX MULTIPLIER H (opts.taxHByCity, 2026-06-12 resource-tax crack):
  // live taxes = model × H, H ∈ {0.85..1.15 in 0.05 steps} — a campaign-start roll
  // seeded by the exact file set (resource-tax-fit.md/fit2.md: NOT file-derivable,
  // NOT in saves, frozen per campaign). The app calibrates H per town from the
  // user's pasted live tax readings (max |resid| ≤6 den over the 19-town julii
  // validation corpus once H is known — the wired law is denarius-grade modulo H).
  const _normCity = (x) => String(x || "").replace(/[\s-]+/g, "_").toLowerCase();
  let taxHByCity = null;
  if (opts && opts.taxHByCity) {
    taxHByCity = {};
    for (const k of Object.keys(opts.taxHByCity)) {
      const v = Number(opts.taxHByCity[k] && opts.taxHByCity[k].h != null ? opts.taxHByCity[k].h : opts.taxHByCity[k]);
      if (Number.isFinite(v) && v > 0) taxHByCity[_normCity(k)] = v;
    }
    if (!Object.keys(taxHByCity).length) taxHByCity = null;
  }
  // PER-TOWN CORRUPTION OVERRIDE (opts.corrByCity, 2026-06-14): the engine's
  // corruption distance is road/pathfinding-based and not file-recoverable to the
  // denarius, but corruption is DETERMINISTIC per files — so the user pastes the live
  // per-town corruption once (corrCalib) and we reproduce it EXACTLY.
  let corrByCity = null;
  if (opts && opts.corrByCity) {
    corrByCity = {};
    for (const k of Object.keys(opts.corrByCity)) {
      const v = Number(opts.corrByCity[k] && opts.corrByCity[k].corr != null ? opts.corrByCity[k].corr : opts.corrByCity[k]);
      if (Number.isFinite(v) && v >= 0) corrByCity[_normCity(k)] = v;
    }
    if (!Object.keys(corrByCity).length) corrByCity = null;
  }
  // Per-region Large-Colony (colony_2+) trade-income bonus: the +20% scales BOTH the colony town's own exports
  // and the 0.2× import a PARTNER collects on the colony's goods (the partner imports the already-boosted flow).
  // Per-region trade-income-bonus M (the engine's per-route export multiplier "effect 24"): the settlement's
  // NET trade_base_income_bonus × 10 = colony + market + resource-industry + government(Dependency −4 / Indirect
  // −2) + EMPIRE-SIZE penalty (−1…−5 by faction settlement count) — ALL file-derived from the EDB; the model's
  // `tradePct` already sums them exactly (verified 2026-06-22: the in-game Region-scroll "Trade income bonus %"
  // = tradePct×10; Ambrakia's −20% is the size-4 empire penalty, NOT a capital penalty). M scales the town's own
  // exports AND the 0.2× import a partner collects on its goods. NO pins — pure EDB computation.
  // Per-region trade-income-bonus M (the engine's per-route export multiplier): M = 1 + max(0, tradePct)/10,
  // where tradePct = the NET trade_base_income_bonus from the EDB (colony + market + resource-industry + the
  // negative government/empire-size penalties). The POSITIVE bonuses (colony etc.) scale each export; the NET is
  // FLOORED at 0 so the negative government/size penalties don't reduce the per-route multiplier below 1.0 (they
  // hit per-total instead). Verified 2026-06-22: floor brings Kichyros/Korkyra (net-negative, M→1.0) into the
  // same seaK cluster as Leukas (+20% colony) etc., and reproduces the colony-removal ×1.20 exactly. NO pins.
  const colonyMByRegion = {};
  for (const _s of F.settlements) colonyMByRegion[_s.region] = (_s.tradePct || 0) * 10; // NO clamp: the trade-building M multiplies BOTH ways — a net-negative tradePct (size penalty > market) is a real trade PENALTY (M<1), confirmed by RIS land routes (Iguvium -4 -> M0.6, Camerinum -6 -> M0.4 land-exact). The M is still floored at 0 at the use sites.
  // cross-faction map so foreign imports apply the PARTNER's trade-building bonus (see tradePctByRegionAll)
  const tradePctAll = tradePctByRegionAll(modDataDir);
  for (const s of F.settlements) {
    if (popOv) { const pv = popOv[s.settlement] != null ? popOv[s.settlement] : popOv[s.region]; if (pv != null && pv > 0) s.pop = pv; }
    const bracket = br[s.settlement] || br[s.region] || "normal";
    const mult = BRACKET_MULT[bracket] || 1;
    const gv0 = govFx[s.settlement] || govFx[s.region] || null;
    // STRating (the game's engine-computed tax-rating meta-trait) is a real tax channel
    // for single-town city-states (Capua-validated) but OVER-credits governed towns in a
    // multi-settlement faction (live julii4 Neapolis 365 < no-gov base 382 → its modelled
    // +15% isn't in the game). Drop STRating's contribution from the governor tax
    // multiplier for multi-town factions; keep it for single-town. (2026-06-15)
    // GOVERNOR TAX MULTIPLIER — single-town only. The julii4 no-gov experiment (general
    // removed, read with vs without) proved the trait-derived governor tax effect is NOISE
    // for multi-town: Neapolis/Corfinium/Arpi/Metapontum all read tax-NEUTRAL in-game, yet
    // the trait sum gave Metapontum −10% (a spurious Corrupt/STRating credit). So neutralize
    // it for multi-town (gTax=1). Single-town city-states (Capua) keep the full trait tax
    // (incl. STRating) — live-validated there. The real per-governor effects that DO exist
    // (Cosa +5%, Rome −15%) are NOT trait-derived (they track command / high-pop squalor),
    // so dropping the trait multiplier loses nothing the model was capturing. (2026-06-15)
    const gTax = (gv0 && F.settlements.length === 1) ? Math.max(0, 1 + (gv0.tax || 0) / 100) : 1;
    const gTrading = gv0 ? Math.max(0, 1 + (gv0.trading || 0) / 100) : 1;
    const gMine = gv0 ? Math.max(0, 1 + (gv0.mining || 0) / 100) : 1;
    const f = Math.max(0, 1 + (s.taxPctParts.base + s.taxPctParts.winter) / 100);
    const wLog = Math.max(0, 400 * (Math.log(Math.max(400, s.pop)) - 4.4));
    // multi-town factions: the cracked flat-points law (see CALIB.taxBaseK).
    // SINGLE-TOWN factions: EXACT city-state law from the live Capua 4-bracket sweep
    // (2026-06-11 evening; bottom-bar incomes 4137/4454/4771/5246 perfectly linear):
    // taxes = 0.8154·W·rate·gov − 43.2·gov — the population coefficient runs 1.79×
    // the imperial law and the flat building points collapse to ~0 (the player-side
    // sibling of the AI tier-1 subsidy regime). Validated exact at all 4 brackets.
    // TURN-1 IS SUMMER — NEVER WINTER (user, 2026-06-15, emphatic). The EDB
    // `disabling_in_winter` taxable_income_bonus lines (e.g. bonus −10 requires
    // disabling_in_winter) are a WINTER-ONLY penalty; at turn 1 they are inactive, so the
    // winter bucket must be ZERO for every town. Folding it in injected spurious per-town
    // tax (Arretium's resource-driven winter −3 vs the typical −13 split same-pop towns
    // that are otherwise identical — Falerii/Arpi base+size −75/−77). Turn-1 tax = base +
    // size only; the W(pop) anchors below are re-derived winter-free from no-governor game
    // reads (Sena 252 / Arpi 562 / Neapolis 365 / Arretium 360 / Rome 1465).
    const taxPts = s.taxPctParts.base + s.taxPctParts.size;
    // decompose so the UI can evaluate the model at ANY bracket (H calibration):
    // tax(bracket) = max(0, bracketMult × taxW + taxFlat) [pre-H]
    // multi-town: POWER-LAW up to the knee, then LINEAR to the Rome 9000 anchor (the pop
    // sweep proved the curve is linear above ~3k; the power law's bow above the chord was
    // the mid-pop over-estimate — see CALIB.taxPopKnee).
    // single-town (city-states / Capua): unchanged log law (separately calibrated).
    // NEW multiplicative tax law (Bruttians experiment 2026-06-16): tax = floor(rate·(popBase+40·pts)).
    // popBase from CALIB.popBasePre/Post (measured, half-integer), −125 cliff at pop 9707. Expressed
    // in the existing rate·w+flat shape with w = popBase + taxPointK·pts and flat = 0.
    // NOTE: building taxable coefficients beyond region_base are still being calibrated — full-building
    // cities (Carthage) are WIP until each building's pts contribution is measured & corrected.
    const _pp = Math.max(400, s.pop);
    // RIS capital-tax calibration (from the map/data files + 4 capital settlement scrolls,
    // 2026-06-30: Athens/Kyrene/Seleucia/Rome). The capital tax multiplier is ~31.3 (not 40),
    // capitals track the PRE-cliff populace curve, and the Roman capital carries a ~123-denarius
    // tax-base suppression the EDB does not express. Vanilla (map < 0x7b) keeps ×40 / cliff intact.
    const _ris = _mapVer(modDataDir) >= 0x7b;
    const _pbT = (_pp >= CALIB.taxCliffPop && !(_ris && s.capital)) ? CALIB.popBasePost : CALIB.popBasePre;
    let _pb;
    if (_pp <= _pbT[0][0]) _pb = _pbT[0][1];
    else { let _hit = false; for (let i = 1; i < _pbT.length; i++) { if (_pp <= _pbT[i][0]) { const [x0, y0] = _pbT[i - 1], [x1, y1] = _pbT[i]; _pb = y0 + (y1 - y0) * (_pp - x0) / (x1 - x0); _hit = true; break; } } if (!_hit) { const [x0, y0] = _pbT[_pbT.length - 2], [x1, y1] = _pbT[_pbT.length - 1]; _pb = y1 + (y1 - y0) * (_pp - x1) / (x1 - x0); } }
    const _multi = F.settlements.length > 1;
    // NEW TAX LAW (2026-06-17, cracked via Bruttians/Cyrene/Julii/Carthage; ref gov-tax.js):
    //   multi-town  tax = floor( (rate·popBase + M·Σ) · (1 + govTax%) )
    //   Σ = FULL taxablePct (base+size+winter): the disabling_in_winter taxable lines DO fire
    //   at turn-1 (it is summer; "winter" = disabled-in-winter, i.e. active now). Validated
    //   denarius-exact on Cyrene (port/roads included). M = 40 for the CAPITAL (any empire
    //   size) and for any town when empireTier≤2; M = 4 for non-capitals at tier≥3.
    //   governor tax = the engine's per-settlement taxEffect% from the save (gv0.taxEffect,
    //   authoritative: STRating+Wealthy+ancillaries). Non-live (descr_strat, no save) → 0.
    // a tax-granting world wonder (Oracle of Dodona) flips its town to capital-style tax.
    const _wonderCapTax = (s.buildings || []).some(b => CALIB.taxCapitalWonders.some(w => b.endsWith(":" + w)));
    const _capTax = s.capital || _wonderCapTax;
    // Capital uses ×40 on its (usually positive) region_base bonus, but a capital must never be taxed
    // HARDER than a normal town — applying ×40 to a NEGATIVE taxablePct (large empires, where building/
    // empire-size penalties dominate) wrongly drove the capital's tax to 0 (live: Alexandria pays 481,
    // model gave 0). So on a negative taxablePct the capital falls back to the ×4 non-capital rate.
    // Small-empire capitals (positive taxablePct) are unchanged. (Live Ptolemaic turn-1, 2026-06-21.)
    const _M = _capTax ? (s.taxablePct >= 0 ? (_ris ? 31.32 : 40) : 4) : (F.tier <= 2 ? 40 : 4);
    // taxablePct (region_base + building points) × _M. The "40/pt for region_base only" split was
    // tested (s.taxableRegionBase / s.taxableBuilding are exposed for it) but every building-multiplier
    // traded factions on the current corpus — the big-empire under-tax needs per-city scrolls to pin.
    const _flatPts = _M * s.taxablePct + (_ris && _capTax && /^romans?_/.test(F.faction) ? -123 : 0);
    // RATE BEHAVIOR differs by capital (live Cyrene tax-rate reads, 2026-06-17):
    //   CAPITAL  → multiplicative: tax = rate·(popBase + M·Σ)·gov  (the points scale with rate).
    //             Kyrene V.High 1172 = 1.5·(842+200)·0.75 (additive would give 1097).
    //   NON-CAP  → additive: tax = (rate·popBase + M·Σ)·gov  (points are a flat term).
    //             Ptolemais V.High 779 = 1.5·658.5 − 208 (multiplicative would give 675).
    //   At Normal rate the two coincide (×1.0), which is why the all-Normal total still holds.
    const taxW = _multi ? (_capTax ? _pb + _flatPts : _pb) : (CALIB.taxLogK_single * wLog * gTax);
    const taxFlat = _multi ? (_capTax ? 0 : _flatPts) : (CALIB.taxFlatSingle * gTax);
    const taxH = taxHByCity ? (taxHByCity[_normCity(s.settlement)] != null ? taxHByCity[_normCity(s.settlement)]
      : taxHByCity[_normCity(s.region)]) : null;
    // The engine floors the pre-governor settlement tax to an INTEGER first (the tax income
    // shown on the settlement scroll), THEN applies the governor % and floors again. Applying
    // the governor to the unfloored base over-reads by 1 denarius on fractional bases
    // (Tetrapyrgia N 566.5×1.10→623 vs game 622; Automala Low 451.6×1.05→474 vs game 473).
    // Settlement tax can go NEGATIVE in large empires (building + empire-size penalties exceed the
    // populace base) — live Ptolemaic Mendes-Thmouis pays −62. The engine TRUNCATES toward zero
    // (positives floor as before; −62.5→−62, matching the game), so no 0-floor and Math.trunc not floor.
    const tTaxNoH = Math.trunc(mult * taxW + taxFlat); // integer pre-governor tax (corruption uses this)
    // governor tax multiplier from the save's per-settlement taxEffect% (multi-town only).
    // Governor tax effect on multi-town settlements: the save's authoritative per-settlement taxEffect%
    // when available, else the trait-derived gov tax (gv0.tax, which EXCLUDES STRating — the component
    // the old julii4 finding flagged as multi-town noise). Live Ptolemaic turn-1 (2026-06-21) confirmed
    // governors DO move settlement tax (Alexandria −23%, Pelousion +40%): applying it makes Oxyrhynchos
    // exact and improves Cyrene (+9→+5%); julii governors carry no trait tax so it's a no-op there.
    const _govTaxPct = (_multi && gv0 && gv0.taxEffect != null) ? gv0.taxEffect
      : (_multi && gv0 && gv0.tax != null) ? gv0.tax : 0;
    const tTax = tTaxNoH * (1 + _govTaxPct / 100) * (taxH != null ? taxH : 1);
    // governor Effect Farming = +1 farm level per point for INCOME (confirmed 2026-06-10,
    // gov-farm-income-test.js: 10/11 player factions land at ratio 1.000-1.002 with u=1 —
    // farming income is now exact; the lone seleucid +20% is a separate EDB underparse).
    const tFarm = CALIB.farmPoint * (s.farmN + s.farmLevel + (gv0 ? (gv0.growthFarm || 0) : 0)) * gardensMult;
    const tMine = CALIB.minePoint * s.mineSum * (mineQty[s.region] || 0) * gMine;
    // TAX faction total = Σ of the per-settlement FLOORED taxes. Each town's tax income is an
    // integer in-game (the settlement scroll truncates, e.g. 365.628→365), and the faction
    // financial line sums those integers — NOT floor(Σ of unfloored taxes), which over-reports
    // by the dropped fractions (live Cyrene: floor-of-sum 4477 vs sum-of-floored 4475). Farming
    // stays an unrounded accumulator (its law is calibrated so floor(Σ) hits the exact panel total).
    taxes += Math.trunc(tTax); farming += tFarm; mining += tMine; // trunc toward zero: a NEGATIVE settlement tax reads −73, not −74 (the engine truncates, doesn't floor)
    // quantity-weighted resource value (descr_strat qty column); Set-based fallback
    const rv = tradeQtyVal[s.region] != null ? tradeQtyVal[s.region] : s.resources.reduce((a, r) => a + (r.tradeValue || 0), 0);
    const tradePts = s.tradePctParts ? (s.tradePctParts.base + s.tradePctParts.winter) : (s.tradePct || 0);
    const gTrade = Math.max(0, 1 + CALIB.tradeBonusPct * tradePts / 100) * gTrading;
    let nPartners = 0;
    // LAND TRADE = PER-ROUTE LAW v3 (2026-06-12, julii 26-town t1 corpus + capua):
    // v = K · popX^0.224 · e^(0.156·pctX) · (1+rvX)^0.594 · e^(road·−0.073)
    //     · (1+rvY)^0.275 · popY^+0.133, × 0.35 when the partner faction has NO
    // TRADE RIGHTS with us (rights = suzerain/client links from become_protector;
    // live capua save: trade list = julii only; julii save: senate + its 6 clients).
    // R² 0.947 on 118 rights-rows; no-rights median 0.349 over 17 rows.
    // cracked land-trade rate: linear in the town's net trade_base_income_bonus (tradePct).
    const _landRate = CALIB.tradeLandRateBase + CALIB.tradeLandRatePct * (s.tradePct || 0);
    let landTrade = 0;
    const landPins = CALIB.dynamicTradeOnly ? null : (CALIB.landLaneRows || {})[s.region];
    if (landPins) {
      // LIVE-PINNED town (see CALIB.landLaneRows): the pin set is the COMPLETE
      // scroll partner list — land trade = Σ pinned rows. Live values already
      // include the vintage's governor Trading, so no extra multipliers.
      for (const n of Object.keys(landPins)) { landTrade += landPins[n]; nPartners++; }
    } else {
      // LAND PARTNERS: engine-exact type-0 frontier edges (map.rwm) when available, else pixel adjacency.
      let landNeighbors;
      const fEdges = CALIB.useFrontierGraph ? frontierGraph(modDataDir)[s.region] : null;
      if (fEdges && fEdges.length) {
        // VANILLA (0x78): land partner = EVERY type-0 frontier neighbour with a valid (non-slave, non-war) owner —
        // the owner filter below does the real work; the f10 cutoff was an over-aggressive approximation that wrongly
        // killed valid long-border partners (Pontus→Armenia f10=492, Hatra→Media f10=514, both confirmed trade in-game).
        // RIS (0x7b) keeps its tuned f10 cutoff. Both still drop bord≤2 strait hops (those are SEA, handled below).
        const _f10cut = _mapVer(modDataDir) < 0x7b ? Infinity : CALIB.frontierF10Cutoff;
        landNeighbors = fEdges.filter(e => e.type === 0 && e.f10 <= _f10cut
          && !(CALIB.useLandingFrontiers && (_mapVer(modDataDir) < 0x7b ? e.bord <= 2 : e.f10 > CALIB.seaInvalidF10))).map(e => e.region);
        // INVALID-BRIDGE detection. VANILLA (map 0x78): bord≈1 = a strait/gulf hop (map-independent, correct).
        // RIS (0x7b): keep the f10>150 cutoff its land calibration was tuned against (bord would add 2472 borders
        // and blow up Epirus). f10's scale differs by map (RIS huge vs vanilla 255-wide) so it can't be shared.
      } else {
        landNeighbors = (adjacency[s.region] || []);  // fallback: region not in frontier graph (e.g. unmatched entry)
      }
      // NOTE: RTW LAND trade is DIRECT-border only — there is no through-ally land network. A faction's
      // non-adjacent allied-town trade (e.g. Julii Arretium↔Capua) is actually SEA: a PORT settlement trades
      // with a coastal region along their shared sea-body even when that region has NO port (user-confirmed:
      // Capua has no port but Arretium does). That coastal sea trade is handled in the sea block below.
      // VANILLA: the trader/market band is applied PER-ROUTE with truncation — the engine computes
      // ⌊band·base⌋ for each land row, so Σ⌊M·row⌋ < (Σrow)·M by the dropped fractions. Live-confirmed:
      // Hatra 110→107, Sinope 178→177, Mazaka 100→99 (each route ⌊1.10·base⌋). RIS keeps its calibrated total-band law.
      const _landM = Math.max(0, 1 + (colonyMByRegion[s.region] || 0) / 100 + 0.74 * ((gv0 && gv0.trading) || 0) / 100);
      const _vanLandM = true; // RIS now uses the same exe-cracked land law + per-route trunc as vanilla (engine is identical; only the data differs)
      for (const n of landNeighbors) {
        const own = ownerOfRegion[n];
        if (own === "slave") continue; // rebels: every faction is permanently at war with slave → no trade
        if (process.env.RIGHTS_GATE ? !(own === facLow || tradeRightsSet.has(own)) : !isPartner(own)) continue;
        nPartners++;
        const hasRights = own === facLow || tradeRightsSet.has(own);
        // ROAD MULTIPLIER (live-cracked 2026-06-17, Rome road-sweep new campaign):
        // route × (1 + min(max(0, roadExporter − 1), roadImporter)). The EXPORTER (s, whose
        // scroll this row is on) contributes road−1 (the `roads` building = engine road_level
        // 0 → no bonus; paved → 1; highways → 2); the IMPORTER's road CAPS it (no road → ×1
        // flat). Linear in min. Validated exact: Rome `roads`→Cosa 76 (×1), `paved`→Cosa 152
        // (×2), `highways`→Cosa 152 (capped by Cosa's `roads`); Cosa→Rome & Reate→Rome stay
        // flat because their exporters' roads are ≤1 (term 0). Replaces the bogus e^(−0.073·road).
        const roadMult = 1 + Math.min(Math.max(0, (s.roadLevel || 0) - 1), roadOfRegion[n] || 0);
        // qty-weighted exclusion cargo: exporter's goods n lacks (+ ½ of n's goods exporter lacks)
        const _exC = _landCargo(s.region, n), _imC = _landCargo(n, s.region);
        let _landRow;
        if (CALIB.useLandingFrontiers) {
          // ENGINE LAND-TRADE LAW (Gemini-confirmed): Cargo · BAND · Road_Multiplier · landBandBump. NO distance
          // term (land is localized adjacent exchange — f10 is only the validity check, not a divisor). The
          // diplomatic band is the SAME 0.5 own / 0.66 trade-rights / 0.33 neutral as sea; the uniform ~+30%
          // inland inflation was a flat 1.0 own-band. landBandBump re-absorbs the constant the old 1.0 hid.
          // NOTE: LAND own-faction band is 0.5 (landBandOwn); SEA own-faction is a harsher 0.33 (the engine
          // penalises internal naval trade more than internal land trade — Gemini, 2026-06-22).
          if (_vanLandM) {
            // ★ Vanilla land-trade law (derived from the map.rwm region graph + descr_strat resources + descr_sm
            // trade values): value = trunc( roadMult · band · (0.13·fastSqrt(popExp+popPartner) + 2·exportCargoTV + importCargoTV) )
            // cargo = qty × descr_sm TRADE VALUE (gold15, timber5…), EXPORT goods DOUBLED, exclusive goods only
            // (shared goods cancel). band = 1.0 own/treaty, 0.33 foreign-neutral, 0 war. roadMult=1 & bonusPct=0
            // at dirt-road turn-1. Matches 7/8 in-game route values exactly; truncate toward zero.
            const _gx = _goodsQty[s.region] || {}, _gy = _goodsQty[n] || {};
            let _exTV = 0, _imTV = 0;
            for (const r in _gx) if (!(r in _gy)) _exTV += _gx[r] * (_rawVal[r] || 0);
            for (const r in _gy) if (!(r in _gx)) _imTV += _gy[r] * (_rawVal[r] || 0);
            const _vband = _landAlliedBand.has(own) ? 1.0 : CALIB.seaBandForeign;
            // popOfRegion is the reliable pop source (the live save s.pop is garbage for some settlements; the old
            // land law never read pop so it was latent). Exporter pop = popOfRegion[s.region].
            const _popExp = popOfRegion[s.region] || s.pop || 0;
            _landRow = Math.trunc(roadMult * _vband * (0.13 * _fastSqrt(_popExp + (popOfRegion[n] || 0)) + 2 * _exTV + _imTV));
          } else {
            const _band = own === facLow ? CALIB.landBandOwn : (tradeRightsSet.has(own) ? CALIB.seaBandAgree : CALIB.seaBandForeign);
            _landRow = _landRate * CALIB.landBandBump * (_exC + CALIB.tradeLandImportFrac * _imC + CALIB.tradeLandConst)
              * roadMult * _band;
          }
        } else {
          _landRow = _landRate * (_exC + CALIB.tradeLandImportFrac * _imC + CALIB.tradeLandConst)
            * roadMult * (hasRights ? 1 : CALIB.tradeNoRights);
        }
        landTrade += _vanLandM ? Math.trunc(_landM * _landRow) : _landRow;
        if (process.env.TRADE_DEBUG) (global.__TDBG = global.__TDBG || []).push({
          kind: "land", from: s.settlement, fromRegion: s.region, toRegion: n,
          cargo: (tradeQtyVal[n] || 0), road: (roadOfRegion[n] || 0) + (s.roadLevel || 0),
          popFrom: s.pop, popTo: (popOfRegion[n] || 0), exp: _vanLandM ? Math.trunc(_landM * _landRow) : Math.round(_landRow), imp: 0
        });
      }
      // TRADE-BUILDING bonus M (cracked in-game 2026-06-25, Corduba trader add/remove): the settlement's
      // trade_base_income_bonus (market chain trader+10%/market+20%/forum+30%/…, plus resource industries)
      // multiplies ALL its trade — LAND as well as sea. M = 1 + tradePct/10 (= colonyMByRegion/100). The model
      // already applied this to sea export; it was missing on land (Corduba 89→97 with its +10% trader).
      // GOVERNOR TRADING (Alexandria GoodTrader probe): +trading% scales the export component on top.
      if (!_vanLandM) landTrade *= Math.max(0, 1 + (colonyMByRegion[s.region] || 0) / 100 + 0.74 * ((gv0 && gv0.trading) || 0) / 100);
    }
    tradeLandSum += landTrade;
    // SEA = PER-LANE FLOWS. OPEN-SEA LAW (Capua t1/t2 probes 2026-06-11 night +
    // MAMERTINES QUANTITY-SHORTFALL crack 2026-06-12, Messana wine 3 vs Consentia
    // wine 1 → 2×33 = 66 live EXACT):
    //   strong export flow = seaCargoK × shortfall-cargo(X→Y), where per resource
    //   the importer EXCLUDES it when qtyY ≥ 2 or the shortfall is < 2; a qtyY of 1
    //   only dampens (cargo unit = eff(qtyX − qtyY)); zero-value resources floored
    //   to 1 (Latium stone3 IS the Praeneste flow). Strong-row f-table median error
    //   1.2% (shortfall-grid.js 2026-06-12).
    //   importer earns exporter's flow / 5 (live /5 law, Delos/Naxos exact);
    //   TURN-1 RULE: a partner's reverse flow is live only if we are that partner's
    //   NEAREST lane (Praeneste→Capua live t1; Rome→Capua appears only at t2).
    //   Weak slot sides export nothing (unchanged).
    // RIVER lanes (Nile) keep the pop-law fit (713/605/519 validated, ×1.95).
    let seaTrade = 0;
    // a portless coastal settlement has no export fleet, but STILL earns the 0.2× import row from any port that
    // exports to it (e.g. Lilybaeum imports from Carthage) — so process whenever there are inbound lanes too.
    if (s.portLevel || (seaLanes[s.region] || []).length) {
      const lanes = seaLanes[s.region] || [];
      const lanePts = seaFlowPtsByLane(modDataDir);
      const isPly = !(opts && opts.asAI);
      // DIRECTIONAL dNav: the engine reads dNav from the EXPORTER's landing-frontier record, so a flow X→Y must
      // use X's frontier distance — NOT the lane's stored .d (which, on a MUTUAL route, is the importer's own
      // export distance Y→X). This is why Antioch's import from Rhodes read 10 not 15: the impLive import reused
      // Antioch→Rhodes' distance instead of Rhodes→Antioch's. lfg is module-cached.
      const _lfgB = landingFrontierGraph(modDataDir);
      const _dNavOf = (X, Y) => { const e = (_lfgB[X] || []).find(z => z.region === Y); return e ? e.dist : null; };
      // per-lane f: live-calibrated where measured (see CALIB.seaLaneF), else the
      // open-sea constant 33. 'ply' regime applies when the EXPORTER town belongs
      // to the faction this budget is computed for (as the human player) — the
      // Praeneste→Capua ×0.49 player split, live-confirmed in 2+3 campaigns.
      const flowOf = (X, Y, ply, ln2) => {
        const e = CALIB.dynamicTradeOnly ? null : (CALIB.seaLaneF || {})[X + ">" + Y];
        if (e && e.fix != null) return e.fix; // live-pinned flow (e.g. slave-island exporters with empty cargo baskets)
        const cargo = lanePts[X + ">" + Y] || 0;
        if (e) {
          const v0 = ply ? (e.ply != null ? e.ply : e.ai) : (e.ai != null ? e.ai : e.ply);
          if (v0 != null) return v0 * cargo; // live-calibrated per-lane f (julii/cyrene)
        }
        // UNPINNED lanes — DATA-DRIVEN cross-faction sea law (cyrene + carthage live fit,
        // 2026-06-16): export ≈ a·√(popX+popY) + b·cargo + c·cargo/d. Replaces the old flat
        // f=33 (which over-counted carthage 2.35×). cargo = Σ qty·tradeValue from the files,
        // d = sea-lane movement distance, pops from descr_strat — all mod-file derived, so it
        // auto-updates. Slope still imperfect (rms ~37 on 10 routes) pending more single-good
        // control routes, but a large improvement over the constant.
        if (ln2 && CALIB.dynamicTradeOnly) {
          // ★★ CRACKED SEA EXPORT (Kyrene controlled amber experiment 2026-06-18):
          //   seaK · popX^a · popY^b · d^c · (cargo + seaConst) · rights
          // Same shape as land (rate × (cargo+const)) with a STEEP distance factor instead of roads.
          // cargo = FULL-exclusion qty×value of the EXPORTER's goods the importer lacks (amber test:
          // baseline cargo + amber both reproduce exactly). seaConst pinned by the amber dilution.
          // d is the sea-lane BFS distance (TODO: sea-depth-weight it — shallow×1/medium×2/deep block).
          const isExp = X === s.region;
          // EXPORTER POP: prefer popOfRegion (descr_strat, reliable) over the live-save s.pop.
          // VANILLA (map 0x78) ONLY: some live turn-1 saves carry a GARBAGE settlement pop for the
          // player's towns (e.g. Arretium reads 4244388962), and the bit-hack √(popX+popY) in the
          // vanilla sea law turns that into a ~6515 pop term → a 41109 Etruria→Africa lane. The land
          // law already reads popOfRegion for exactly this reason (see _popExp above); the sea law
          // was the last latent s.pop user. RIS (0x7b) keeps s.pop — its calibrated sea law was fit
          // against it and is unaffected by this garbage (and Macedon parses clean), so leave it.
          const _sPop = (_mapVer(modDataDir) < 0x7b) ? (popOfRegion[s.region] || s.pop || 1500) : (s.pop || 1500);
          const popX = Math.max(400, isExp ? _sPop : (ln2.toPop || 1500));
          const popY = Math.max(400, isExp ? (ln2.toPop || 1500) : _sPop);
          const tPX = isExp ? (s.tradePct || 0) : 0; // exporter trade-buildings (import leg → base rate)
          const landRateX = CALIB.tradeLandRateBase + CALIB.tradeLandRatePct * tPX;
          const gx = _goodsQty[X] || {}, gy = _goodsQty[Y] || {};
          let cF = 0; for (const r in gx) if (!(r in gy)) cF += gx[r] * (_goodsVal[r] || 0); // export cargo
          let iC = 0; for (const r in gy) if (!(r in gx)) iC += gy[r] * (_goodsVal[r] || 0); // import cargo (×seaImportFrac)
          const ownX = ownerOfRegion[X], ownY = ownerOfRegion[Y];
          // RELATIONSHIP BAND (engine: 0.5/0.66/0.33). LF uses it directly; own-faction internal trade is its
          // own factor — calibrated on Epirus (own routes were over, foreign under = a flat 1.0/0.5 artifact).
          const _trueOwn = ownX === ownY; // genuinely the same faction
          const _own = _trueOwn || (/^romans?_/.test(ownX || "") && /^romans?_/.test(ownY || "")), _agr = tradeRightsSet.has(ownY) || tradeRightsSet.has(ownX);
          const rights = CALIB.useLandingFrontiers
            ? (_own ? CALIB.seaBandOwn : _agr ? CALIB.seaBandAgree : CALIB.seaBandForeign)
            : ((_own || _agr) ? 1.0 : CALIB.seaRightsForeign);
          // distance = depth-weighted white-port path; RIVER lanes use the body-confined channel path
          // (no delta shortcut/block); fall back to formation BFS for anything still unreachable.
          // EXACT ENGINE FORMULA (decompiled from the route-value function, 2026-06-22):
          //   export = (0.1·√(exporterPop) + Σ qty·tradeValue) × 8 × relationshipBand × C ÷ distance
          // base goes through a fast-sqrt (√pop, NOT pop^2 — the earlier empirical fit was wrong); cargo is the
          // matched exclusion qty×value; band = 0.5 ally / 0.66 neutral / 0.33 war; LINEAR in 1/distance. The
          // importer earns export×~0.2 (the /5 law) — handled by the strong/weak aggregation below.
          if (CALIB.useLandingFrontiers) {
            // MIN-DISTANCE FLOOR (Gemini 2026-06-22): the floor is a FAILSAFE only for f10-INVALIDATED land-bridges
            // (the Ambrakia gulf hop reclassified as sea) to stop the 1/dist denominator exploding. The engine does
            // NOT floor TRUE open-sea routes — so an adjacent island↔mainland hop like Leukas↔Oiniadai (d29) keeps
            // its raw distance (was crushed 250→clamped; raw 29 gives its real ~2× value).
            const dRaw = (ln2 && ln2.river) ? (function(){ const _s = seaPortDistDepth(modDataDir); return (_s.distFromRiver(X) || {})[Y] || 20; })() : (_dNavOf(X, Y) || (ln2 && ln2.d) || 20);
            const dLF = (ln2 && ln2.invalidBridge) ? Math.max(CALIB.seaDistFloor, dRaw) : dRaw;
            // pop term: the bit-hack fast-sqrt of (exporterPop + importerPop) — the SUM of both settlement pops
            // (confirmed from the game's trade-value math, 2026-06-23).
            const _vanSea = _mapVer(modDataDir) < 0x7b;
            const _useCracked = true; // engine routeValue formula (exe-cracked) now applies to RIS too — same engine
            if (_useCracked) {
              // ★ EXE-cracked vanilla routeValue (FUN_1414a3e70): export =
              //   seaKV·(seaPopCoefV·fastSqrt(popX+popY) + cargoFull)·gate / dNav
              // popX+popY = both settlement pops (two get_population vcalls, summed — confirmed in asm). cargoFull =
              // Σ qty×descr_sm tradeValue of the exporter's goods the partner lacks (IMUL qty×value in the asm — full
              // value, NOT the flat-1 the older model used). dLF = dNav. gate (seaGate*V, fit to the turn-1 scroll
              // corpus): foreign 0.5, agreement 0.66, own 0.36 — internal naval trade is penalised (the asm shows
              // own-faction SKIPPING the 0.5, i.e. nominally full, but the live numbers come out ~0.36, so own ports
              // do NOT dominate selection — Carthage still picks its own Lilybaeum over foreign Syracuse on distance).
              // pin = popX + popY (BOTH settlement pops, byte-confirmed from routeValue's two vtable+0x130 reads —
              // the portless partner's pop IS included, unlike the old popX-only heuristic).
              // RIS: the EXPORT leg keys on the EXPORTER pop only (popX), not the popX+popY sum vanilla uses. Validated
              // against the engine's own per-route pins (Thourioi->Taras export 69 vs pin-target 71; Metapontion->Chonia
              // 88 — both popX-exact): a one-way export carries only the exporter's pop; the asm's popX+popY is the
              // selection/combined value (the partner pop re-enters only via the separate mutual-only import leg).
              const _pinV = _vanSea ? (popX + popY) : popX;
              const _b = new ArrayBuffer(4), _f = new Float32Array(_b), _i = new Int32Array(_b);
              _f[0] = _pinV; _i[0] = (((_i[0] + 0xc0800000) | 0) >> 1) + 0x3f800000; // bit-hack fastSqrt
              const _ptV = CALIB.seaPopCoefV * _f[0];
              let _cFv = 0; for (const r in gx) if (!(r in gy)) _cFv += gx[r] * ((_vanSea && r === "copper") ? 6 : (_rawVal[r] || 0)); // SEA cargo uses the REAL resource values (same as the land law), vanilla + RIS; copper=6 sea-adjust is vanilla-only
              const _gateV = _vanSea ? (_trueOwn ? CALIB.seaGateTrueOwnV : _own ? CALIB.seaGateOwnV : _agr ? CALIB.seaGateAgreeV : CALIB.seaGateForeignV) : ((_trueOwn || _own) ? 1.0 : (_agr ? CALIB.seaGateAgreeRisV : CALIB.seaGateForeignV));
              return Math.max(0, CALIB.seaKV * (_ptV + _cFv + CALIB.seaBaseTerm) * _gateV / dLF);
            }
            const _pin = (CALIB.seaPopSum ? (popX + popY) : popX);
            let _pt;
            if (CALIB.seaPopMode === "bithack") { const _b = new ArrayBuffer(4), _f = new Float32Array(_b), _i = new Int32Array(_b); _f[0] = _pin; _i[0] = (((_i[0] + 0xc0800000) | 0) >> 1) + 0x3f800000; _pt = 0.1 * _f[0]; }
            else { _pt = 0.1 * Math.pow(_pin, CALIB.seaPopExp || 0.5); }
            return Math.max(0, CALIB.seaK_LF * (_pt + cF + CALIB.seaImportFrac * iC) * rights / dLF);
          }
          const _spd = seaPortDistDepth(modDataDir);
          const _dWp = (ln2 && ln2.river) ? (_spd.distFromRiver(X) || {})[Y] : (_spd.distFrom(X) || {})[Y];
          const d = Math.max(1, (_dWp != null && isFinite(_dWp)) ? _dWp : (ln2.d || 20));
          return Math.max(0, CALIB.seaK * Math.pow(landRateX, CALIB.seaExpG) * Math.pow(popX, CALIB.seaPopX) * Math.pow(popY, CALIB.seaPopY)
            * Math.pow(d, CALIB.seaDist) * (cF + CALIB.seaImportFrac * iC + CALIB.seaConst) * rights);
        }
        if (ln2 && cargo > 0) {
          // v2 inverse-distance law (legacy, non-dynamic). `s` is in scope (closure): the EXPORTER
          // is X. When X is this settlement's region it's an export row; otherwise the import row.
          const L = CALIB.seaLaw2;
          const isExp = X === s.region;
          const popX = Math.max(400, isExp ? (s.pop || 1500) : (ln2.toPop || 1500));
          const popY = Math.max(400, isExp ? (ln2.toPop || 1500) : (s.pop || 1500));
          const tP = isExp ? (s.tradePct || 0) : 0;
          const d = Math.max(1, ln2.d || 20);
          const cg = Math.max(0.5, cargo);
          return Math.max(0, Math.exp(L.b0) * Math.pow(cg, L.bCargo) * Math.exp(L.bTPct * tP)
            * Math.pow(popX, L.bPopF) * Math.pow(d, L.bD) * Math.pow(popY, L.bPopT));
        }
        return CALIB.seaCargoK * cargo;
      };
      for (const ln of lanes) {
        let expV, impV;
        if (ln.river) {
          // RIVER lanes now use the cracked sea law (white-port channel distance + cargo) × river mult
          // (rivers run hotter) — was a flat pop-only law ignoring distance/cargo (Nile flat 1318).
          const rm = CALIB.seaFlowRiverMult;
          const impPlyR = ownerOfRegion[ln.to] === facLow ? isPly : false;
          expV = rm * flowOf(s.region, ln.to, isPly, ln);
          impV = rm * flowOf(ln.to, s.region, impPlyR, ln) / 5;
        } else if (CALIB.useLandingFrontiers) {
          // LF aggregation: my export ONLY on the lane I selected (1 slot for a tier-1 port — the cap is absolute). I collect
          // the 0.2× importer cut on goods flowing back FROM a FOREIGN partner (always — the 2-row foreign
          // trade) OR from an OWN-faction partner that EXPORTS to me (impLive — e.g. Korkyra→Kichyros: Kichyros
          // collects the tariff on Korkyra's inbound goods even though its own export slot went to Stratos).
          expV = ln.weak ? 0 : flowOf(s.region, ln.to, isPly, ln);
          // Import only on a genuinely MUTUAL route (the partner slots me back = impLive) — the engine adds the
          // 0.2× tariff only when there is a real reverse export. (Was a RIS-only blanket "any foreign partner
          // imports" rule; that handed a phantom import to settlements whose far partner — Issa/Histria — never
          // reciprocates, over-counting Sena Gallica/Venusia/Arpi/Canusium. Vanilla was always mutual-only.)
          // RIS suzerain exception: a trade-rights CLIENT (protectorate) still ships me its inbound goods even when
          // the landing-frontier profit-ranker spent its one export slot on a nearer port — the trade agreement
          // carries the tariff. (Paestum collects Bruttium's import though Bruttium's slot went to nearer Mamertina;
          // the live pin Bruttium->Poseidonia ai=15.5 confirms it. Plain-foreign far partners form no client link.)
          const _agrLane = (_mapVer(modDataDir) >= 0x7b) && ownerOfRegion[ln.to] !== facLow && tradeRightsSet.has(ownerOfRegion[ln.to]);
          impV = (!!ln.impLive || _agrLane) ? flowOf(ln.to, s.region, false, ln) * CALIB.seaImportCut : 0;
        } else {
          expV = ln.weak ? 0 : flowOf(s.region, ln.to, isPly, ln);
          const impPly = ownerOfRegion[ln.to] === facLow ? isPly : false;
          // import-row t1 activation: seeded lanes carry the OBSERVED flag
          // (impLive); unseeded lanes keep the nearest-lane heuristic.
          const impDark = ln.impLive != null ? !ln.impLive : !ln.toNearest;
          impV = (ln.inWeak || impDark) ? 0 : flowOf(ln.to, s.region, impPly, ln) / 5;
        }
        // REGION TRADE-INCOME-BONUS modifier (cracked 2026-06-22 via the Leukas colony-removal experiment +
        // the in-game Region Information Scroll). The engine scales every EXPORT leg by
        //   M = 1 + tradePct/10 + governorTrading/100
        // where tradePct = the town's NET trade_base_income_bonus (the scroll's "Trade income bonus %" is
        // exactly tradePct×10 — colony_2's trade_base +2 displays as +20%, and removing colony_2 cut Leukas's
        // exports by ×1.20 to the denarius). Per-EXPORTER; the import leg (partner's export back) is unaffected,
        // which the experiment confirmed (Leukas's import rows 82/69 didn't move when its colony was removed).
        // Large Colony (colony_2) = +20% trade income bonus — measured to the denarius (Leukas colony-removal cut
        // exports ×1.20) AND confirmed verbatim on the in-game building scroll. Small Colony (colony_1) is a
        // smaller bonus the scroll calls out but we don't yet apply (its host settlements' base is mis-parsed).
        const _colTrade = colonyMByRegion[s.region] || 0;
        const _seaTradeM = Math.max(0, 1 + _colTrade / 100 + 0.74 * ((gv0 && gv0.trading) || 0) / 100);
        expV *= _seaTradeM;
        // import leg: the partner's Large-Colony bonus rides on the goods we import from it (its export was boosted)
        impV *= 1 + (tradePctAll[ln.to] != null ? tradePctAll[ln.to] : (colonyMByRegion[ln.to] || 0)) / 100;
        // COLOSSUS rides on the EXPORTER, not the importer. A partner whose faction owns the Colossus exports at
        // the +20% wonder rate (faction-wide sea boost), so the 0.2x import we collect from it carries that boost.
        // In-game proof: Antioch's import from Rhodes is +25% (12→15) ONLY because Rhodes (the partner) has the
        // Colossus — making Rhodes a palace/city/capital changed nothing; the boost is the wonder on the exporter.
        if (_mapVer(modDataDir) < 0x7b && wonders.colossus && ownerOfRegion[ln.to] === wonders.colossus.owner) impV *= 1.20;
        // VANILLA: the engine CEILS the per-row import (⌈0.2·routeValue⌉ — ceilf in the route-value writer), which
        // the model's round-of-the-total was losing (Thessalonica→Rhodes import 0.2·82=16.4 → ⌈⌉17, model gave 16).
        // Exports stay summed-raw: their float sits a hair high, so the total round already matches and ceiling them
        // double-counts (over-shot Thessalonica/Arretium/Sinope/Rhodes by 1). So ceil imports only.
        seaTrade += (_mapVer(modDataDir) < 0x7b) ? (Math.round(expV) + Math.ceil(impV)) : (expV + impV);
        if (process.env.TRADE_DEBUG) (global.__TDBG = global.__TDBG || []).push({
          kind: ln.river ? "river" : "sea", from: s.settlement, fromRegion: s.region, toRegion: ln.to,
          cargo: (lanePts[s.region + ">" + ln.to] || 0), d: ln.d, popFrom: s.pop, popTo: ln.toPop,
          exp: Math.round(expV), imp: (_mapVer(modDataDir) < 0x7b) ? Math.ceil(impV) : Math.round(impV), weak: !!ln.weak,
          tradePctF: s.tradePct || 0, portF: s.portLevel || 0, rvF: tradeQtyVal[s.region] || 0,
          tradePctT: 0, portT: ln.toPort || 0,
          pinned: !!(CALIB.seaLaneF || {})[s.region + ">" + ln.to]
        });
      }
      // COLOSSUS OF RHODES (wonder): the faction owning the colossus landmark gets +20% of EACH of its
      // settlements' sea trade (ceil), faction-wide. Controlled-experiment proven 2026-06-25: removing the
      // `landmark colossus` line dropped Rhodes' Trade 128→106 and Syracuse 131→113 (= their row totals),
      // i.e. the bonus = ⌈0.20·sea⌉ (22=⌈0.2·106⌉, 18=⌈0.2·89⌉). The "+40%" tooltip is the described rate;
      // the applied income effect is +20% of the SEA total (Syracuse rules out +40%-of-export).
      if (wonders.colossus && wonders.colossus.owner === facLow) seaTrade += Math.ceil(0.20 * seaTrade);
      tradeSeaSum += seaTrade;
    }
    // measured live t1 override for the played faction (see CALIB.tradeMeasuredByPlayer)
    const _measTbl = CALIB.dynamicTradeOnly ? null : CALIB.tradeMeasuredByPlayer[facLow];
    const _measKey = _measTbl && String(s.settlement || "").replace(/[\s-]+/g, "_");
    const _meas = _measTbl ? (_measTbl[_measKey] != null ? _measTbl[_measKey] : _measTbl[s.settlement]) : null;
    if (_meas != null) { tradeLandSum += _meas - landTrade; tradeSeaSum -= seaTrade; }
    const tTrade = _meas != null ? _meas : landTrade + seaTrade;
    // ADMIN income (the in-game scroll's 4th row, labeled "Governor" — ledger f9
    // 'other'): admin% × town gross.
    // EXACT LAW (2026-06-11 live cyrene, 7/7 towns to the denarius): admin% =
    // 2 × the governor's DISPLAYED Management stat (clamped at 0, as the card does).
    // The save stores the computed stat per character (mgmtStat via
    // govEffectByCityFromSave) — when present, use it. Fallback (no save):
    // the legacy joint-refit estimate 4 + 0.75·min(mgmt,3) + 0.25·law⁺.
    const tAdmin = gv0
      ? (gv0.mgmtStat != null
        ? (2 * Math.max(0, gv0.mgmtStat)) / 100 * (tTax + tFarm + tMine + tTrade)
        : Math.max(0, (4 + 0.75 * Math.min(3, Math.max(0, gv0.mgmt || 0)) + 0.25 * Math.max(0, gv0.law || 0)) / 100) * (tTax + tFarm + tMine + tTrade))
      : 0;
    // Faction admin total = Σ of per-town FLOORED admin (the in-game Governor line is a whole
    // number per settlement, summed). Flooring the unfloored sum over-reports by the dropped
    // fractions (live Cyrene: 535 vs the towns summing to 531) — same staged-floor rule as taxes.
    admin += Math.floor(tAdmin);
    let dist = null, corrPct = 0, lawTot = 0;
    const c = coords[s.region];
    if (cap && c) {
      dist = Math.hypot(c.x - cap.x, c.y - cap.y);
      // CORRUPTION (live-cracked 2026-06-11, 11-town ladder): per-town % of GROSS
      // CORRUPTION — EXACT ENGINE LAW (live console experiments 2026-06-11 evening:
      // give_trait probes on Larinum/Camerinum/Pisae + the 33-town two-faction corpus):
      //   • corr% = q(distance) of gross — law has NO gradual effect (HarshJustice
      //     law 1→3 on Larinum: corruption %% identical)
      //   • settlement LAW ≥ 3 → corruption ZERO (hard threshold: Larinum law 3 → 0,
      //     Arpi law 2 (live PO panel) → corrupt). Law = the PO panel's Law row:
      //     building law (walls, garrison, terrain) + governor trait law.
      //   • law < 0 → distance inflates ~4 tiles per negative point (Pisae law −2:
      //     14.3%% → 20.2%%; matches the cyrene steppe/desert trio)
      //   • capital 0; no display floor (Volaterrae shows 0.92%% live); the old
      //     office-zero rule is SUBSUMED (office traits carry law ≥ 3).
      // Model law parses with ±1 noise (trait levels, task #16) — at EXACTLY 3 the
      // model half-weights the curve to absorb the boundary uncertainty.
      // Validation: julii Σ2,544/2,496 (+1.9%%), cyrene Σ1,019/1,009 (+1.0%%).
      lawTot = (s.lawBonus || 0) + (gv0 ? (gv0.lawCorr != null ? gv0.lawCorr : (gv0.law || 0)) : 0);
      // GRAND REFIT (2026-06-11 evening, 91 towns with PANEL-READ law across julii/
      // cyrene/egypt + console probes): corruption is LAW-SUBTRACTIVE, not a threshold:
      // corr% = min(cap, max(0, a*x + b*x^2 - lawPct*lawPts)), x = d - d0. Joint refit on
      // 111 computed-law towns: rmse 3.46pp (lawPct 3 absorbs the parse bias; panel-law
      // fit was 5%/pt). The old threshold-3 reading was this law in a small sample.
      // REFIT 3 (2026-06-14, corruption-refit-3.md): the FIRST complete per-town live
      // corruption corpus (26-town Republic-of-Rome julii save) — corrA 0.74→0.64,
      // corrD0 15.5→11.25 (live Fregellae d11 is already corrupt → onset ~11, not 15.5),
      // corrLawPct 3→2.5 (the negative-law inflation term lawPct·|lawTot| was over-
      // charging cyrene's desert towns at lawPct 3 → +10.7%; lawPct 2.5 brings cyrene to
      // +3.9% AND fits julii). Joint-guarded: julii 2581/2569 (+12, per-town MAE 14.7),
      // egypt −2.6%, cyrene +3.9%. RESIDUAL = euclidean ≠ engine pathfinding/road
      // distance-to-capital: the two largest residuals are coastal Metapontum (eucl 51
      // but game corr ~ a d≈45 town: shorter road route → model OVER +86) and inland-toe
      // Venusia/Locri (longer road route → model UNDER −48/−35). The save's PO panel
      // distance-to-capital penalty (orderBreakdown[11]) is 5%-quantized (reads 0/1/2
      // across all 26 towns) → too coarse to use as the metric; no finer pathfinding
      // distance is recoverable from the save, so euclidean + refit constants is the
      // shipped best metric (no-save accuracy preserved).
      const x = Math.max(0, dist - CALIB.corrD0);
      const raw = CALIB.corrA * x + CALIB.corrB * x * x - CALIB.corrLawPct * lawTot;
      corrPct = Math.min(CALIB.corrCap, Math.max(0, raw)) / 100;
    }
    // corruption gross uses the PRE-H (pre-fortune) tax base: H is a tax-display
    // fortune multiplier and must not cascade into the corruption base (live julii
    // Republic save 2026-06-14: H-gross gave 2238 vs game 2574; pre-H gives ~2661).
    // corrByCity (live paste) overrides the formula EXACTLY when present.
    const corrOv = corrByCity ? (corrByCity[_normCity(s.settlement)] != null ? corrByCity[_normCity(s.settlement)] : corrByCity[_normCity(s.region)]) : null;
    const corrAmt = corrOv != null ? corrOv : corrPct * (tTaxNoH + tFarm + tMine + tTrade + tAdmin);
    corrSum += corrAmt;
    // DOCUMENTED engine formulas (Feral Battle_and_Campaign_Formulae.md):
    // siege hold-out turns = base(by level) + wall_level+1 + floor(govManagement/3)
    const SIEGE_BASE = { village: 2, town: 3, large_town: 4, city: 4, large_city: 5, huge_city: 5 };
    const siegeTurns = (SIEGE_BASE[s.level] != null ? SIEGE_BASE[s.level] : 3)
      + ((s.wallLevel != null && s.wallLevel >= 0 ? s.wallLevel : -1) + 1)
      + Math.floor(Math.max(0, gv0 ? (gv0.mgmt || 0) : 0) / 3);
    // random plague chance/turn = ((squalorPips−3) − 2×healthPips)/20 when squalor>3
    const SQ_BASE = { village: 400, town: 400, large_town: 2000, city: 4000, large_city: 9000, huge_city: 14000 };
    const effPop = s.pop + Math.max(0, s.pop - 2 * (SQ_BASE[s.level] != null ? SQ_BASE[s.level] : 2000));
    const sqPips = Math.floor(effPop / 1500);
    const plagueRiskPct = sqPips > 3 ? Math.max(0, ((sqPips - 3) - 2 * (s.healthPips || 0)) / 20) * 100 : 0;
    sets.push({ settlement: s.settlement, region: s.region, pop: s.pop, level: s.level, capital: s.capital,
      buildings: s.buildings,  // chain:level list — feeds the handler's garrison-unit recommender (mic tier gating)
      // taxParts: pre-H bracket decomposition (tax(b) = max(0, mult_b·w + flat));
      // taxH: the applied per-campaign calibration multiplier (null = uncalibrated)
      taxParts: { w: taxW, flat: taxFlat }, taxH: taxH != null ? taxH : null,
      // Income lines TRUNCATE in the panel — tax/trade/mining/admin are FLOORED (live julii4:
      // Neapolis tax 365.628→365; Venusia admin 107.6→107 not 108; trade 193). FARMING stays
      // ROUNDED: its law is calibrated so the FACTION total floors to exact (19356), and at the
      // per-town level the rounded value matches the panel (Venusia 809.7→810) — flooring it
      // would show 809 and we can't lift the law without breaking the faction sum. (2026-06-16)
      bracket, taxes: Math.trunc(tTax), farming: Math.round(tFarm), mining: Math.floor(tMine), trade: Math.floor(tTrade), admin: Math.floor(tAdmin),
      corruption: Math.floor(corrAmt),
      corrCalibrated: corrOv != null ? true : undefined,
      // settlement NET income (the in-game scroll's "Net Income"): gross − corruption
      totalIncome: Math.round(tTax + tFarm + tMine + tTrade + tAdmin - corrAmt),
      _corrGross: process.env.CORR_DEBUG ? (tTaxNoH + tFarm + tMine + tTrade + tAdmin) : undefined,
      _corrLawTot: process.env.CORR_DEBUG ? lawTot : undefined,
      _corrPct: process.env.CORR_DEBUG ? corrPct : undefined,
      taxFactor: Math.round(f * 100) / 100, resourceValue: rv, port: !!s.portLevel, tradePartners: nPartners, distToCapital: dist != null ? Math.round(dist) : null,
      siegeTurns, plagueRiskPct: Math.round(plagueRiskPct * 10) / 10,
      govIncome: gv0 && (gv0.tax || gv0.trading || gv0.mining) ? { tax: gv0.tax || 0, trading: gv0.trading || 0, mining: gv0.mining || 0, hits: gv0.hits || [] } : null });
  }
  let trade = Math.max(0, tradeLandSum + tradeSeaSum); // sea is per-lane (flow values), no aggregate scale
  const ch = countCharacters(modDataDir, faction) || { named: 0, admiral: 0 };
  const wages = CALIB.wageNamed * ch.named + CALIB.wageAdmiral * ch.admiral;
  let corruption = Math.max(0, Math.round(corrSum));
  // AI PERSPECTIVE (opts.asAI, cracked ai-bonus-crack.js): the AI doesn't pay the
  // human 0.92 difficulty malus on taxes+farming, and gets the tiered empire-size
  // income bonus on its whole economy. Validated against 215 AI ledgers.
  if (opts && opts.asAI) {
    const aff = CALIB.aiTaxAffineByTier[F.tier] || [1.0, 0];
    taxes = Math.max(0, (taxes / CALIB.difficultyIncome) * aff[0] + aff[1]);
    farming = farming / CALIB.difficultyIncome * CALIB.aiFarmBonus;
    // mining gets NO AI bonus (validated 2026-06-11: all 8 mining AI factions read
    // exactly model/1.189 with the bonus applied — truth = the unscaled base law)
    trade *= CALIB.aiFarmBonus * (CALIB.aiTradeFixByTier[F.tier] != null ? CALIB.aiTradeFixByTier[F.tier] : 1.0);
    corruption = Math.round(corruption / CALIB.difficultyIncome * CALIB.aiFarmBonus * (CALIB.aiCorrFixByTier[F.tier] != null ? CALIB.aiCorrFixByTier[F.tier] : 1.0));
    admin = Math.round(admin * (CALIB.aiAdminFixByTier[F.tier] != null ? CALIB.aiAdminFixByTier[F.tier] : 1.0));
  } else if (opts && opts.humanDifficulty === "normal") {
    // NORMAL difficulty (human): no 0.92 income malus — Hard/V.Hard only, but the base
    // lines bake in H/H. Un-divide it from every income line that scales with it: farming,
    // taxes, admin and corruption (all ride the populace gross). Validated per-town vs the
    // 26 Julii settlement scrolls (farm exact; admin within ±3/town once un-Hard'd).
    taxes = taxes / CALIB.difficultyIncome;
    farming = farming / CALIB.difficultyIncome;
    admin = admin / CALIB.difficultyIncome;
    corruption = Math.round(corruption / CALIB.difficultyIncome);
  }
  admin = Math.floor(admin); // faction admin line truncates like the rest
  // SAVE-AWARE 'other' income (governor-admin + tribute; the engine recalculates it at
  // end-of-turn). When a save provides the live value, count it verbatim instead of the
  // modeled admin — the figure the user sees right now — and suppress the fabricated
  // client-net tribute estimate (the tribute block below is gated on this too).
  if (opts && opts.storedOtherIncome != null && Number.isFinite(opts.storedOtherIncome)) {
    admin = Math.floor(opts.storedOtherIncome);
  }
  const income = Math.round(taxes + farming + mining + trade + admin);
  const army = armyUpkeepEDU(modDataDir, faction);
  const preNet = army ? (income - wages - corruption - army.upkeep) : null;
  // ---- protectorate tribute (50% of client net profit, flows from turn 2) ----
  // Suzerains: + half of each client's modeled net (client at all-Normal brackets —
  // the AI's actual taxes vary, so this is a magnitude, not denarius-exact).
  // Clients: − half of own profit (only when profitable; deficits pay nothing).
  let tributeIn = 0, tributeOut = 0, suzerain = null, clients = null;
  // When the save's live 'other' income is supplied it already includes the real
  // tribute (which the engine recalculates at end-of-turn), so don't fabricate a
  // separate client-net estimate on top of it — that was inflating netAfterTribute.
  if (!(opts && (opts._noTribute || opts.storedOtherIncome != null))) {
    const prot = parseProtectorates(modDataDir);
    const fac = F.faction;
    if (prot.clientsOf[fac]) {
      clients = [];
      for (const c of prot.clientsOf[fac]) {
        // clients are AI factions — use the AI economy (affine tier laws incl. the
        // city-state subsidy floor), not player rules (fixed 2026-06-11: julii's
        // tribute floor was 1,034 vs ~7,048 live because client nets ran as player)
        const cb = computeTurn1Budget(modDataDir, c, null, { isPlayer: false, asAI: true, _noTribute: true, govEffectByCity: opts && opts.govEffectByCity });
        const cNet = cb && !cb.error && cb.totals ? cb.totals.net : null;
        const t = cNet != null ? Math.round(TRIBUTE_RATE * Math.max(0, cNet)) : 0;
        tributeIn += t;
        clients.push({ faction: c, net: cNet, tribute: t });
      }
    }
    if (prot.suzerainOf[fac]) {
      suzerain = prot.suzerainOf[fac];
      if (preNet != null && preNet > 0) tributeOut = Math.round(TRIBUTE_RATE * preNet);
    }
  }
  return {
    faction: F.faction, tier: F.tier, nSettlements: F.nSettlements, settlements: sets,
    characters: ch,
    totals: {
      // faction-total income lines are FLOORED — the in-game panel truncates each total
      // (live julii4: farm 73.6×ΣN = 19356.8 → game 19356, not 19357; tax/trade likewise).
      taxes: Math.floor(taxes), farming: Math.floor(farming), mining: Math.floor(mining), trade: Math.floor(trade),
      admin, income, wages, corruption,
      // tributeIn is a CONSERVATIVE FLOOR (client profits are modeled at Normal tax
      // and the income model currently underestimates small/city-state factions —
      // live turn-3 tribute runs several × higher). Kept OUT of armyBudget so the
      // validated budget number stays honest; netAfterTribute is the steady-state
      // (turn-2+) view including it. tributeOut scales with own profit.
      tributeIn: tributeIn || 0,
      armyBudget: income - wages - corruption,
      // starting-army upkeep (EDU estimate) + the balance verdict the mod team needs:
      // net = what's left each turn AFTER the seeded army. Negative = over budget.
      armyUpkeep: army ? army.upkeep : null,
      armyUnits: army ? army.units : null,
      net: preNet,
      tributeOut: tributeOut || 0,
      netAfterTribute: preNet != null ? preNet + tributeIn - tributeOut : null,
      suzerain,                       // set when this faction is a protectorate
      nClients: clients ? clients.length : 0,
    },
    protectorate: (clients || suzerain) ? { suzerain, clients } : null,
    // honest accuracy notes for the UI (validated vs the 10-faction turn-1 corpus)
    accuracy: { taxes: "exact for small/mid empires; large empires read low (Empire-Size penalty ×M scale, WIP)", farming: "exact (±1)", trade: "partner set exact (frontier graph); per-route value ±10% (east) / ±15% (coastal sea)", wages: "exact", army_upkeep: "exact (EDU law)", corruption: "~±1% of income", tribute: "50% of client net (exact rate; client nets modeled at Normal tax)", aiFactions: "per-tier affine fit applied to AI economy (corrected, not pure-law)", unmodeled: "'other' income (~1-4% of total)" },
  };
}

module.exports = { empireTier, parseEDBIncome, parseResourceValues, computeIncomeFeatures, countCharacters, computeTurn1Budget, armyUpkeepEDU, parseProtectorates, TRIBUTE_RATE, CALIB, regionAdjacency, regionBorderLen, frontierGraph, landingFrontierGraph, tradePartnerCtx, tradeQtyValByRegion, tradeQtyMapsByRegion, tradeGoodsByRegion, seaLanesByRegion, seaFlowPtsByLane, seaPortDistDepth };
