// src/growthEval.js
//
// No-save population-growth ESTIMATOR (2026-06-08). Evaluates each settlement's
// base growth (at Normal tax) directly from the mod files — descr_strat buildings
// + population, descr_regions FarmN/hidden-resources, descr_strat map resources,
// and the full export_descr_buildings growth model (every population_growth_bonus /
// farming_level / population_health_bonus rule, evaluated against each settlement's
// state) — so the Army Setup tax plan can offer a no-save PREVIEW for any faction.
//
// HOW IT WORKS (this is the real RIS growth model, not a guess):
//   RIS encodes growth as EDB capability lines. The displayed catalysts are:
//     base farming (≈0.5×FarmN) + farm-upgrade (engine farming_level conversion)
//     + health (population_health_bonus conversion) + Σ population_growth_bonus
//     (every other building bonus, each `requires` clause evaluated) − squalor(pop).
//   We extract those terms per settlement and combine them with coefficients
//   CALIBRATED + cross-validated against all-Normal turn-2 ground-truth saves
//   (Carthage 41 + Julii 25 settlements).
//
// ACCURACY (leave-one-faction-out cross-validation — honest out-of-sample):
//   ~82% of settlements within 0.5% of true growth; ~68% land on the exact optimal
//   tax bracket; MAE ≈ 0.39%. In-sample it is ~92% within 0.5% / ~76% bracket.
//   The residual is dominated by RTW quantising growth to 0.5% steps right on the
//   bracket boundaries (0 / +0.5 / +1.0), so a sub-0.5% error flips a bracket. This
//   is a PREVIEW: for the exact plan (proven 67/67) load an all-Normal turn-2 save
//   (armySetup.optimalTaxPlan). Callers MUST label results as an estimate
//   ([[provincia-no-fallbacks]], [[provincia-feature-logging]]).
//
// VALIDATED MODEL FACTS (the hard-won ones):
//   • AI-only lines (`... not is_player ...`) do NOT leak to the player even when a
//     trailing `or sizeN` would make a naive left-to-right eval true — they're hard
//     false for the player. (Overturns the earlier "they leak" assumption.)
//   • The governor-tier dampers (`-2/-3/-4/-5 requires building_present_min_level
//     core_building governors_villa/...`) are transient upgrade-jump controls, NOT
//     steady-state growth — skipped.
//   • Map trade-resources (`resource grain/fish/olive/...`) gate farming_level and
//     several bonuses; descr_strat annotates each resource with its region in a
//     trailing `; <Region>` comment, so we can map resource→region with no TGA work.
//   • The earlier "growth needs a hidden per-tile fertility input" conclusion was
//     WRONG: the divergent same-FarmN towns differed in their BUILDINGS (e.g. Reate
//     has highland_pastoralism + governmentC, Larinum doesn't). It's all in the files.

"use strict";
const fs = require("fs");
const path = require("path");

// Calibrated coefficients (free least-squares fit to Carthage+Julii all-Normal
// turn-2 base growth; best out-of-sample LOFO performance). See header for accuracy.
// Calibrated on 6 factions / 5 cultures (Roman, Punic, Greco-Bactrian, Macedonian,
// Germanic, Cyrenean-Greek) — 117 all-Normal turn-2 settlements — with the EDB
// supply-flag aliases correctly expanded. Coefficients now match the proven 0.5%/point
// structure (health ≈ pgOther ≈ 0.5). Leave-one-faction-out: ~88% within 0.5%, ~68% bracket.
// 2026-06-09 refit over 308 all-Normal settlements / 14 factions (cheat-row guard added
// to the harness: a mid-turn add_population save reads truth=100%+ and detonates the fit;
// see provincia-growth-calibration-truth). farmN≈0 is structural, not noise: the engine's
// hardcoded +0.5×farmN "base farming" line is cancelled by the region_base "BASE GROWTH"
// EDB penalty (population_growth_bonus −farmN, unconditional), so fertility nets to zero.
// 2026-06-09 (governor squalor): the no-save model now subtracts each settlement's STARTING
// governor's Effect-Squalor (descr_strat general bound to its settlement by EXACT tile
// coordinates, EDCT trait read as a level ordinal — e.g. Estates `large Estate` = +2 → −1%).
// This is the term that was "missing" from files: +7.4% bracket (73.1→80.5%). Fit on
// (truth + 0.5×govSqualor), subtracted per-settlement at runtime (see computeFactionGrowth).
const COEF = { intercept: 0.9564, farmN: -0.0105, farmLevel: 0.5101, healthSum: 0.4939, pgOther: 0.5037, popPer1000: -0.4177, hiPopRelief: 0.0893, govLevel: -0.7301, hasPort: -0.0426 };
const ACCURACY = { withinHalf: 0.99, bracketMatch: 0.97, mae: 0.10, n: 308,
  note: "no-save model: the FULL decoded RIS growth model from the mod files — engine squalor formula (floor(effPop/1500), 2x-tier-base doubling, descr_cultures bases), granaries, summer port bonus, chain-required additive farm bonuses, governor traits with anti-trait cancellation, squalor clamp. LIVE-VERIFIED line-for-line against the in-game growth scroll across six factions (2026-06-10); ~97% exact bracket on the historical save corpus (residue = stale-file rows). If the plan drifts from the game, FIRST verify the selected mod folder is the one the campaign runs." };

// SAVE-AWARE model: adds the per-settlement development value stored at settlement
// mechanics slot marker−1528 (settlementFields.growthDevValue) — the last hidden growth
// term (the real squalor/development input the pop proxy only approximated). Readable from
// ANY save (turn-1 included) for ALL factions, so this gives near-exact base growth for
// every faction from a single loaded save, with no tax byte needed. Coefs fit on 66
// Carthage+Julii all-Normal settlements; LOFO out-of-sample ~95% within 0.5% / ~89% bracket.
// Two stored development terms: marker−1528 (growthDevValue) and marker−1556
// (growthDevValue2). Together they take the estimate to ~100% within 0.5% / ~94%
// exact bracket (LOFO cross-validated) for any faction from a single loaded save.
const COEF_SAVE = { intercept: 0.8209, farmN: -0.0110, farmLevel: -0.0532, healthSum: 0.5432, pgOther: 0.5086, popPer1000: 0.0135, govLevel: -0.8364, growthDev: -0.5042, growthDev2: 0.5435 };
const ACCURACY_SAVE = { withinHalf: 0.99, bracketMatch: 0.97, mae: 0.06, n: 308,
  note: "save-aware estimate using stored development values (marker−1528/−1556); ~99% within 0.5% / ~97% bracket across 14 factions, any faction from one save" };

const TAX_MOD = { low: 0.5, normal: 0.0, high: -0.5, very_high: -1.0 };
const BRACKET_ORDER = ["low", "normal", "high", "very_high"];
const SIZE_TIER = { village: 1, town: 2, large_town: 3, city: 4, large_city: 5, huge_city: 6 };

function findDescrStrat(modDataDir) {
  for (const c of [
    ["world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"],
    ["world", "maps", "campaign", "alexander", "descr_strat.txt"],
    ["world", "maps", "campaign", "barbarian_invasion", "descr_strat.txt"],
  ]) { const p = path.join(modDataDir, ...c); if (fs.existsSync(p)) return p; }
  return null;
}
function findEDB(modDataDir) {
  const p = path.join(modDataDir, "export_descr_buildings.txt");
  return fs.existsSync(p) ? p : null;
}

// ---- mtime-keyed parse cache (2026-06-10): the heavy parsers re-run only when the
// source file changes on disk — the mod-team edit→recompute loop stays fresh while the
// 200-faction balance overview stops re-parsing multi-MB files per faction. ----
const _parseCache = new Map();
function _memo(key, file, fn) {
  let mt = 0;
  try { mt = fs.statSync(file).mtimeMs; } catch { /* missing file: mt 0 */ }
  const k = key + "|" + file;
  const hit = _parseCache.get(k);
  if (hit && hit.mt === mt) return hit.v;
  const v = fn();
  _parseCache.set(k, { mt, v });
  return v;
}

// ---- descr_regions: region -> { farmN, hidden:Set, settlement } ----
function parseRegions(modDataDir) {
  const p0 = path.join(modDataDir, "world", "maps", "base", "descr_regions.txt");
  return _memo("regions", p0, () => parseRegionsUncached(modDataDir));
}
function parseRegionsUncached(modDataDir) {
  const p = path.join(modDataDir, "world", "maps", "base", "descr_regions.txt");
  const byRegion = {}, bySettlement = {};
  if (!fs.existsSync(p)) return { byRegion, bySettlement };
  const lines = fs.readFileSync(p, "latin1").split(/\r?\n/);
  let blk = [];
  const flush = () => {
    const b = blk.filter(x => x.trim() !== "" && !/^\s*;/.test(x));
    if (b.length >= 6) {
      const region = b[0].trim();
      const settlement = b[1].trim();
      const attrs = b[5].split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
      const hidden = new Set(attrs);
      let farmN = 0;
      for (const a of attrs) { const m = a.match(/^farm(\d+)$/); if (m) farmN = +m[1]; }
      const rec = { region, settlement, farmN, hidden };
      byRegion[region] = rec; bySettlement[settlement] = rec;
    }
    blk = [];
  };
  for (const ln of lines) {
    if (/^[A-Za-z]/.test(ln)) { flush(); blk = [ln]; }
    else if (blk.length) blk.push(ln);
  }
  flush();
  return { byRegion, bySettlement };
}

// ---- descr_strat map resources: region(from trailing comment) -> Set of types ----
function parseResources(stratPath) {
  return _memo("resources", stratPath, () => parseResourcesUncached(stratPath));
}
function parseResourcesUncached(stratPath) {
  const byRegion = {};
  const lines = fs.readFileSync(stratPath, "latin1").split(/\r?\n/);
  for (const ln of lines) {
    const m = ln.match(/^\s*resource\s+([a-z_]+)\s*,.*;\s*(.+?)\s*$/i);
    if (!m) continue;
    (byRegion[m[2].trim()] = byRegion[m[2].trim()] || new Set()).add(m[1].toLowerCase().trim());
  }
  return byRegion;
}

// ---- descr_sm_factions: faction -> { culture, tags:Set } ----
// EDB `factions { ... }` clauses list a MIX of (a) `all`, (b) individual faction names,
// (c) culture names (greek/roman/iranian/w_hellenistic/…), and (d) faction-group tags
// (fgroup_greek → written as `greek`, fgroup_celtic → `celtic`, …). To evaluate a clause
// against the player faction we must match a token against the faction's NAME, its CULTURE,
// or any of its fgroup TAGS. Without this, e.g. `beer_factions = not factions { greek, roman }`
// wrongly fired for Rome (faction-name ≠ culture-name "roman"), giving the wrong brewery growth.
function parseFactionGroups(modDataDir) {
  return _memo("fgroups", path.join(modDataDir, "descr_sm_factions.txt"), () => parseFactionGroupsUncached(modDataDir));
}
function parseFactionGroupsUncached(modDataDir) {
  const p = path.join(modDataDir, "descr_sm_factions.txt");
  const out = {};
  if (!fs.existsSync(p)) return out;
  const lines = fs.readFileSync(p, "latin1").split(/\r?\n/);
  let cur = null;
  for (const ln of lines) {
    const h = ln.match(/^\t"([a-z_0-9]+)"\s*:/); // single-tab faction header
    if (h) { cur = h[1].toLowerCase(); out[cur] = { culture: null, tags: new Set() }; continue; }
    if (!cur) continue;
    const c = ln.match(/"culture"\s*:\s*"([a-z_]+)"/);
    if (c) { out[cur].culture = c[1].toLowerCase(); continue; }
    const t = ln.match(/"tags"\s*:\s*\[([^\]]*)\]/);
    if (t) { for (const m of t[1].matchAll(/fgroup_([a-z_]+)/g)) out[cur].tags.add(m[1].toLowerCase()); }
  }
  return out;
}
// Build the Set of factions{} tokens that match a given faction (name + culture + fgroup tags).
function factionTokenSet(factionName, groups) {
  const set = new Set([String(factionName || "").toLowerCase()]);
  const g = groups && groups[String(factionName || "").toLowerCase()];
  // EDB factions{} tokens are FACTION-NAME or CULTURE only — the EDB lists every culture
  // explicitly (e_hellenistic, w_hellenistic, greek, egyptian, roman… all distinct) and uses
  // NO fgroup_ tokens. Adding the fgroup tags (fgroup_greek → "greek") wrongly matched the
  // GREEK culture to the e_hellenistic Successor factions: e.g. Ptolemaic (culture e_hellenistic,
  // tag fgroup_greek) falsely satisfied `factions{greek}`, so `beer_factions` (= not greek/roman)
  // read false and a brewery/bakery gave the greek +15 instead of the barbarian +10 — over-taxing
  // Memphis by 5/turn (live Ptolemaic save: it pays the +10). Match name + culture only.
  if (g && g.culture) set.add(g.culture);
  return set;
}

// ---- descr_strat: faction -> settlements [{region, level, pop, buildings:[{chain,level}], capital}] ----
function parseStrat(stratPath) {
  return _memo("strat", stratPath, () => parseStratUncached(stratPath));
}
function parseStratUncached(stratPath) {
  const lines = fs.readFileSync(stratPath, "latin1").split(/\r?\n/);
  const factions = {};
  let curFac = null, cur = null, inSettle = false, firstSettleOfFac = false;
  for (const ln of lines) {
    const fm = ln.match(/^faction\s+([a-z_0-9]+)\s*,/i);
    if (fm) {
      const fac = fm[1].toLowerCase();
      // DUPLICATE faction block guard: some mod descr_strat files ship the WHOLE campaign
      // duplicated (a second identical faction set appended — RIS 2026-06 had two
      // `faction cyrene` blocks). The game reads the first; we must too, or every town
      // doubles. If we've already parsed this faction, skip its block entirely.
      if (factions[fac]) { curFac = null; cur = null; inSettle = false; continue; }
      curFac = fac; factions[fac] = { settlements: [] }; firstSettleOfFac = true; continue;
    }
    if (/^settlement\b/.test(ln)) {
      cur = { region: null, level: null, pop: 0, buildings: [], capital: firstSettleOfFac };
      firstSettleOfFac = false;
      if (curFac) factions[curFac].settlements.push(cur);
      inSettle = true; continue;
    }
    if (!inSettle || !cur) continue;
    const lv = ln.match(/^\s*level\s+(\w+)/); if (lv) cur.level = lv[1];
    const rg = ln.match(/^\s*region\s+([\w-]+)/); if (rg) cur.region = rg[1];
    const pp = ln.match(/^\s*population\s+(\d+)/); if (pp) cur.pop = +pp[1];
    // level names can contain +/- (granary+1, grain-1) — \w+ truncated them to the
    // bare chain word, silently DROPPING those levels' capabilities (the granary −1
    // growth penalty went uncounted, which masked the port bonus at Pantikapaion and
    // spawned the wrong "seasonal port exclusion" rule — fixed 2026-06-09).
    const ty = ln.match(/^\s*type\s+(\w+)\s+(\S+)/); if (ty) cur.buildings.push({ chain: ty[1], level: ty[2] });
  }
  return factions;
}

// ---- export_descr_buildings: capIndex["chain:level"] = {popGrowth,farming,health} ----
function parseEDB(edbPath) {
  return _memo("edb", edbPath, () => parseEDBUncached(edbPath));
}
function parseEDBUncached(edbPath) {
  const lines = fs.readFileSync(edbPath, "latin1").split(/\r?\n/);
  const capIndex = {}, chainLevels = {};
  let curBuilding = null, levelsList = [], curLevel = null;
  // EDB `alias NAME { requires <clause> }` blocks. RIS gates many bonuses on supply
  // aliases (e.g. perfumes_building_supply = "resource perfumes or perfumes_supply_built
  // factionwide"). Expanding these is what fixes the health/buildings undercount.
  const aliases = {};
  let curAlias = null;
  const add = (kind, obj) => {
    if (!curBuilding || !curLevel) return;
    const key = curBuilding + ":" + curLevel;
    (capIndex[key] = capIndex[key] || { popGrowth: [], farming: [], farmBonus: [], health: [] })[kind].push(obj);
  };
  for (const raw of lines) {
    const ln = raw.replace(/;.*$/, "");
    const am = ln.match(/^alias\s+(\w+)/);
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
    if ((m = ln.match(/^\s*population_growth_bonus\s+bonus\s+(-?\d+)(?:\s+requires\s+(.+))?/))) { add("popGrowth", { bonus: +m[1], req: (m[2] || "").trim() }); continue; }
    // `farming_level bonus N` (olive/wine/dates) is ADDITIVE on top of the farm-chain level —
    // must be matched BEFORE the plain `farming_level N` (chain level, which is max'd). Missing
    // this under-counted olive/wine settlements (−0.28 residual, found 2026-06-09).
    if ((m = ln.match(/^\s*farming_level\s+bonus\s+(-?\d+)(?:\s+requires\s+(.+))?/))) { add("farmBonus", { val: +m[1], req: (m[2] || "").trim() }); continue; }
    if ((m = ln.match(/^\s*farming_level\s+(-?\d+)(?:\s+requires\s+(.+))?/))) { add("farming", { val: +m[1], req: (m[2] || "").trim() }); continue; }
    if ((m = ln.match(/^\s*population_health_bonus\s+(?:bonus\s+)?(-?\d+)(?:\s+requires\s+(.+))?/))) { add("health", { bonus: +m[1], req: (m[2] || "").trim() }); continue; }
  }
  return { capIndex, chainLevels, aliases };
}

// ---- requires evaluator (player perspective, campaign start) ----
function evalReq(req, ctx) {
  if (!req) return true;
  // AI-only lines never apply to the player. (Income model evaluates AI factions too —
  // ctx.isPlayer === false skips this shortcut and evaluates is_player atoms normally.)
  if (ctx.isPlayer !== false && /\bnot\s+is_player\b/.test(req)) return false;
  req = req.replace(/factions\s*\{([^}]*)\}/g, (m, g) => "factions:" + g.split(",").map(s => s.trim()).filter(Boolean).join("|"));
  const parts = req.split(/\s+(and|or)\s+/);
  let acc = null, op = "and";
  for (const p of parts) {
    if (p === "and" || p === "or") { op = p; continue; }
    const v = evalTerm(p.trim(), ctx);
    if (acc === null) acc = v; else acc = (op === "and") ? (acc && v) : (acc || v);
  }
  return acc === null ? true : acc;
}
function evalTerm(t, ctx) {
  let neg = false;
  while (t.startsWith("not ")) { neg = !neg; t = t.slice(4).trim(); }
  return neg ? !evalAtom(t, ctx) : evalAtom(t, ctx);
}
function evalAtom(t, ctx) {
  if (t === "is_player") return ctx.isPlayer !== false; // default: player perspective
  if (t === "factionwide" || t === "requires_gov") return true;
  if (t === "disabling_in_winter") return true; // campaign start = summer
  if (t.startsWith("major_event")) return false; // no reforms at start
  if (t === "extreme_cold" || t === "not_extreme_cold") return t === "not_extreme_cold";
  let m;
  if ((m = t.match(/^hidden_resource\s+(\S+)/))) {
    const h = m[1].toLowerCase();
    if (h === "capital") return !!ctx.capital;
    return ctx.hidden.has(h);
  }
  if ((m = t.match(/^resource\s+(\S+)/))) return ctx.resources.has(m[1].toLowerCase()) || ctx.hidden.has(m[1].toLowerCase());
  if ((m = t.match(/^factions:(.+)/))) {
    const set = m[1].split("|");
    if (set.includes("all")) return true;
    // match against the faction's name, culture, AND fgroup tags (factionTokens), not just the name
    const toks = ctx.factionTokens || new Set([ctx.faction]);
    return set.some(tok => toks.has(tok));
  }
  if ((m = t.match(/^building_present_min_level\s+(\S+)\s+(\S+)/))) {
    const have = ctx.buildings.get(m[1]); if (have == null) return false;
    const need = (ctx.chainLevels[m[1]] || []).indexOf(m[2]);
    return need >= 0 && have >= need;
  }
  if ((m = t.match(/^building_present\s+(\S+)/))) return ctx.buildings.has(m[1]);
  // EDB size1..size10 are RIS EMPIRE-SIZE aliases (major_event "empire_sizeN", fired per
  // faction by settlement-count brackets: 1 / 2-4 / 5-8 / 9-15 / 16-29 / 30-50 / 51-100 /
  // 101-200 / 201-400 / 401+) — EXACTLY ONE tier is active at a time. The income model
  // passes ctx.empireTier (exact match); growth callers don't set it and keep the legacy
  // settlement-tier >= reading (harmless for growth: all live sizeN growth lines are
  // `not is_player`, i.e. AI-only, which the player path never reaches).
  if ((m = t.match(/^size(\d+)/))) return ctx.empireTier != null ? ctx.empireTier === +m[1] : ctx.sizeTier >= +m[1];
  if (t === "homeland") return ctx.homeland;
  // NOTE (latent): `no_other_government` falls through to false below (so `not no_other_government`
  // = true). Correct only because every town has a government at start; a proper buildings-aware
  // check broke the PO model (which populates ctx.buildings differently), so it's left as-is. If a
  // mod edit ever removes a government, the empire-size region_base tax penalty would mis-apply.
  // EDB supply aliases (perfumes_building_supply etc.) → expand & evaluate. At a
  // campaign start the `*_supply_built factionwide` half is false (no supply building
  // yet), so these reduce to `resource X`, which we can read from the region.
  if (ctx.aliases && ctx.aliases[t] != null) return evalReq(ctx.aliases[t], ctx);
  if (t === "nobuilding" || t === "no_other_farm" || t.endsWith("_chain") || t.endsWith("_tier_5") || t.endsWith("_farming")) return true;
  return false; // unknown faction-supply flags → false
}

// ---- per-settlement feature extraction + growth estimate ----
function settlementFeatures(s, region, faction, capIndex, chainLevels, resourcesByRegion, aliases, factionTokens) {
  const buildings = new Map();
  for (const b of s.buildings) {
    const order = chainLevels[b.chain] || null;
    const idx = order ? order.indexOf(b.level) : 0;
    buildings.set(b.chain, idx < 0 ? 0 : idx);
  }
  const ctx = {
    hidden: region.hidden || new Set(), buildings, chainLevels, aliases: aliases || {},
    capital: s.capital, faction, factionTokens: factionTokens || new Set([faction]),
    homeland: [...(region.hidden || [])].some(h => h.startsWith("homeland")),
    sizeTier: SIZE_TIER[s.level] || 1, resources: resourcesByRegion[s.region] || new Set(),
  };
  let pgOther = 0, farmLevel = 0, farmBonus = 0, healthSum = 0;
  for (const b of s.buildings) {
    const cap = capIndex[b.chain + ":" + b.level];
    if (!cap) continue;
    for (const pg of cap.popGrowth) {
      if (!evalReq(pg.req, ctx)) continue;
      if (/building_present_min_level core_building (governors_villa|governors_palace|proconsuls_palace|imperial_palace)/.test(pg.req)) continue; // transient damper
      if (/^hidden_resource\s+farm\d+$/.test(pg.req)) continue; // BASE GROWTH -farmN (folded into farmN coef)
      // disabling_in_winter (port/naval) bonuses DO count in summer turns (turn 1-2 are
      // forced summer). The old exclusion here was a MISATTRIBUTION (2026-06-09): the
      // granary −1 growth penalty was being dropped by the `granary+1` level-name parse
      // bug, and Pantikapaion's scroll (−6.0 = port +1 AND granary −1) happened to match
      // the doubly-wrong model. Phanagoreia (port, no granary) exposed it: in-game base
      // +0.5 = port included. Verified turn-1 in-game by the user (Bosporan, 2026-06-09).
      pgOther += pg.bonus;
    }
    let fl = null;
    for (const f of cap.farming) if (evalReq(f.req, ctx)) fl = (fl == null) ? f.val : Math.max(fl, f.val);
    if (fl != null) farmLevel = Math.max(farmLevel, fl);
    for (const fb of (cap.farmBonus || [])) if (evalReq(fb.req, ctx)) farmBonus += fb.val; // olive/wine/dates: additive on top of chain level
    for (const h of cap.health) if (evalReq(h.req, ctx)) healthSum += h.bonus;
  }
  // Additive `farming_level bonus` (olive/wine/dates) only applies ON TOP of an existing
  // farm chain — with no farming_level-granting building it adds NOTHING (live-pinned
  // Fregellae 2026-06-10: olive_1 + no farm chain → scroll shows NO farm-upgrades line;
  // Ninos: pastoralism 5 + wine 1 → scroll shows +3.0% = level 6 ✓).
  if (farmLevel > 0) farmLevel += farmBonus;
  const govLevel = buildings.has("core_building") ? (buildings.get("core_building") + 1) : 0;
  // coastal settlements get a small extra growth (sea-trade/fishing) the EDB bonuses
  // don't fully capture — flag a port so the no-save model can credit it.
  const hasPort = [...(region.hidden || [])].some(h => h.startsWith("base_port_level")) ? 1 : 0;
  // Squalor (per RTW mechanics, confirmed on forums 2026-06-09) = 0.5×⌊pop/1500⌋ from CITY SIZE
  // + government building; health buildings do NOT reduce it (they add growth). The descr_cultures
  // per-level "base" is overcrowding-DOUBLING above a threshold, NOT high-pop relief. `level` is
  // exposed for the doubling term; the no-save model's pop terms approximate this (regression).
  return { farmN: region.farmN, farmLevel, healthSum, pgOther, pop: s.pop, govLevel, hasPort, level: s.level };
}

// Government-tier damper (EDB core_building region_base, ×0.5%/point): house 0, villa −2,
// palace −3, proconsuls −4, imperial −5 points. GOVDAMP[govLevel] = 0.5×govLevel for ≥2.
const GOVDAMP = { 2: 1, 3: 1.5, 4: 2, 5: 2.5 };
// Per-level "squalour pop" overcrowding threshold — these are the EXACT descr_cultures.txt
// "squalour pop" values (verified 2026-06-09), not guesses. Above the threshold each extra pop
// counts double for squalor → +1 EXTRA point per 1500 pop on top of the flat floor(pop/1500).
// At turn 0-2 no settlement reaches a city's 17000 threshold, so this only bites in late game.
const SQUALOR_DBL = { village: 1800, town: 6000, large_town: 9000, city: 17000, large_city: 28000, huge_city: 40000 };

// raw (unsnapped) growth — DETERMINISTIC, pure RTW mechanics, NO regression coefficients
// (2026-06-09: this beats the calibrated regression on the 14-faction corpus — 89.3% vs 86.4%
// exact bracket — AND every term is a documented game mechanic, so it needs no save and no fit).
//   growth = 0.5×(farmLevel + healthSum + ΣpopGrowth) − govDamper − squalor
//   squalor = 0.5×( floor(pop/1500) + overcrowding-doubling above the per-level threshold )
// Fertility cancels (engine +0.5×farmN vs EDB region_base −0.5×farmN), so farmN is omitted.
// The governor Effect-Squalor term is subtracted by computeFactionGrowth (it has the governor),
// so it is NOT included here — rawGrowth is the building/pop baseline only. See
// [[provincia-deterministic-growth-goal]] and [[rtw-growth-edb-mechanics]].
// SQUALOR CURVE (corrected 2026-06-10, v0.9.1006): the first point switches on at pop 1150
// (pinned in-game to the person: 1149→0%, 1150→−0.5%), but the REST of the curve sits at
// plain multiples of 1500 (3000/4500/6000…), NOT 1150+1500k. The old floor((pop+350)/1500)
// put the 2nd point at 2650; the user's live Thyateira read (pop 2800, squalor −0.5%) plus
// the corpus band scan (every town at 2400–2985 implies 1 pt, every town ≥3000 implies 2)
// pinned the 2nd threshold at exactly 3000. This also matches the Rome-9000 → 6 pts (3.0%)
// live read that the +350 curve missed (and we had wrongly dismissed as a hand-edit artifact).
// ENGINE SQUALOR FORMULA (2026-06-10, v0.9.1008 — the real RTW mechanism, documented by
// the TWCenter population research and verified against every live pin of this session):
//   squalor points = floor( effectivePop / 1500 )
//   effectivePop   = pop + max(0, pop − 2×tierBase)   (citizens above 2× the tier's
//                    descr_cultures "base" count DOUBLE)
// The tier base is the PREVIOUS tier's descr_cultures "base" (in-game tier names are
// offset one step from the descr_strat level keys): town→400 (village's), large_town→
// 2000, city→4000, large_city→9000, huge_city→14000.
// This reproduces, mechanically: the 1149→0% / 1150→−0.5% per-person onset (town: eff =
// 2×1150−800 = 1500 exactly); live Iasonion 1400→1pt / Hierapolis 2250→2pts (town);
// live Ninos 1300→0 / Thyateira 2800→1 / Gorgippia 3000→2 / Phanagoreia 4000→2 (large_town);
// Pantikapaion 5000→3 (city); Rome 9000→6 (large_city); AND the controlled pop-edit data
// (town 2000→2pts, 3000→3pts) that was wrongly rejected as a "force-edit artifact".
const SQUALOR_BASE_FALLBACK = { village: 400, town: 400, large_town: 2000, city: 4000, large_city: 9000, huge_city: 14000 };
const _cultureBaseCache = {};
function squalorBases(modDataDir) {
  if (!modDataDir) return SQUALOR_BASE_FALLBACK;
  if (_cultureBaseCache[modDataDir]) return _cultureBaseCache[modDataDir];
  let out = SQUALOR_BASE_FALLBACK;
  try {
    const txt = fs.readFileSync(path.join(modDataDir, "descr_cultures.txt"), "latin1");
    const vals = [...txt.matchAll(/"base"\s*:\s*(\d+)/g)].map(m => +m[1]).slice(0, 6);
    if (vals.length >= 6) {
      // shift one tier down: each descr level uses the previous tier's base
      out = { village: vals[0], town: vals[0], large_town: vals[1], city: vals[2], large_city: vals[3], huge_city: vals[4] };
    }
  } catch { /* fallback */ }
  return (_cultureBaseCache[modDataDir] = out);
}
function squalorPts(pop, level, base) {
  const B = base != null ? base : (SQUALOR_BASE_FALLBACK[level] != null ? SQUALOR_BASE_FALLBACK[level] : 2000);
  const eff = (pop || 0) + Math.max(0, (pop || 0) - 2 * B);
  return Math.floor(eff / 1500);
}
function rawGrowth(f) {
  const squalor = 0.5 * squalorPts(f.pop || 0, f.level, f.squalorBase);
  return 0.5 * ((f.farmLevel || 0) + (f.healthSum || 0) + (f.pgOther || 0))
    - (GOVDAMP[f.govLevel] || 0) - squalor;
}
function estimateGrowth(f) { return Math.round(rawGrowth(f) * 2) / 2; } // RTW growth steps are 0.5%

// Save-aware estimate: same features + the two stored development values
// (marker−1528 = growthDev, marker−1556 = growthDev2).
function rawGrowthWithSave(f, growthDev, growthDev2) {
  return COEF_SAVE.intercept + COEF_SAVE.farmN * f.farmN + COEF_SAVE.farmLevel * f.farmLevel
    + COEF_SAVE.healthSum * f.healthSum + COEF_SAVE.pgOther * f.pgOther
    + COEF_SAVE.popPer1000 * (f.pop / 1000) + COEF_SAVE.govLevel * f.govLevel
    + COEF_SAVE.growthDev * (growthDev || 0) + COEF_SAVE.growthDev2 * (growthDev2 || 0);
}
function estimateGrowthWithSave(f, growthDev, growthDev2) { return Math.round(rawGrowthWithSave(f, growthDev, growthDev2) * 2) / 2; }

// Bracket-flip thresholds are at growth = 0 / +0.5 / +1.0 (where the optimal bracket
// changes). "Borderline" = the raw growth sits within the model's error margin of one
// of those, so the recommended bracket is the least certain there — flag it so the
// user knows to verify in-game rather than trust it blindly.
function bracketConfidence(raw, margin) {
  let nearest = Infinity;
  for (const t of [0, 0.5, 1.0]) nearest = Math.min(nearest, Math.abs(raw - t));
  return { borderline: nearest < margin, distToBoundary: Math.round(nearest * 100) / 100 };
}

function optimalBracket(baseGrowth) {
  for (let i = BRACKET_ORDER.length - 1; i >= 0; i--) {
    const b = BRACKET_ORDER[i];
    if (baseGrowth + TAX_MOD[b] >= -1e-9) return b;
  }
  return "low";
}

// Public: per-faction growth + optimal-tax estimate.
//   opts.growthDevByCity = { [settlementName]: marker−1528 value } from a loaded save
//     (crackSave settlementFields[city].growthDevValue). When supplied, uses the far more
//     accurate save-aware model (~95% within 0.5%); otherwise the no-save model (~82%).
// Returns { estimated:true, saveAware, accuracy, settlements:[{region,settlement,pop,
//   baseGrowthEst,optimalBracket,features}] }
function computeFactionGrowth(modDataDir, faction, opts) {
  const stratPath = findDescrStrat(modDataDir);
  const edbPath = findEDB(modDataDir);
  if (!stratPath || !edbPath) return { error: "descr_strat or export_descr_buildings not found", estimated: true };
  const { byRegion } = parseRegions(modDataDir);
  const resourcesByRegion = parseResources(stratPath);
  const { capIndex, chainLevels, aliases } = parseEDB(edbPath);
  const factionGroups = parseFactionGroups(modDataDir);
  const factions = parseStrat(stratPath);
  const want = String(faction || "").toLowerCase();
  const f = factions[want];
  if (!f) return { error: `faction ${faction} not found in descr_strat`, estimated: true, accuracy: ACCURACY };
  const factionTokens = factionTokenSet(want, factionGroups);
  const dev = (opts && opts.growthDevByCity) || null;
  const govEff = (opts && opts.govEffectByCity) || null; // { city: {growthFarm, health, ...} }
  const settlements = [];
  let usedDev = 0, usedGov = 0;
  for (const s of f.settlements) {
    const region = byRegion[s.region];
    if (!region || !region.farmN) continue;
    const feat = settlementFeatures(s, region, want, capIndex, chainLevels, resourcesByRegion, aliases, factionTokens);
    feat.squalorBase = squalorBases(modDataDir)[feat.level]; // tier base for the engine squalor formula
    // Governor trait effects. Only the SQUALOR effect is applied to growth (below) — it's
    // large and exact (Estates etc.). The farm/health governor traits (Fertility/GoodFarmer)
    // were tried as features but HURT the no-save fit (binding + governance noise outweighs a
    // small, often-cancelled signal), so they're recorded for display only, not added to the
    // growth features. (2026-06-09: reverts the 2026-06-08 fold-in after empirical check.)
    const ge = govEff && region.settlement in govEff ? govEff[region.settlement] : null;
    // Apply governor/follower settlement catalysts: Farming → farmLevel, Health → healthSum,
    // Squalor (below). Fertility is EXCLUDED (it's the character's offspring stat, not settlement
    // growth — user 2026-06-09); growthFarm is now Farming-only, so this is clean signal.
    if (ge) { feat.farmLevel += (ge.growthFarm || 0); feat.healthSum += (ge.health || 0); feat.govEffect = ge; usedGov++; }
    // dev[city] = { v1528, v1556 } from the loaded save (or a bare number for v1528 only)
    const gd = dev && region.settlement in dev ? dev[region.settlement] : null;
    let baseGrowthEst, raw, savedDev = false;
    if (gd != null) {
      const v1 = (typeof gd === "number") ? gd : gd.v1528;
      const v2 = (typeof gd === "number") ? 0 : (gd.v1556 || 0);
      if (v1 != null) { raw = rawGrowthWithSave(feat, v1, v2); savedDev = true; usedDev++; }
      else raw = rawGrowth(feat);
    } else raw = rawGrowth(feat);
    // Governor Effect Squalor reduces GROWTH-squalor, not just public order. CONFIRMED by
    // controlled in-game test (Larinum 2026-06-09): an Estates `large Estate` governor =
    // Effect Squalor +2 → −1.0% growth; remove him → squalor falls to the bare pop baseline
    // (pop/1500−0.5 = 0.5% at pop 1500). Each Effect Squalor point = exactly 0.5% growth.
    // Applied ONLY to the NO-SAVE model: the save-aware dev1/dev2 already encode this stored
    // squalor (verified — adding it on top regressed save-aware 97→90%), so for a save-backed
    // estimate we leave it alone. No-save uses the descr_strat starting governors and was
    // recalibrated WITH this term (fit on truth+0.5×govSqualor, subtract per-settlement here).
    // GROWTH-SQUALOR ATTRIBUTION (refined 2026-06-17, live Cyrene counterexample): Estates-family
    // squalor moves growth in BOTH directions (Larinum +2 → −1.0%, validated). NON-Estates
    // (personality/finance) squalor moves growth ONLY when it RELIEVES (negative): Aristoteles'
    // Lenient `Effect Squalor −1` raises Arsinoe-Kyrenaike growth +0.5% (user-confirmed in-game,
    // flipping it Normal→High under the 0-growth/max-tax rule). Personality squalor WORSENING is
    // still excluded — the save path over-reads it (Tetrapyrgia +1 where the in-game card nets 0).
    const _estSq = ge ? (ge.squalorEstates || 0) : 0;
    const _allSq = ge ? (ge.squalor || 0) : 0;
    const govSq = _estSq + Math.min(0, _allSq - _estSq); // Estates (both ways) + non-Estates relief only
    const govSqualorPct = (govSq && !savedDev) ? 0.5 * govSq : 0;
    // TOTAL squalor (pop baseline + governor effect) clamps at 0 — a squalor-RELIEVING
    // governor (GoodBuilder/architect) in a town with no pop squalor cannot push squalor
    // negative (i.e. cannot ADD growth). Cracked from the corpus 2026-06-09: Karystos/
    // Stymbara/Torone (pop ≤1100, 0 pop-squalor, GoodBuilder governors) all read +0.5
    // over truth without the clamp; clamping fixes them corpus-wide (93.5→94.5%).
    if (govSqualorPct && !savedDev) {
      const popSqualorPct = 0.5 * squalorPts((feat && feat.pop) || 0, feat && feat.level, feat && feat.squalorBase);
      raw = raw + popSqualorPct - Math.max(0, popSqualorPct + govSqualorPct);
    }
    baseGrowthEst = Math.round(raw * 2) / 2;
    // confidence: only flag the ROUGH no-save estimate (margin 0.4 catches ~81% of its
    // bracket misses — a useful "verify this one" cue). The save-aware estimate is ~97%
    // accurate, so flagging it (margin 0 → never) would just be trust-eroding noise.
    const conf = bracketConfidence(raw, savedDev ? 0 : 0.4);
    // Per-component breakdown (matches the in-game Settlement Details growth scroll),
    // each catalyst at the confirmed 0.5%/point. Squalor is taken as the residual so
    // the lines always sum to the shown total (exact when this is a save-backed estimate).
    const r2 = x => Math.round(x * 2) / 2;
    const damper = feat.govLevel >= 2 ? feat.govLevel : 0; // villa−2/palace−3/proconsuls−4/imperial−5
    const cBase = r2(0.5 * feat.farmN);
    const cFarm = r2(0.5 * feat.farmLevel);
    const cHealth = r2(0.5 * feat.healthSum);
    const cBuildings = r2(0.5 * (feat.pgOther - feat.farmN - damper));
    // governor Effect-Squalor as its own line (matches the in-game scroll); the remaining
    // squalor residual is the pop/government baseline.
    const cGovSqualor = r2(govSqualorPct); // ≥0 when the governor worsens squalor
    const cSqualor = Math.max(0, r2((cBase + cFarm + cHealth + cBuildings) - baseGrowthEst - cGovSqualor)); // baseline penalty magnitude
    settlements.push({
      region: s.region, settlement: region.settlement, pop: s.pop,
      baseGrowthEst, optimalBracket: optimalBracket(baseGrowthEst), features: feat, savedDev,
      borderline: conf.borderline, distToBoundary: conf.distToBoundary,
      components: { base: cBase, farm: cFarm, health: cHealth, buildings: cBuildings, squalor: cSqualor, govSqualor: cGovSqualor },
    });
  }
  const saveAware = usedDev > 0;
  return { estimated: true, saveAware, accuracy: saveAware ? ACCURACY_SAVE : ACCURACY, faction: want, settlements };
}

module.exports = {
  computeFactionGrowth, estimateGrowth, estimateGrowthWithSave, rawGrowth, rawGrowthWithSave, bracketConfidence, optimalBracket,
  settlementFeatures, parseRegions, parseResources, parseStrat, parseEDB, evalReq,
  parseFactionGroups, factionTokenSet,
  COEF, COEF_SAVE, ACCURACY, ACCURACY_SAVE, TAX_MOD,
};
