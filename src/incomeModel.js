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
  let curBuilding = null, levelsList = [], curLevel = null;
  const aliases = {};
  let curAlias = null;
  const add = (kind, obj) => {
    if (!curBuilding || !curLevel) return;
    const key = curBuilding + ":" + curLevel;
    (capIndex[key] = capIndex[key] || { taxable: [], trade: [], tradeLvl: [], mine: [], fleet: [], walls: [], health: [], law: [] })[kind].push(obj);
  };
  for (const raw of lines) {
    const ln = raw.replace(/;.*$/, "");
    const am = ln.match(/^alias\s+(\S+)/);
    if (am) { curAlias = am[1]; continue; }
    if (curAlias) { const rq = ln.match(/^\s*requires\s+(.+)/); if (rq) { aliases[curAlias] = rq[1].trim(); curAlias = null; } else if (/^\s*\}/.test(ln)) curAlias = null; continue; }
    const bm = ln.match(/^building\s+(\w+)/);
    if (bm) { curBuilding = bm[1]; levelsList = []; curLevel = null; continue; }
    const lm = ln.match(/^\s*levels\s+(.+)$/);
    if (lm) { levelsList = lm[1].trim().split(/\s+/).filter(w => w && w !== "{"); chainLevels[curBuilding] = levelsList.slice(); continue; }
    const tok = ln.trim().split(/\s+/);
    if (levelsList.length && tok[0] && levelsList.includes(tok[0]) && (tok[1] === "requires" || tok[1] === undefined || tok[1] === "{")) {
      curLevel = tok[0]; continue;
    }
    let m;
    if ((m = ln.match(/^\s*taxable_income_bonus\s+bonus\s+(-?\d+)(?:\s+requires\s+(.+))?/))) { add("taxable", { val: +m[1], req: (m[2] || "").trim() }); continue; }
    if ((m = ln.match(/^\s*trade_base_income_bonus\s+bonus\s+(-?\d+)(?:\s+requires\s+(.+))?/))) { add("trade", { val: +m[1], req: (m[2] || "").trim() }); continue; }
    if ((m = ln.match(/^\s*trade_level_bonus\s+bonus\s+(-?\d+)(?:\s+requires\s+(.+))?/))) { add("tradeLvl", { val: +m[1], req: (m[2] || "").trim() }); continue; }
    if ((m = ln.match(/^\s*mine_resource\s+(-?\d+)(?:\s+requires\s+(.+))?/))) { add("mine", { val: +m[1], req: (m[2] || "").trim() }); continue; }
    if ((m = ln.match(/^\s*trade_fleet\s+(-?\d+)(?:\s+requires\s+(.+))?/))) { add("fleet", { val: +m[1], req: (m[2] || "").trim() }); continue; }
    if ((m = ln.match(/^\s*wall_level\s+(-?\d+)(?:\s+requires\s+(.+))?/))) { add("walls", { val: +m[1], req: (m[2] || "").trim() }); continue; }
    if ((m = ln.match(/^\s*population_health_bonus\s+bonus\s+(-?\d+)(?:\s+requires\s+(.+))?/))) { add("health", { val: +m[1], req: (m[2] || "").trim() }); continue; }
    if ((m = ln.match(/^\s*law_bonus\s+bonus\s+(-?\d+)(?:\s+requires\s+(.+))?/))) { add("law", { val: +m[1], req: (m[2] || "").trim() }); continue; }
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
    for (const b of aiDropped) {
      const cap = inc.capIndex[b.chain + ":" + b.level];
      if (!cap) continue;
      for (const x of cap.taxable) if (gv.evalReq(x.req, ctx)) { tax[cat(x.req)] += x.val; if (explain) explain.push({ chain: b.chain + ":" + b.level, val: x.val, req: x.req }); }
      for (const x of cap.trade) if (gv.evalReq(x.req, ctx)) trade[cat(x.req)] += x.val;
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
    const portLevel = (() => { for (const h of (region.hidden || [])) { const m = String(h).match(/^base_port_level(\d+)?/); if (m) return m[1] ? +m[1] : 1; } return buildings.has("port_buildings") ? buildings.get("port_buildings") + 1 : 0; })();
    const roadLevel = buildings.has("hinterland_roads") ? buildings.get("hinterland_roads") + 1 : 0;
    out.push({
      region: s.region, settlement: region.settlement, pop: s.pop, level: s.level, capital: !!s.capital,
      taxablePct, tradePct, taxPctParts: tax, tradePctParts: trade, tradeLvlSum, mineSum, fleetSum, farmLevel, farmLevelSum, farmN: region.farmN || 0,
      wallLevel, healthPips, lawBonus, lawWalls, lawTerrain,
      resources: resList, portLevel, roadLevel,
      buildings: s.buildings.map(b => b.chain + ":" + b.level),
      ...(explain ? { taxableLines: explain } : {}),
    });
  }
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
    if (/^character,.*named character/i.test(ln)) {
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
  taxBaseK: 0.4683, taxFlatPoint: 4.123,
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
    "Etruria": { "Etruria_Occidentalis": 16, "Sassinia": 7, "Etruria_Orientalis": 22, "Etruria_Meridionalis": 21, "Velzna": 22 },
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
  seaLaneMaxDist: 40, riverBodyMaxCells: 1500, seaFlowRiverMult: 1.95, // river flows run hotter (Nile live 713/605/519) // sea-path tiles; lanes are local (live: Kyrenaica forms NO Aegean lanes; Sena→Nesactium ~15 allowed)
  // strong flow: v = K·pop^exp·e^(pct·tradePct) — refit on 16 current-build flows
  // (full julii 26-scroll corpus + cyrene, 2026-06-11 evening; R²0.82, max ×1.61).
  // The pct coefficient ≈ the historic 0.127 sea exponent; pop is nearly irrelevant.
  seaFlowK: 63, seaFlowPopExp: 0.111, seaFlowPct: 0.133, // river lanes only (Nile fit)
  // OPEN-SEA EXACT (Capua t1 trio 2026-06-11: 426/13, 332/10, 100/3 — also pct-free:
  // Capua pct +6 and Praeneste pct −6 share the same constant)
  seaCargoK: 33,
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
    "Kyrenaike>Taucheira": { ply: 22.1 },
    "Taucheira>Kyrenaike": { ply: 70.0 },
    "Kyrenaike>Euesperidai": { ply: 17.9 },
    "Euesperidai>Barke": { ply: 20.4 },
    "Barke>Euesperidai": { ply: 24.9 },
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

const BRACKET_MULT = { low: 0.8, normal: 1.0, high: 1.2, very_high: 1.5 };

// ---- region adjacency from map_regions.tga (for land-trade partners) ----
const _adjCache = {};
function regionAdjacency(modDataDir) {
  if (_adjCache[modDataDir]) return _adjCache[modDataDir];
  const adj = {};
  try {
    const dg = require("./descrStratGeneral.js");
    const { rgbToRegion } = dg.parseDescrRegions(fs.readFileSync(path.join(modDataDir, "world", "maps", "base", "descr_regions.txt"), "latin1"));
    const buf = fs.readFileSync(path.join(modDataDir, "world", "maps", "base", "map_regions.tga"));
    const W = buf.readUInt16LE(12), H = buf.readUInt16LE(14), desc = buf[17];
    const dataOff = 18 + buf[0];
    const bottomLeft = (desc & 0x20) === 0;
    const key = (col, rowTop) => { const r = bottomLeft ? (H - 1 - rowTop) : rowTop; const o = dataOff + (r * W + col) * 3; return buf[o + 2] + "," + buf[o + 1] + "," + buf[o]; };
    const add = (a, b) => { (adj[a] = adj[a] || new Set()).add(b); (adj[b] = adj[b] || new Set()).add(a); };
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
      roadOfRegion[sd.region] = (sd.buildings || []).some(b => /hinterland_roads/.test(b.chain)) ? 1 : 0;
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
    for (const raw of fs.readFileSync(src, "latin1").split(/\r?\n/)) {
      const t = raw.includes(";") ? raw.slice(0, raw.indexOf(";")) : raw;
      const m = t.match(/^resource\s+(\w+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
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
    const { ownerOfRegion, allies, wars } = tradePartnerCtx(modDataDir);
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
      const rtxt = fs.readFileSync(path.join(modDataDir, "world", "maps", "base", "descr_regions.txt"), "latin1");
      for (const m of rtxt.matchAll(/^(\S+)[^]*?base_port_level_(\d)/gm)) basePort[m[1]] = +m[2];
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
      if (adjA && (adjA.has ? adjA.has(b.region) : adjA.includes(b.region))) continue;
      const sd = seaDist[a.region] && seaDist[a.region].get(b.region);
      if (sd == null) continue; // no sea path
      if (sd > CALIB.seaLaneMaxDist) continue; // lanes are LOCAL (live: no Aegean lanes from Kyrenaica)
      // RIVER LANES (2026-06-11 Nile crack): the Nile is its own small sea body
      // (41,140,235); river ports lane near-all-pairs without consuming sea slots
      // (Sebennytos holds 3 lanes on a level-0 port). Pairs sharing a SMALL body
      // (< riverBodyMaxCells at 4px) lane unconditionally.
      const shared = (bodiesOf[a.region] || []).filter(x => (bodiesOf[b.region] || []).includes(x));
      const river = shared.some(bid => (bodySize[bid] || 1e9) < CALIB.riverBodyMaxCells);
      pairs.push({ a, b, d: sd, river });
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
    for (const sd of (CALIB.seaLaneSeeds || [])) {
      const A = portOf[sd.a], B = portOf[sd.b];
      if (!A || !B) continue;
      seeded.add(sd.a); seeded.add(sd.b);
      const d = (seaDist[sd.a] && seaDist[sd.a].get(sd.b)) != null ? seaDist[sd.a].get(sd.b) : 24;
      // impLive: this side's import row (partner flow ÷5) observed live at t1
      // (seeded lanes carry the corpus truth; default true — see seaLaneSeeds note)
      (out[sd.a] = out[sd.a] || []).push({ to: sd.b, weak: !sd.exA, inWeak: !sd.exB, impLive: sd.impA !== false, toPop: B.pop, toPort: B.basePort, ownPop: A.pop, ownPort: A.basePort, d, seeded: true });
      (out[sd.b] = out[sd.b] || []).push({ to: sd.a, weak: !sd.exB, inWeak: !sd.exA, impLive: sd.impB !== false, toPop: A.pop, toPort: A.basePort, ownPop: B.pop, ownPort: B.basePort, d, seeded: true });
    }
    const used = {}; const slots = {};
    for (const p of ports) { slots[p.region] = 1 + p.level; used[p.region] = 0; }
    for (const pr of pairs) {
      const A = pr.a.region, B = pr.b.region;
      if (pr.river) {
        (out[A] = out[A] || []).push({ to: B, weak: false, inWeak: false, toPop: pr.b.pop, toPort: pr.b.basePort, ownPop: pr.a.pop, ownPort: pr.a.basePort, river: true, d: pr.d });
        (out[B] = out[B] || []).push({ to: A, weak: false, inWeak: false, toPop: pr.a.pop, toPort: pr.a.basePort, ownPop: pr.b.pop, ownPort: pr.b.basePort, river: true, d: pr.d });
        continue;
      }
      if (seeded.has(A) || seeded.has(B)) continue; // pinned ports don't re-match
      if (used[A] >= slots[A] || used[B] >= slots[B]) continue;
      used[A]++; used[B]++;
      // PER-SIDE strength: each direction is weak iff THAT side burned its LAST slot
      // (Rome→Volat absent = Rome's last; Volat→Rome weak = Volat's last; Cosa→Praen
      // strong = Cosa's first even though Praeneste's slots were busy elsewhere).
      (out[A] = out[A] || []).push({ to: B, weak: used[A] === slots[A], inWeak: used[B] === slots[B], toPop: pr.b.pop, toPort: pr.b.basePort, ownPop: pr.a.pop, ownPort: pr.a.basePort, d: pr.d });
      (out[B] = out[B] || []).push({ to: A, weak: used[B] === slots[B], inWeak: used[A] === slots[A], toPop: pr.a.pop, toPort: pr.a.basePort, ownPop: pr.b.pop, ownPort: pr.b.basePort, d: pr.d });
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
  if (/^romans?_/.test(facLow)) tradeRightsSet.add("roman_senate");
  if (facLow === "roman_senate") for (const f of ["romans_julii", "romans_brutii", "romans_scipii"]) tradeRightsSet.add(f);
  const tradeQtyVal = tradeQtyValByRegion(modDataDir);
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
  for (const s of F.settlements) {
    if (popOv) { const pv = popOv[s.settlement] != null ? popOv[s.settlement] : popOv[s.region]; if (pv != null && pv > 0) s.pop = pv; }
    const bracket = br[s.settlement] || br[s.region] || "normal";
    const mult = BRACKET_MULT[bracket] || 1;
    const gv0 = govFx[s.settlement] || govFx[s.region] || null;
    const gTax = gv0 ? Math.max(0, 1 + (gv0.tax || 0) / 100) : 1;
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
    const taxPts = s.taxPctParts.base + s.taxPctParts.size + s.taxPctParts.winter;
    // decompose so the UI can evaluate the model at ANY bracket (H calibration):
    // tax(bracket) = max(0, bracketMult × taxW + taxFlat) [pre-H]
    const taxW = (F.settlements.length > 1 ? CALIB.taxBaseK : CALIB.taxLogK_single) * wLog * gTax;
    const taxFlat = (F.settlements.length > 1 ? CALIB.taxFlatPoint * taxPts : CALIB.taxFlatSingle) * gTax;
    const taxH = taxHByCity ? (taxHByCity[_normCity(s.settlement)] != null ? taxHByCity[_normCity(s.settlement)]
      : taxHByCity[_normCity(s.region)]) : null;
    const tTaxNoH = Math.max(0, mult * taxW + taxFlat); // pre-fortune base (corruption uses this)
    const tTax = tTaxNoH * (taxH != null ? taxH : 1);
    // governor Effect Farming = +1 farm level per point for INCOME (confirmed 2026-06-10,
    // gov-farm-income-test.js: 10/11 player factions land at ratio 1.000-1.002 with u=1 —
    // farming income is now exact; the lone seleucid +20% is a separate EDB underparse).
    const tFarm = CALIB.farmPoint * (s.farmN + s.farmLevel + (gv0 ? (gv0.growthFarm || 0) : 0)) * gardensMult;
    const tMine = CALIB.minePoint * s.mineSum * (mineQty[s.region] || 0) * gMine;
    taxes += tTax; farming += tFarm; mining += tMine;
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
    const rvX = tradeQtyVal[s.region] || 0;
    const aX = CALIB.tradeRouteK * Math.pow(Math.max(400, s.pop), CALIB.tradeRoutePopX)
      * Math.exp(CALIB.tradeRoutePct * (s.tradePct || 0))
      * Math.pow(1 + rvX, CALIB.tradeRouteRvX);
    let landTrade = 0;
    const landPins = (CALIB.landLaneRows || {})[s.region];
    if (landPins) {
      // LIVE-PINNED town (see CALIB.landLaneRows): the pin set is the COMPLETE
      // scroll partner list — land trade = Σ pinned rows. Live values already
      // include the vintage's governor Trading, so no extra multipliers.
      for (const n of Object.keys(landPins)) { landTrade += landPins[n]; nPartners++; }
    } else {
      for (const n of (adjacency[s.region] || [])) {
        const own = ownerOfRegion[n];
        if (!isPartner(own)) continue;
        nPartners++;
        const hasRights = own === facLow || tradeRightsSet.has(own);
        landTrade += aX * Math.exp(CALIB.tradeRouteRoad * ((roadOfRegion[n] || 0) + (s.roadLevel || 0)))
          * Math.pow(1 + (tradeQtyVal[n] || 0), CALIB.tradeRouteRvY)
          * Math.pow(Math.max(400, popOfRegion[n] || 400), CALIB.tradeRoutePopY)
          * (hasRights ? 1 : CALIB.tradeNoRights);
      }
      // GOVERNOR TRADING (console-proven, Alexandria GoodTrader probe 2026-06-11):
      // Trading +10% scaled every land row ×1.074 — the trait multiplies the EXPORT
      // component (~74% of a route's row value) and leaves imports unchanged.
      landTrade *= Math.max(0, 1 + 0.74 * ((gv0 && gv0.trading) || 0) / 100);
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
    if (s.portLevel) {
      const lanes = seaLanes[s.region] || [];
      const lanePts = seaFlowPtsByLane(modDataDir);
      const isPly = !(opts && opts.asAI);
      // per-lane f: live-calibrated where measured (see CALIB.seaLaneF), else the
      // open-sea constant 33. 'ply' regime applies when the EXPORTER town belongs
      // to the faction this budget is computed for (as the human player) — the
      // Praeneste→Capua ×0.49 player split, live-confirmed in 2+3 campaigns.
      const flowOf = (X, Y, ply) => {
        const e = (CALIB.seaLaneF || {})[X + ">" + Y];
        if (e && e.fix != null) return e.fix; // live-pinned flow (e.g. slave-island exporters with empty cargo baskets)
        let f0 = CALIB.seaCargoK;
        if (e) {
          const v0 = ply ? (e.ply != null ? e.ply : e.ai) : (e.ai != null ? e.ai : e.ply);
          if (v0 != null) f0 = v0;
        }
        return f0 * (lanePts[X + ">" + Y] || 0);
      };
      for (const ln of lanes) {
        let expV, impV;
        if (ln.river) {
          const rm = CALIB.seaFlowRiverMult;
          expV = rm * CALIB.seaFlowK * Math.pow(Math.max(400, s.pop), CALIB.seaFlowPopExp) * Math.exp(CALIB.seaFlowPct * (s.tradePct || 0));
          impV = rm * CALIB.seaFlowK * Math.pow(Math.max(400, ln.toPop || 1500), CALIB.seaFlowPopExp) / 5;
        } else {
          expV = ln.weak ? 0 : flowOf(s.region, ln.to, isPly);
          const impPly = ownerOfRegion[ln.to] === facLow ? isPly : false;
          // import-row t1 activation: seeded lanes carry the OBSERVED flag
          // (impLive); unseeded lanes keep the nearest-lane heuristic.
          const impDark = ln.impLive != null ? !ln.impLive : !ln.toNearest;
          impV = (ln.inWeak || impDark) ? 0 : flowOf(ln.to, s.region, impPly) / 5;
        }
        seaTrade += expV + impV;
      }
      tradeSeaSum += seaTrade;
    }
    // measured live t1 override for the played faction (see CALIB.tradeMeasuredByPlayer)
    const _measTbl = CALIB.tradeMeasuredByPlayer[facLow];
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
    admin += tAdmin;
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
      // taxParts: pre-H bracket decomposition (tax(b) = max(0, mult_b·w + flat));
      // taxH: the applied per-campaign calibration multiplier (null = uncalibrated)
      taxParts: { w: taxW, flat: taxFlat }, taxH: taxH != null ? taxH : null,
      bracket, taxes: Math.round(tTax), farming: Math.round(tFarm), mining: Math.round(tMine), trade: Math.round(tTrade), admin: Math.round(tAdmin),
      corruption: Math.round(corrAmt),
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
  }
  admin = Math.round(admin);
  const income = Math.round(taxes + farming + mining + trade + admin);
  const army = armyUpkeepEDU(modDataDir, faction);
  const preNet = army ? (income - wages - corruption - army.upkeep) : null;
  // ---- protectorate tribute (50% of client net profit, flows from turn 2) ----
  // Suzerains: + half of each client's modeled net (client at all-Normal brackets —
  // the AI's actual taxes vary, so this is a magnitude, not denarius-exact).
  // Clients: − half of own profit (only when profitable; deficits pay nothing).
  let tributeIn = 0, tributeOut = 0, suzerain = null, clients = null;
  if (!(opts && opts._noTribute)) {
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
      taxes: Math.round(taxes), farming: Math.round(farming), mining: Math.round(mining), trade: Math.round(trade),
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
    accuracy: { taxes: "±9%", farming: "±5%", trade: "±19% (partner-aware refit)", wages: "exact", corruption: "±10%", tribute: "50% of client net (exact rate; client nets modeled at Normal tax)", unmodeled: "'other' income (~1-4% of total)" },
  };
}

module.exports = { empireTier, parseEDBIncome, parseResourceValues, computeIncomeFeatures, countCharacters, computeTurn1Budget, armyUpkeepEDU, parseProtectorates, TRIBUTE_RATE, CALIB, regionAdjacency, tradePartnerCtx, tradeQtyValByRegion, tradeQtyMapsByRegion, tradeGoodsByRegion, seaLanesByRegion, seaFlowPtsByLane };
