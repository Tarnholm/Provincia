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
    (capIndex[key] = capIndex[key] || { taxable: [], trade: [], tradeLvl: [], mine: [], fleet: [] })[kind].push(obj);
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
    const buildings = new Map();
    for (const b of s.buildings) {
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
    let tradeLvlSum = 0, mineSum = 0, fleetSum = 0;
    const explain = (opts && opts.explain) ? [] : null;
    for (const b of s.buildings) {
      const cap = inc.capIndex[b.chain + ":" + b.level];
      if (!cap) continue;
      for (const x of cap.taxable) if (gv.evalReq(x.req, ctx)) { tax[cat(x.req)] += x.val; if (explain) explain.push({ chain: b.chain + ":" + b.level, val: x.val, req: x.req }); }
      for (const x of cap.trade) if (gv.evalReq(x.req, ctx)) trade[cat(x.req)] += x.val;
      for (const x of cap.tradeLvl) if (gv.evalReq(x.req, ctx)) tradeLvlSum += x.val;
      for (const x of cap.mine) if (gv.evalReq(x.req, ctx)) mineSum += x.val;
      for (const x of cap.fleet) if (gv.evalReq(x.req, ctx)) fleetSum += x.val;
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

// Engine army upkeep (econ slot f12) CRACKED 2026-06-10 (upkeep-crack.js): it is NOT
// the flat EDU sum — per-category scaling, with SHIPS EXCLUDED (naval upkeep lives in
// another slot): f12 ≈ 0.976×ΣEDU(infantry) + 1.186×ΣEDU(cavalry). Player-row fit:
// mean |err| 2.8% (was ±30% flat); worst mauryan −18% (elephant units underweighted —
// single observation, not separable).
const UPKEEP_SCALE = { infantry: 0.9759, cavalry: 1.1857, ship: 0, other: 1.0 };
function armyUpkeepEDU(modDataDir, faction) {
  const stratPath = path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
  if (!fs.existsSync(stratPath)) return null;
  let us;
  try { us = require("./recruitPool.js").parseUnitStats(modDataDir); } catch { return null; }
  const want = String(faction || "").toLowerCase();
  const lines = _stratLines(stratPath);
  let cur = null, inWanted = false, sum = 0, units = 0;
  for (const ln of lines) {
    const m = ln.match(/^faction\s+([a-z_0-9]+)\s*,/i);
    if (m) { cur = m[1].toLowerCase(); inWanted = cur === want; continue; }
    if (!inWanted) continue;
    const u = ln.match(/^unit\s+(.+?)\s+exp\b/);
    if (u) {
      const st = us[u[1].trim().toLowerCase()];
      if (st && st.upkeep != null) {
        const scale = UPKEEP_SCALE[st.category] != null ? UPKEEP_SCALE[st.category] : UPKEEP_SCALE.other;
        sum += st.upkeep * scale;
      }
      units++;
    }
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
  taxLogK_multi: 0.5544, taxLogK_single: 1.0,
  // farming = farmPoint × Σ (region farmN + EDB farming_level incl additive bonuses
  // + governor Effect Farming points). EXACT 2026-06-10: 10/11 player factions at
  // ratio 0.999-1.001 (the uniform 1.001-1.002 residual at 73.5 was the constant —
  // snapped to 73.61). Lone outlier seleucid +20% (EDB irrigation-chain underparse).
  farmPoint: 73.61,
  // MINING CRACKED EXACT 2026-06-10 (mining-crack2.js): per mine town,
  //   mining = 5 × mine_resource(EDB level value: gold 12/20, silver 9/15, other 6/10)
  //              × Σ(quantity × tradeValue) of the region's MINEABLE resources
  // (quantities from the resource_quantity override). 5/6 corpus factions EXACT to the
  // denarius: arverni 600, athens 600, kush 180, seleucid 480, antigonid 900; oretani
  // reads 2× (one border silver tile likely attributed to the wrong region). The old
  // flat minePoint=50 was the arverni coincidence (its qtyVal happened to be 10).
  minePoint: 5,
  // trade = tradeLand×Σ_towns g·rv·(1+landPartners) + tradeSea×Σ_portTowns g·rv·√(seaPartners).
  // g = 1+EDB trade%/100. landPartners = adjacent regions (map_regions pixel adjacency)
  // owned by self/ally (≤199 = ally + trade agreement); seaPartners = self/ally PORT
  // towns sharing a sea body (16 distinct 41,140,X sea zones in map_regions.tga).
  // Refit 2026-06-10 evening (trade-crack6.js, 11 player rows): mean |err| 13.4%
  // (julii 4%, ptolemaic 0%, seleucid 1%, arverni 1%; worst antigonid −24%, suebi tiny).
  tradeLand: 6.23, tradeSea: 10.57,
  // wages = 200×named character + 50×admiral (EXACT on fresh saves).
  wageNamed: 200, wageAdmiral: 50,
  // corruption ("other" expenditure) — REFIT 2026-06-10 (corruption-refit.js), now
  // INCOME-PROPORTIONAL (live-confirmed: julii corr/income identical across tax flips):
  // corruption = corrK × Σ_towns max(0, distToCapital − corrD0) × townIncome(tax+farm+mine).
  // Mean |err| 8.7% (julii −3.8%, seleucid +3.3%, antigonid +4.6%; ptolemaic −19% worst).
  corrK: 5.4656e-3, corrD0: 12,
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
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = key(x, y); const ra = rgbToRegion[k];
      if (x + 1 < W) { const k2 = key(x + 1, y); if (k2 !== k) { const rb = rgbToRegion[k2]; if (ra && rb && ra !== rb) add(ra, rb); } }
      if (y + 1 < H) { const k2 = key(x, y + 1); if (k2 !== k) { const rb = rgbToRegion[k2]; if (ra && rb && ra !== rb) add(ra, rb); } }
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
  const ownerOfRegion = {}, allies = {}, portTowns = [];
  try {
    const stratPath = path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
    const strat = gv.parseStrat(stratPath);
    for (const [fac, f] of Object.entries(strat)) for (const sd of f.settlements) {
      ownerOfRegion[sd.region] = fac;
      if (sd.buildings && sd.buildings.some(b => /port/i.test(b.chain))) portTowns.push({ region: sd.region, fac });
    }
    for (const raw of fs.readFileSync(stratPath, "latin1").split(/\r?\n/)) {
      const t = raw.includes(";") ? raw.slice(0, raw.indexOf(";")) : raw;
      const m = t.match(/^faction_relationships\s+(\w+)\s*,\s*(\d+)\s+(\w+)/);
      if (m && +m[2] <= 199) (allies[m[1].toLowerCase()] = allies[m[1].toLowerCase()] || new Set()).add(m[3].toLowerCase());
    }
  } catch { /* none */ }
  return (_tradeCtxCache[modDataDir] = { ownerOfRegion, allies, portTowns });
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
  const { ownerOfRegion, allies, portTowns } = tradePartnerCtx(modDataDir);
  const facLow = F.faction;
  // Hanging Gardens: +20% farming income factionwide for the owner (validated exact).
  const gardensMult = wonders.gardens && wonders.gardens.owner === facLow ? 1.2 : 1;
  const allySet = allies[facLow] || new Set();
  const isPartner = (other) => other && (other === facLow || allySet.has(other));
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
  let taxes = 0, farming = 0, mining = 0, tradeLandSum = 0, tradeSeaSum = 0, corrSum = 0;
  const sets = [];
  for (const s of F.settlements) {
    const bracket = br[s.settlement] || br[s.region] || "normal";
    const mult = BRACKET_MULT[bracket] || 1;
    const gv0 = govFx[s.settlement] || govFx[s.region] || null;
    const gTax = gv0 ? Math.max(0, 1 + (gv0.tax || 0) / 100) : 1;
    const gTrading = gv0 ? Math.max(0, 1 + (gv0.trading || 0) / 100) : 1;
    const gMine = gv0 ? Math.max(0, 1 + (gv0.mining || 0) / 100) : 1;
    const f = Math.max(0, 1 + (s.taxPctParts.base + s.taxPctParts.winter) / 100);
    const wLog = Math.max(0, 400 * (Math.log(Math.max(400, s.pop)) - 4.4));
    const kTax = F.settlements.length > 1 ? CALIB.taxLogK_multi : CALIB.taxLogK_single;
    const tTax = kTax * wLog * f * mult * gTax;
    // governor Effect Farming = +1 farm level per point for INCOME (confirmed 2026-06-10,
    // gov-farm-income-test.js: 10/11 player factions land at ratio 1.000-1.002 with u=1 —
    // farming income is now exact; the lone seleucid +20% is a separate EDB underparse).
    const tFarm = CALIB.farmPoint * (s.farmN + s.farmLevel + (gv0 ? (gv0.growthFarm || 0) : 0)) * gardensMult;
    const tMine = CALIB.minePoint * s.mineSum * (mineQty[s.region] || 0) * gMine;
    taxes += tTax; farming += tFarm; mining += tMine;
    const rv = s.resources.reduce((a, r) => a + (r.tradeValue || 0), 0);
    const gTrade = Math.max(0, 1 + (s.tradePct || 0) / 100) * gTrading;
    let nPartners = 0;
    for (const n of (adjacency[s.region] || [])) if (isPartner(ownerOfRegion[n])) nPartners++;
    tradeLandSum += gTrade * rv * (1 + nPartners);
    if (s.portLevel) tradeSeaSum += gTrade * rv * Math.sqrt(seaPartnersOf(s.region));
    let dist = null;
    const c = coords[s.region];
    if (cap && c) { dist = Math.hypot(c.x - cap.x, c.y - cap.y); corrSum += Math.max(0, dist - CALIB.corrD0) * (tTax + tFarm + tMine); }
    sets.push({ settlement: s.settlement, region: s.region, pop: s.pop, level: s.level, capital: s.capital,
      bracket, taxes: Math.round(tTax), farming: Math.round(tFarm), mining: Math.round(tMine),
      taxFactor: Math.round(f * 100) / 100, resourceValue: rv, port: !!s.portLevel, tradePartners: nPartners, distToCapital: dist != null ? Math.round(dist) : null,
      govIncome: gv0 && (gv0.tax || gv0.trading || gv0.mining) ? { tax: gv0.tax || 0, trading: gv0.trading || 0, mining: gv0.mining || 0, hits: gv0.hits || [] } : null });
  }
  const trade = Math.max(0, CALIB.tradeLand * tradeLandSum + CALIB.tradeSea * tradeSeaSum);
  const ch = countCharacters(modDataDir, faction) || { named: 0, admiral: 0 };
  const wages = CALIB.wageNamed * ch.named + CALIB.wageAdmiral * ch.admiral;
  const corruption = Math.max(0, Math.round(CALIB.corrK * corrSum));
  const income = Math.round(taxes + farming + mining + trade);
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
        const cb = computeTurn1Budget(modDataDir, c, null, { isPlayer: false, _noTribute: true, govEffectByCity: opts && opts.govEffectByCity });
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
      income, wages, corruption,
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

module.exports = { empireTier, parseEDBIncome, parseResourceValues, computeIncomeFeatures, countCharacters, computeTurn1Budget, armyUpkeepEDU, parseProtectorates, TRIBUTE_RATE, CALIB };
