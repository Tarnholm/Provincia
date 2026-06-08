// src/traitEffects.js
//
// Parse export_descr_character_traits.txt (EDCT) and compute a governor's net
// GROWTH-relevant trait effect. Per the user (2026-06-08): generals' traits DO
// affect settlement growth, so the growth estimate must always account for them.
//
// Growth-relevant trait effects (RTW):
//   Effect Farming  N  → adds N to the settlement's farming level → growth
//   Effect Fertility N → raises region fertility → base farming → growth
//   Effect Health   N  → health catalyst → growth
//   Effect Squalor  N  → (kept separate; primarily public-order, see growth notes)
// Farming + Fertility both feed the farming growth catalyst (so we fold them into the
// growthEval `farmLevel` feature); Health feeds `healthSum`. Coefficients are the same
// ones growthEval already calibrated for those features.
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

// → { traitName: [ { threshold, Farming, Fertility, Health, Squalor }, ... ] }  (levels asc by threshold)
function parseTraitEffects(modDataDir) {
  const p = findEDCT(modDataDir);
  const traits = {};
  if (!p) return traits;
  const lines = fs.readFileSync(p, "latin1").split(/\r?\n/);
  let cur = null, lvl = null;
  for (const raw of lines) {
    const ln = raw.replace(/;.*$/, "");
    let m;
    if ((m = ln.match(/^Trait\s+(\w+)/))) { cur = m[1]; traits[cur] = []; lvl = null; continue; }
    if (!cur) continue;
    if ((m = ln.match(/^\s*Level\s+(\w+)/))) { lvl = { threshold: 1, Farming: 0, Fertility: 0, Health: 0, Squalor: 0 }; traits[cur].push(lvl); continue; }
    if (!lvl) continue;
    if ((m = ln.match(/^\s*Threshold\s+(-?\d+)/))) { lvl.threshold = +m[1]; continue; }
    if ((m = ln.match(/^\s*Effect\s+(Farming|Fertility|Health|Squalor)\s+(-?\d+)/))) lvl[m[1]] += +m[2];
  }
  for (const t of Object.keys(traits)) traits[t].sort((a, b) => a.threshold - b.threshold);
  // drop traits with no growth effect at any level (keep the map small)
  for (const t of Object.keys(traits)) if (!traits[t].some(L => L.Farming || L.Fertility || L.Health || L.Squalor)) delete traits[t];
  return traits;
}

// traitList: [{ name, level(points) }] (from crackSave characters or descr_strat).
// → { farm, fert, health, squalor, growthFarm, hits } where growthFarm = farm + fert.
function growthEffectOfTraits(traitList, parsed) {
  let farm = 0, fert = 0, health = 0, squalor = 0; const hits = [];
  if (!Array.isArray(traitList) || !parsed) return { farm, fert, health, squalor, growthFarm: 0, hits };
  for (const t of traitList) {
    const name = t && (t.name || t.trait); if (!name) continue;
    const def = parsed[name]; if (!def || !def.length) continue;
    const pts = (t.level != null ? t.level : (t.points != null ? t.points : 0)) | 0;
    let chosen = null; for (const L of def) if (L.threshold <= pts) chosen = L; // highest threshold ≤ points
    if (!chosen) continue;
    if (chosen.Farming || chosen.Fertility || chosen.Health || chosen.Squalor) {
      farm += chosen.Farming; fert += chosen.Fertility; health += chosen.Health; squalor += chosen.Squalor;
      hits.push(`${name}/${pts}`);
    }
  }
  return { farm, fert, health, squalor, growthFarm: farm + fert, hits };
}

// Convenience for callers holding a cracked save: build { [city]: {growthFarm, health, ...} }
// from settlementFields (governorUuid) + characters (secondaryUuid → traits).
function govEffectByCityFromSave(cracked, parsed) {
  const out = {};
  if (!cracked || !parsed) return out;
  const sf = cracked.settlementFields || {};
  const chars = cracked.characters || [];
  const byUuid = {};
  for (const c of (Array.isArray(chars) ? chars : [])) if (c && c.secondaryUuid != null) byUuid[c.secondaryUuid >>> 0] = c;
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

module.exports = { parseTraitEffects, growthEffectOfTraits, govEffectByCityFromSave, findEDCT };
