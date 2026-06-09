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
    if ((m = ln.match(/^Ancillary\s+(\w+)/))) { cur = m[1]; out[cur] = { farm: 0, fert: 0, health: 0, squalor: 0 }; continue; }
    if (!cur) continue;
    if ((m = ln.match(/^\s*Effect\s+(Farming|Fertility|Health|Squalor)\s+(-?\d+)/))) {
      const k = { Farming: "farm", Fertility: "fert", Health: "health", Squalor: "squalor" }[m[1]];
      out[cur][k] += +m[2];
    }
  }
  for (const k of Object.keys(out)) if (!(out[k].farm || out[k].fert || out[k].health || out[k].squalor)) delete out[k];
  return out;
}

// → { traitName: [ { threshold, Farming, Fertility, Health, Squalor }, ... ] }  (levels asc by
// threshold), plus traits._anti = { traitName: [antiTraitNames] } for anti-trait cancellation.
function parseTraitEffects(modDataDir) {
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
    if ((m = ln.match(/^\s*Level\s+(\w+)/))) { lvl = { threshold: 1, Farming: 0, Fertility: 0, Health: 0, Squalor: 0 }; traits[cur].push(lvl); continue; }
    if (!lvl) continue;
    if ((m = ln.match(/^\s*Threshold\s+(-?\d+)/))) { lvl.threshold = +m[1]; continue; }
    if ((m = ln.match(/^\s*Effect\s+(Farming|Fertility|Health|Squalor)\s+(-?\d+)/))) lvl[m[1]] += +m[2];
  }
  for (const t of Object.keys(traits)) traits[t].sort((a, b) => a.threshold - b.threshold);
  // drop traits with no growth effect at any level (keep the map small) — but KEEP the
  // anti-trait map complete (a no-effect trait like Feck can still cancel Prim levels)
  for (const t of Object.keys(traits)) if (!traits[t].some(L => L.Farming || L.Fertility || L.Health || L.Squalor)) delete traits[t];
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
  let farm = 0, fert = 0, health = 0, squalor = 0; const hits = [];
  if (!Array.isArray(traitList) || !parsed) return { farm, fert, health, squalor, growthFarm: 0, hits };
  // ANTI-TRAIT CANCELLATION (live-cracked Thessalonike 2026-06-10): a seeded anti-trait
  // reduces the trait's effective level (Bokros: Prim 3 + Feck 1 → Prim level 2 → NO
  // squalor relief; his card shows only the architect −1, move-out test exact at ±0.5%).
  const seededLevel = {};
  for (const t of traitList) { const n = t && (t.name || t.trait); if (n) seededLevel[n] = (t.level != null ? t.level : t.points) | 0; }
  const antiMap = (parsed && parsed._anti) || {};
  for (const t of traitList) {
    const name = t && (t.name || t.trait); if (!name) continue;
    if (BASELINE_TRAITS.has(name)) continue;
    const def = parsed[name]; if (!def || !def.length) continue;
    let pts = (t.level != null ? t.level : (t.points != null ? t.points : 0)) | 0;
    if (ordinal) for (const a of (antiMap[name] || [])) if (seededLevel[a]) pts -= seededLevel[a];
    if (pts <= 0) continue;
    let chosen = null;
    if (ordinal) { chosen = def[Math.max(0, Math.min(def.length - 1, pts - 1))] || null; } // Nth level (1-based)
    else { for (const L of def) if (L.threshold <= pts) chosen = L; } // highest threshold ≤ points
    if (!chosen) continue;
    if (chosen.Farming || chosen.Fertility || chosen.Health || chosen.Squalor) {
      farm += chosen.Farming; fert += chosen.Fertility; health += chosen.Health; squalor += chosen.Squalor;
      hits.push(`${name}/${pts}`);
    }
  }
  return { farm, fert, health, squalor, growthFarm: farm, hits }; // growthFarm = Farming only (Fertility is character, not settlement)
}

// Convenience for callers holding a cracked save: build { [city]: {growthFarm, health, ...} }
// from settlementFields (governorUuid) + characters (uuid → traits). NOTE: crackSave returns
// characters as an OBJECT {v1, family, agents, ...}, NOT an array — the v1 array holds the live
// characters with traits + primaryUuid/secondaryUuid. (Bug fixed 2026-06-09: the old code read
// `cracked.characters` as an array → always empty, so the loaded-save tax plan silently ignored
// every governor's traits. This is where accrued Fertility traits like Dalmatian_Carrot /
// Ionian_Basileus / ICERating live — they give +0.5..+2% growth and explain the no-save
// undercounts, since they're accrued in-play and absent from descr_strat.)
function govEffectByCityFromSave(cracked, parsed) {
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
  for (const city of Object.keys(sf)) {
    const uuid = sf[city].governorUuid;
    if (!uuid) continue;
    const ch = byUuid[uuid >>> 0];
    if (!ch || !ch.traits) continue;
    const e = growthEffectOfTraits(ch.traits, parsed);
    if (e.growthFarm || e.health || e.squalor) out[city] = e;
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
function govEffectByCityFromStrat(modDataDir, parsed) {
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
    // fold in FOLLOWER (ancillary) effects — same growth catalysts as traits
    for (const a of g.anc) { const fx = ancFx[a]; if (!fx) continue; e.farm += fx.farm; e.fert += fx.fert; e.health += fx.health; e.squalor += fx.squalor; e.growthFarm += fx.farm; if (e.hits) e.hits.push("anc:" + a); } // growthFarm = Farming only; fert is character
    if (!(e.growthFarm || e.health || e.squalor)) continue;
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

module.exports = { parseTraitEffects, parseAncillaryEffects, growthEffectOfTraits, govEffectByCityFromSave, govEffectByCityFromStrat, findEDCT };
