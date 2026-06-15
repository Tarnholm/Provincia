// src/traitEffects.js
//
// Parse export_descr_character_traits.txt (EDCT) and compute a governor's net
// GROWTH-relevant trait effect. Per the user (2026-06-08): generals' traits DO
// affect settlement growth, so the growth estimate must always account for them.
//
// Growth-relevant trait effects (RTW):
//   Effect Farming  N  → adds N to the settlement's farming level → growth
//   Effect Fertility N → the CHARACTER's personal offspring stat, NOT settlement growth
//                        (user 2026-06-09) — EXCLUDED from the growth model.
//   Effect Health   N  → health catalyst → growth
//   Effect Squalor  N  → growth-squalor: −0.5% growth per point (CONFIRMED Larinum
//                        2026-06-09 by controlled test — removing an Estates `large Estate`
//                        governor dropped squalor by exactly 1.0% = 2 points × 0.5%. The
//                        old "public-order only" belief was WRONG; it reduces growth too.)
// Only Farming/Health/Squalor are SETTLEMENT effects. Farming feeds the growthEval
// `farmLevel` feature; Health feeds `healthSum`; Squalor is applied by growthEval as a
// direct −0.5×N growth penalty. Fertility is excluded (growthFarm = Farming only).
// Coefficients for farm/health are the same ones growthEval already calibrated.
//
// EDCT structure: `Trait <name>` → one or more `Level <l>` blocks, each with a
// `Threshold N` and `Effect <type> v` lines. A character stores the trait as
// name + POINTS; the active level is the highest Threshold ≤ points.

"use strict";
const fs = require("fs");
const path = require("path");

function findEDCT(modDataDir) {
  const p = path.join(modDataDir, "export_descr_character_traits.txt");
  return fs.existsSync(p) ? p : null;
}

// → { ancillaryName: {farm, fert, health, squalor} } from export_descr_ancillaries.txt.
// Governors' FOLLOWERS (ancillaries) carry the same growth effects as traits — a doctor
// (Fertility), architect / City_Planner (Squalor relief), priest (Farming/Health), farming
// advisor, etc. descr_strat seeds them by name on each general (`ancillaries doctor, architect`).
function parseAncillaryEffects(modDataDir) {
  const p = path.join(modDataDir, "export_descr_ancillaries.txt");
  const out = {};
  if (!fs.existsSync(p)) return out;
  const lines = fs.readFileSync(p, "latin1").split(/\r?\n/);
  let cur = null;
  for (const raw of lines) {
    const ln = raw.replace(/;.*$/, "");
    let m;
    if ((m = ln.match(/^Ancillary\s+(\w+)/))) { cur = m[1]; out[cur] = { farm: 0, fert: 0, health: 0, squalor: 0, tax: 0, trading: 0, mining: 0, influence: 0, law: 0, unrest: 0, localPop: 0, mgmt: 0 }; continue; }
    if (!cur) continue;
    if ((m = ln.match(/^\s*Effect\s+(Farming|Fertility|Health|Squalor|TaxCollection|Trading|Mining|Influence|Law|Unrest|LocalPopularity|Management)\s+(-?\d+)/))) {
      const k = { Farming: "farm", Fertility: "fert", Health: "health", Squalor: "squalor", TaxCollection: "tax", Trading: "trading", Mining: "mining", Influence: "influence", Law: "law", Unrest: "unrest", LocalPopularity: "localPop", Management: "mgmt" }[m[1]];
      out[cur][k] += +m[2];
    }
  }
  for (const k of Object.keys(out)) if (!(out[k].farm || out[k].fert || out[k].health || out[k].squalor || out[k].tax || out[k].trading || out[k].mining || out[k].influence || out[k].law || out[k].unrest || out[k].localPop || out[k].mgmt)) delete out[k];
  return out;
}

// → { traitName: [ { threshold, Farming, Fertility, Health, Squalor }, ... ] }  (levels asc by
// threshold), plus traits._anti = { traitName: [antiTraitNames] } for anti-trait cancellation.
// mtime-keyed cache — EDCT is large and this runs once per faction in the balance overview.
const _edctCache = new Map();
function parseTraitEffects(modDataDir) {
  const p0 = findEDCT(modDataDir);
  let mt = 0;
  try { mt = fs.statSync(p0).mtimeMs; } catch { /* missing */ }
  const hit = _edctCache.get(modDataDir);
  if (hit && hit.mt === mt) return hit.v;
  const v = parseTraitEffectsUncached(modDataDir);
  _edctCache.set(modDataDir, { mt, v });
  return v;
}
function parseTraitEffectsUncached(modDataDir) {
  const p = findEDCT(modDataDir);
  const traits = {};
  const anti = {};
  if (!p) return traits;
  const lines = fs.readFileSync(p, "latin1").split(/\r?\n/);
  let cur = null, lvl = null;
  for (const raw of lines) {
    const ln = raw.replace(/;.*$/, "");
    let m;
    if ((m = ln.match(/^Trait\s+(\w+)/))) { cur = m[1]; traits[cur] = []; lvl = null; continue; }
    if (!cur) continue;
    if ((m = ln.match(/^\s*AntiTraits\s+(.+)$/))) { anti[cur] = m[1].split(",").map(s => s.trim()).filter(Boolean); continue; }
    if ((m = ln.match(/^\s*Level\s+(\w+)/))) { lvl = { threshold: 1, Farming: 0, Fertility: 0, Health: 0, Squalor: 0, TaxCollection: 0, Trading: 0, Mining: 0, Influence: 0, Law: 0, Unrest: 0, LocalPopularity: 0, Management: 0 }; traits[cur].push(lvl); continue; }
    if (!lvl) continue;
    if ((m = ln.match(/^\s*Threshold\s+(-?\d+)/))) { lvl.threshold = +m[1]; continue; }
    if ((m = ln.match(/^\s*Effect\s+(Farming|Fertility|Health|Squalor|TaxCollection|Trading|Mining|Influence|Law|Unrest|LocalPopularity|Management)\s+(-?\d+)/))) lvl[m[1]] += +m[2];
  }
  for (const t of Object.keys(traits)) traits[t].sort((a, b) => a.threshold - b.threshold);
  // drop traits with no settlement effect at any level (keep the map small) — but KEEP the
  // anti-trait map complete (a no-effect trait like Feck can still cancel Prim levels)
  for (const t of Object.keys(traits)) if (!traits[t].some(L => L.Farming || L.Fertility || L.Health || L.Squalor || L.TaxCollection || L.Trading || L.Mining || L.Influence || L.Law || L.Unrest || L.LocalPopularity)) delete traits[t];
  Object.defineProperty(traits, "_anti", { value: anti, enumerable: false });
  return traits;
}

// Ubiquitous "baseline" traits whose growth effect is on essentially every general
// (so it's already baked into the calibrated model intercept and must NOT be re-added
// per-governor — doing so double-counts). TurnsAlive/Youth carries Effect Fertility 1,
// i.e. +0.5% growth on every governed town; treat it as baseline, not a deviation.
const BASELINE_TRAITS = new Set(["TurnsAlive"]);

// traitList: [{ name, level(points) }] (from crackSave characters or descr_strat).
// opts.ordinal: the trait number is a 1-based LEVEL INDEX, not accumulated points.
//   descr_strat seeds traits this way — CONFIRMED Larinum 2026-06-09: `Estates 3` is
//   the 3rd level (Large_Estate, Squalor +2), NOT 3 points (which the 1/10/25/35
//   thresholds would resolve to Small_Estate). Save-cracked traits store real points,
//   so they use the default threshold path.
// → { farm, fert, health, squalor, growthFarm, hits }. IMPORTANT (user 2026-06-09): `Effect
// Fertility` is the CHARACTER's personal fertility (chance of offspring), NOT a settlement
// growth catalyst — so it is EXCLUDED from growthFarm. Only `Effect Farming` raises settlement
// farming/growth; Health and Squalor are the other settlement effects. growthFarm = farm only.
function growthEffectOfTraits(traitList, parsed, opts) {
  const ordinal = !!(opts && opts.ordinal);
  let farm = 0, fert = 0, health = 0, squalor = 0, squalorEstates = 0, tax = 0, taxSTRating = 0, trading = 0, mining = 0, influence = 0, law = 0, unrest = 0, localPop = 0, mgmt = 0; const hits = [];
  if (!Array.isArray(traitList) || !parsed) return { farm, fert, health, squalor, squalorEstates, tax, taxSTRating, trading, mining, influence, law, unrest, localPop, mgmt, growthFarm: 0, hits };
  // ANTI-TRAIT CANCELLATION (live-cracked Thessalonike 2026-06-10): a seeded anti-trait
  // reduces the trait's effective level (Bokros: Prim 3 + Feck 1 → Prim level 2 → NO
  // squalor relief; his card shows only the architect −1, move-out test exact at ±0.5%).
  const seededLevel = {};
  for (const t of traitList) { const n = t && (t.name || t.trait); if (n) seededLevel[n] = (t.level != null ? t.level : t.points) | 0; }
  const antiMap = (parsed && parsed._anti) || {};
  let lawCorr = 0; // LAW for the corruption shift — own level rule, see below
  for (const t of traitList) {
    const name = t && (t.name || t.trait); if (!name) continue;
    if (BASELINE_TRAITS.has(name)) continue;
    const def = parsed[name]; if (!def || !def.length) continue;
    let pts = (t.level != null ? t.level : (t.points != null ? t.points : 0)) | 0;
    // META-RATING TRAITS (ICERating "ICE…", STRating "ST…") are engine-computed bitmask
    // ratings whose IN-GAME DISPLAYED LEVEL is recomputed from the character's underlying
    // stats each turn and does NOT equal the threshold-decode of the stored points
    // (live-disproven 2026-06-15: Sena's governor Publius stores STRating 6 → ST123 by
    // threshold, and his current Sel2/Temp5 recomputes to ST01, but his CARD reads ST10
    // "Considerate/Pessimistic" = his ICERating value 3 — neither stored nor Sel/Temp
    // recompute reproduces it). They also carry NO live settlement tax effect for
    // multi-town factions (no-governor controlled reads: Sena low 252 = 252, Arpi 562 =
    // 562, Metapontum 583 = 583), so we do NOT try to reverse the engine's bitmask here —
    // STRating falls through on its stored points like any other trait, and incomeModel
    // keeps the governor-tax channel neutralized for multi-town. Don't recompute STRating
    // from Sel/Temp; that was a wrong guess the Publius card refuted.
    if (ordinal) for (const a of (antiMap[name] || [])) if (seededLevel[a]) pts -= seededLevel[a];
    if (pts <= 0) continue;
    let chosen = null;
    if (ordinal) { chosen = def[Math.max(0, Math.min(def.length - 1, pts - 1))] || null; } // Nth level (1-based)
    else {
      for (const L of def) if (L.threshold <= pts) chosen = L; // highest threshold ≤ points
      // L1 FLOOR (live cyrene governor cards, 2026-06-11): holding a trait at ANY
      // points ≥ 1 activates at least level 1 even below its threshold — verified on
      // BOTH the law channel (Lenient pts6<thr10 → Law −2 ✓ Aristoteles card;
      // HarshJustice pts1<thr2 → Law +2 ✓ Perseus card) and the tax channel
      // (Lenient → Taxes −10 ✓ same card; fixes Arsinoe taxes 600→540 vs live 549).
      if (!chosen) chosen = def[0] || null;
    }
    // CORRUPTION-LAW channel: same as the card Law total, except LoyaltyLevel's
    // law lines do NOT apply (meta-trait; live-confirmed across the 7 governors).
    // L1-floored law counts for ALL ladder depths, deep ladders included
    // (REFIT 2 2026-06-12, corruption-refit-2.md): the fresh Venusia point needs
    // lawPts 2 = bldg 1 + floored GoodAdministrator +1; excluding deep-ladder
    // floors leaves Venusia at +3.26pp under the linear curve. The old "julii
    // implied law ≈ 0" evidence was an artifact of the old over-biased curve.
    if (name !== "LoyaltyLevel") {
      if (chosen && chosen.Law) lawCorr += chosen.Law;
    }
    if (!chosen) continue;
    if (chosen.Farming || chosen.Fertility || chosen.Health || chosen.Squalor || chosen.TaxCollection || chosen.Trading || chosen.Mining || chosen.Influence || chosen.Law || chosen.Unrest || chosen.LocalPopularity || chosen.Management) {
      farm += chosen.Farming; fert += chosen.Fertility; health += chosen.Health; squalor += chosen.Squalor;
      // GROWTH-SQUALOR WHITELIST (live 2026-06-11, Tetrapyrgia vs Larinum): only the
      // Estates-family trait squalor (physical land holdings) moves settlement GROWTH;
      // personality/finance squalor (Cheapskate +2 on the Tetrapyrgia governor) shows
      // in EDCT but the in-game growth scroll reads pop-squalor only. Larinum's
      // controlled Estates test (+2 → −1.0% growth) stays exact via this field.
      // NOTE: the Tetrapyrgia governor's in-game card shows +1/−1 squalor (net 0), so
      // the true engine mechanism may be level-mapping + an unattributed −1 relief
      // rather than non-application; refine when a counterexample appears.
      if (/^Estates/.test(name)) squalorEstates += chosen.Squalor;
      // STRating (an engine-computed bitmask meta-trait, levels ST00/ST01/…) is the game's
      // own *Settlement Tax Rating* — ST00 carries Effect TaxCollection 15. It IS a real
      // tax channel for SINGLE-TOWN city-states (Capua wine probe: WITHOUT it the model is
      // 2118 and cannot reach the live 2446). But in a multi-settlement faction it
      // OVER-CREDITS governed towns: live julii4 Neapolis reads 365, BELOW the no-governor
      // base 382, so the modelled +15% is simply not in the game there. STRating's
      // contribution is tracked separately (taxSTRating) so incomeModel can apply it only
      // for single-town factions and drop it for multi-town. (2026-06-15)
      if (name === "STRating") taxSTRating += chosen.TaxCollection || 0;
      tax += chosen.TaxCollection || 0; trading += chosen.Trading || 0; mining += chosen.Mining || 0;
      influence += chosen.Influence || 0; law += chosen.Law || 0; unrest += chosen.Unrest || 0; localPop += chosen.LocalPopularity || 0;
      mgmt += chosen.Management || 0;
      hits.push(`${name}/${pts}`);
    }
  }
  return { farm, fert, health, squalor, squalorEstates, tax, taxSTRating, trading, mining, influence, law, unrest, localPop, mgmt, lawCorr, growthFarm: farm, hits }; // growthFarm = Farming only (Fertility is character, not settlement)
}

// Convenience for callers holding a cracked save: build { [city]: {growthFarm, health, ...} }
// from settlementFields (governorUuid) + characters (uuid → traits). NOTE: crackSave returns
// characters as an OBJECT {v1, family, agents, ...}, NOT an array — the v1 array holds the live
// characters with traits + primaryUuid/secondaryUuid. (Bug fixed 2026-06-09: the old code read
// `cracked.characters` as an array → always empty, so the loaded-save tax plan silently ignored
// every governor's traits. This is where accrued Fertility traits like Dalmatian_Carrot /
// Ionian_Basileus / ICERating live — they give +0.5..+2% growth and explain the no-save
// undercounts, since they're accrued in-play and absent from descr_strat.)
function govEffectByCityFromSave(cracked, parsed, modDataDir) {
  const out = {};
  if (!cracked || !parsed) return out;
  const sf = cracked.settlementFields || {};
  const cc = cracked.characters;
  const chars = Array.isArray(cc) ? cc : (cc && Array.isArray(cc.v1) ? cc.v1 : []);
  const byUuid = {};
  for (const c of chars) {
    if (!c) continue;
    if (c.secondaryUuid != null) byUuid[c.secondaryUuid >>> 0] = c;
    if (c.primaryUuid != null && byUuid[c.primaryUuid >>> 0] == null) byUuid[c.primaryUuid >>> 0] = c;
  }
  // TRAIT LEVEL RULE (cracked 2026-06-11, Tetrapyrgia/Larinum live cards): the engine's
  // effective level for a SEEDED trait is the descr_strat ordinal NUMBER, not a threshold
  // lookup of the save's points (start-randomization inflates points without leveling —
  // Cheapskate seeded 1 stays Frugal at 3 pts despite level 2's threshold being 3).
  // For traits NOT in the seed (accrued in play), threshold-on-points stays the estimate.
  // The seeded-ordinal TRAIT switch regressed live econ (cyrene taxes 4321 vs 4487) and
  // stays behind opts.seededOrdinals; passing modDataDir alone now folds only FOLLOWER
  // (ancillary) effects — followers aren't in the cracked character records but never
  // reroll at start, so the descr_strat seed stays valid on turn-1 calibration saves
  // (Rome's scribe: Trading +10, Management +1 — was silently dropped).
  const opts = arguments.length > 3 ? arguments[3] : null;
  const seedMap = modDataDir ? stratSeedByCity(modDataDir) : null;
  const ancFx = modDataDir ? parseAncillaryEffects(modDataDir) : null;
  for (const city of Object.keys(sf)) {
    const uuid = sf[city].governorUuid;
    if (!uuid) continue;
    const ch = byUuid[uuid >>> 0];
    if (!ch || !ch.traits) continue;
    let e;
    const cs = seedMap && seedMap[city];
    if (cs && opts && opts.seededOrdinals) {
      // map each save trait to its effective ordinal level: seed level if seeded,
      // else highest-threshold-≤-points index
      const list = [];
      for (const t of ch.traits) {
        const name = t && (t.name || t.trait);
        if (!name) continue;
        if (cs.seed[name] != null) { list.push({ name, level: cs.seed[name] }); continue; }
        const def = parsed[name];
        if (!def || !def.length) continue;
        const pts = (t.points != null ? t.points : t.level) | 0;
        let idx = 0;
        for (let i = 0; i < def.length; i++) if (def[i].threshold <= pts) idx = i + 1;
        if (idx > 0) list.push({ name, level: idx });
      }
      e = growthEffectOfTraits(list, parsed, { ordinal: true });
    } else {
      e = growthEffectOfTraits(ch.traits, parsed);
      // TURN-1 FARM-LEVEL CAP (2026-06-15): on a turn-1 calibration save a farm trait's
      // start-randomized POINTS must not re-level it past its grant level. The points→
      // threshold path over-levels: live julii4 Metapontum's general is a Roman patrician
      // (no GoodFarmer seeded) who ROLLED GoodFarmer at start — the save stores 6 points,
      // which reads as Farmer (+2 farm), but in-game it sits at Grower (+1) (faction farm
      // 19356 = seed baseline 19283 + exactly ONE level; the model gave +2 → 19430). So
      // cap GoodFarmer/BadFarmer to their effective turn-1 level: the descr_strat SEED
      // ordinal if seeded, else 1 (the start-roll grant level). Re-credit the FARM channel
      // by the delta. This aligns the save path with the no-save strat path (validated farm
      // 10/11 exact), which already reads seed levels directly. Tax/law stay on the points
      // path (the full seededOrdinals switch regressed cyrene taxes).
      let farmDelta = 0;
      for (const t of ch.traits) {
        const name = t && (t.name || t.trait); if (!name) continue;
        const def = parsed[name]; if (!def || !def.length) continue;
        if (!def.some(L => L.Farming)) continue;            // farm-bearing traits only
        const pts = (t.points != null ? t.points : t.level) | 0;
        let thr = null; for (const L of def) if (L.threshold <= pts) thr = L; if (!thr) thr = def[0]; // points path (L1-floored)
        const seedLvl = (cs && cs.seed && cs.seed[name] != null) ? cs.seed[name] : 1;                  // seed ordinal, else grant level 1
        const eff = def[Math.max(0, Math.min(def.length - 1, seedLvl - 1))];
        farmDelta += ((eff && eff.Farming) || 0) - ((thr && thr.Farming) || 0);
      }
      if (farmDelta) { e.farm += farmDelta; e.growthFarm += farmDelta; if (e.hits) e.hits.push(`farmLvlΔ${farmDelta > 0 ? "+" : ""}${farmDelta}`); }
    }
    // follower (ancillary) effects from the seed — same settlement catalysts as traits
    if (ancFx && cs) for (const a of (cs.anc || [])) {
      const fx = ancFx[a]; if (!fx) continue;
      e.farm += fx.farm; e.fert += fx.fert; e.health += fx.health; e.squalor += fx.squalor;
      e.tax += fx.tax || 0; e.trading += fx.trading || 0; e.mining += fx.mining || 0;
      e.influence += fx.influence || 0; e.law += fx.law || 0; e.unrest += fx.unrest || 0;
      e.localPop += fx.localPop || 0; e.growthFarm += fx.farm; e.mgmt += fx.mgmt || 0;
      e.lawCorr = (e.lawCorr || 0) + (fx.law || 0);
      if (e.hits) e.hits.push("anc:" + a);
    }
    // COMPUTED CARD STATS (2026-06-11): the save stores the governor's displayed
    // Management/Command/Influence/Loyalty directly (signed) — no trait-level
    // mapping needed. admin% = 2·max(0, mgmtStat) is exact (7/7 live cyrene towns).
    if (ch.management != null) { e.mgmtStat = ch.management; e.influenceStat = ch.influence; e.commandStat = ch.command; }
    if (e.growthFarm || e.health || e.squalor || e.tax || e.trading || e.mining || e.influence || e.law || e.unrest || e.localPop || e.mgmt || e.mgmtStat != null) out[city] = e;
  }
  return out;
}

// Each settlement's tile {x,y} from map_regions.tga (region → city → coord).
// Returns [{ city, region, x, y }] in descr_strat coordinate space.
function settlementSites(modDataDir) {
  try {
    const dsg = require("./descrStratGeneral.js");
    const base = path.join(modDataDir, "world", "maps", "base");
    const drPath = path.join(base, "descr_regions.txt");
    const tgaPath = path.join(base, "map_regions.tga");
    if (!fs.existsSync(drPath) || !fs.existsSync(tgaPath)) return [];
    const { regionToCity, rgbToRegion } = dsg.parseDescrRegions(fs.readFileSync(drPath, "latin1"));
    const coords = dsg.buildRegionCoords(fs.readFileSync(tgaPath), rgbToRegion);
    const sites = [];
    for (const region of Object.keys(coords)) sites.push({ city: regionToCity[region] || region, region, x: coords[region].x, y: coords[region].y });
    return sites;
  } catch (e) { return []; }
}

// NO-SAVE governor effects: read the STARTING governors from descr_strat and bind each
// to its settlement by EXACT COORDINATES (user 2026-06-09: a governing general stands on
// the settlement's tile, and the general's x,y are exact — far more reliable than the
// `;CityName` comment, which is a fragile modder convention). For every named character we
// read its x,y + traits line, then match it to the settlement whose map tile is at the same
// coordinate (Manhattan distance ≤ TILE_TOL to absorb black-pixel centroid rounding).
// → { [cityName]: {growthFarm, health, squalor, ...} }, keyed by city (matches growthEval's
// region.settlement). Exact at game start; once played, governors move/accrue traits, so the
// loaded-save path (govEffectByCityFromSave) supersedes this. CONFIRMED Larinum 2026-06-09.
const TILE_TOL = 1;
// mtime-keyed cache (descr_strat read + TGA settlement-site decode per call was the
// last hot path in the 200-faction balance overview).
const _govStratCache = new Map();
function govEffectByCityFromStrat(modDataDir, parsed) {
  const strat0 = findDescrStrat(modDataDir);
  let mt = 0;
  try { mt = fs.statSync(strat0).mtimeMs; } catch { }
  const hit = _govStratCache.get(modDataDir);
  if (hit && hit.mt === mt) return hit.v;
  const v = govEffectByCityFromStratUncached(modDataDir, parsed);
  _govStratCache.set(modDataDir, { mt, v });
  return v;
}
function govEffectByCityFromStratUncached(modDataDir, parsed) {
  const out = {};
  if (!modDataDir || !parsed) return out;
  const strat = findDescrStrat(modDataDir);
  if (!strat) return out;
  const sites = settlementSites(modDataDir);
  if (!sites.length) return out; // no map coords → can't bind reliably (don't guess)
  const ancFx = parseAncillaryEffects(modDataDir); // follower (ancillary) growth effects by name
  const lines = fs.readFileSync(strat, "latin1").split(/\r?\n/);
  // collect every named character's coords + the traits AND ancillaries lines that follow it
  // (order in descr_strat: character → traits → [ancillaries] → army; finalize at next character)
  // USER RULE (2026-06-10, twice vindicated): bind ONLY by exact coordinates — never
  // the author comments, never distance-snaps, never terrain-gated relocation. Both
  // "engine relocation" theories (v0.9.1009 radius snap, v0.9.1013 impassable-ground
  // gate) were artifacts of analyzing a STALE mod copy ("RIS beta" 06-08) while the
  // game ran the updated "RIS" (06-09), where the governor in question is seeded
  // exactly on the city tile. ALWAYS verify which mod dir the live game uses.
  const generals = [];
  let pending = null;
  const finalize = () => { if (pending) generals.push(pending); pending = null; };
  for (const raw of lines) {
    const t = raw.includes(";") ? raw.slice(0, raw.indexOf(";")).trim() : raw.trim();
    if (!t) continue;
    // Tolerate the optional `sub_faction <name>,` field between `character` and the name —
    // Greek-city / sub-faction governors (e.g. Thurii: "character, sub_faction athens, Eumedes,
    // named character, …, x 327, y 372") were silently skipped without it. (Fixed 2026-06-09.)
    const m = t.match(/^character\s*,?\s*(?:sub_faction\s+\w+\s*,\s*)?[^,]+,\s*named character\b.*?\bx\s+(-?\d+)\s*,\s*y\s+(-?\d+)/i);
    if (m) { finalize(); pending = { x: +m[1], y: +m[2], traitList: [], anc: [] }; continue; }
    // ANY other character line (admiral/diplomat/spy/character_record) ends the pending
    // named character — otherwise the AGENT's `traits` line CLOBBERS the governor's
    // (live-caught 2026-06-10: Miletos' governor TimarchosB lost his 26 traits incl
    // GoodBuilder to a following admiral's `traits Sailor 4`, hiding −0.5% squalor relief).
    if (/^character[,\s]|^character_record/i.test(t)) { finalize(); continue; }
    if (!pending) continue;
    if (/^traits\b/i.test(t)) {
      pending.traitList = t.replace(/^traits\s+/i, "").split(",").map(s => {
        const p = s.trim().split(/\s+/); return p.length >= 2 ? { name: p[0], level: +p[p.length - 1] } : null;
      }).filter(Boolean);
    } else if (/^ancillaries\b/i.test(t)) {
      pending.anc = t.replace(/^ancillaries\s+/i, "").split(",").map(s => s.trim()).filter(Boolean);
    }
  }
  finalize();
  // bind each general to the settlement tile it stands on (nearest within TILE_TOL)
  for (const g of generals) {
    let best = null, bestD = Infinity;
    for (const s of sites) { const d = Math.abs(s.x - g.x) + Math.abs(s.y - g.y); if (d < bestD) { bestD = d; best = s; } }
    if (!best || bestD > TILE_TOL) continue; // not standing in a settlement → not a governor
    const e = growthEffectOfTraits(g.traitList, parsed, { ordinal: true }); // descr_strat number = level index
    // fold in FOLLOWER (ancillary) effects — same settlement catalysts as traits
    for (const a of g.anc) { const fx = ancFx[a]; if (!fx) continue; e.farm += fx.farm; e.fert += fx.fert; e.health += fx.health; e.squalor += fx.squalor; e.tax += fx.tax || 0; e.trading += fx.trading || 0; e.mining += fx.mining || 0; e.influence += fx.influence || 0; e.law += fx.law || 0; e.unrest += fx.unrest || 0; e.localPop += fx.localPop || 0; e.growthFarm += fx.farm; e.mgmt += fx.mgmt || 0; if (e.hits) e.hits.push("anc:" + a); } // growthFarm = Farming only; fert is character
    if (!(e.growthFarm || e.health || e.squalor || e.tax || e.trading || e.mining || e.influence || e.law || e.unrest || e.localPop || e.mgmt)) continue;
    const prev = out[best.city]; // if two land on one tile, keep the stronger-squalor governor
    if (!prev || Math.abs(e.squalor) > Math.abs(prev.squalor)) out[best.city] = e;
  }
  return out;
}

function findDescrStrat(modDataDir) {
  for (const c of [
    ["world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"],
    ["world", "maps", "campaign", "alexander", "descr_strat.txt"],
    ["world", "maps", "campaign", "barbarian_invasion", "descr_strat.txt"],
  ]) { const p = path.join(modDataDir, ...c); if (fs.existsSync(p)) return p; }
  return null;
}

// SEED MAP: city → { seed: {traitName: seededLevel}, anc: [ancillaryNames] } from
// descr_strat (same coordinate-binding walk as govEffectByCityFromStrat). Proven
// 2026-06-11 (Hermokrates/Tetrapyrgia + Larinum Estates): the seeded NUMBER is the
// engine's effective ordinal LEVEL regardless of the save's randomized points.
const _seedCache = new Map();
function stratSeedByCity(modDataDir) {
  const strat0 = findDescrStrat(modDataDir);
  let mt = 0;
  try { mt = fs.statSync(strat0).mtimeMs; } catch { }
  const hit = _seedCache.get(modDataDir);
  if (hit && hit.mt === mt) return hit.v;
  const out = {};
  try {
    const sites = settlementSites(modDataDir);
    if (strat0 && sites.length) {
      const lines = fs.readFileSync(strat0, "latin1").split(/\r?\n/);
      const generals = [];
      let pending = null;
      const finalize = () => { if (pending) generals.push(pending); pending = null; };
      for (const raw of lines) {
        const t = raw.includes(";") ? raw.slice(0, raw.indexOf(";")).trim() : raw.trim();
        if (!t) continue;
        const m = t.match(/^character\s*,?\s*(?:sub_faction\s+\w+\s*,\s*)?[^,]+,\s*named character\b.*?\bx\s+(-?\d+)\s*,\s*y\s+(-?\d+)/i);
        if (m) { finalize(); pending = { x: +m[1], y: +m[2], seed: {}, anc: [] }; continue; }
        if (/^character[,\s]|^character_record/i.test(t)) { finalize(); continue; }
        if (!pending) continue;
        if (/^traits\b/i.test(t)) {
          for (const s of t.replace(/^traits\s+/i, "").split(",")) {
            const p = s.trim().split(/\s+/);
            if (p.length >= 2) pending.seed[p[0]] = +p[p.length - 1];
          }
        } else if (/^ancillaries\b/i.test(t)) {
          pending.anc = t.replace(/^ancillaries\s+/i, "").split(",").map(s => s.trim()).filter(Boolean);
        }
      }
      finalize();
      for (const g of generals) {
        let best = null, bestD = Infinity;
        for (const s of sites) { const d = Math.abs(s.x - g.x) + Math.abs(s.y - g.y); if (d < bestD) { bestD = d; best = s; } }
        if (!best || bestD > TILE_TOL) continue;
        out[best.city] = { seed: g.seed, anc: g.anc };
      }
    }
  } catch { /* none */ }
  _seedCache.set(modDataDir, { mt, v: out });
  return out;
}

module.exports = { parseTraitEffects, parseAncillaryEffects, growthEffectOfTraits, govEffectByCityFromSave, govEffectByCityFromStrat, stratSeedByCity, findEDCT };
