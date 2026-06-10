// src/recruitPool.js
//
// Recruitable-unit engine with FULL RIS gating (cracked + validated 2026-06-07
// against the gades faction at Gades/Agadir). A unit is recruitable at a
// settlement S for faction F if ANY of its `recruit "<unit>" <minxp> requires
// factions {…} <conds>` lines in export_descr_buildings.txt is satisfied:
//   - F ∈ the factions{} list, AND
//   - the mic tier gate is met (mic_tier_N ≤ S's military_industrial_complex level), AND
//   - every POSITIVE `hidden_resource <res>` is present in S's region, and every
//     `not hidden_resource <res>` is ABSENT.
// CRITICAL (provincia-recruitability-check-rule): RIS units have MANY recruit
// lines incl. HOMELAND / no-AOR lines that let a faction build its full roster at
// its capital even without the matching AOR — so never assume from one line.
//
// All three inputs come from the mod's data dir:
//   - export_descr_buildings.txt  (recruit lines)
//   - export_descr_unit.txt       (upkeep + category)
//   - world/maps/base/descr_regions.txt  (per-region hidden_resource / AOR list)
// and the settlement's mic level from descr_strat (passed in by the caller).

"use strict";

const fs = require("fs");
const path = require("path");

function readMod(modDataDir, rel) {
  const p = path.join(modDataDir, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "latin1") : null;
}

// region name → Set of hidden_resource / AOR tags (6th line of each descr_regions block).
function parseRegionHiddenResources(modDataDir) {
  const txt = readMod(modDataDir, path.join("world", "maps", "base", "descr_regions.txt"));
  const out = {};
  if (!txt) return out;
  // Each region block: name / settlement / faction / rebels / "r g b" / <res csv> / ...
  for (const block of txt.split(/\n(?=\S)/)) {
    const lines = block.split(/\r?\n/);
    if (lines.length < 6) continue;
    const region = lines[0].trim();
    if (!region || region.startsWith(";")) continue;
    // the resource/AOR csv is the line with aor_/rel_/homeland_/Farm tokens
    let resLine = null;
    for (let i = 4; i < Math.min(lines.length, 9); i++) {
      if (/\b(aor_|homeland_|rel_|Farm\d|mediterranean|wetlands)/.test(lines[i])) { resLine = lines[i]; break; }
    }
    if (!resLine) continue;
    const set = new Set(resLine.split(",").map(s => s.trim().toLowerCase()).filter(Boolean));
    out[region] = set;
  }
  return out;
}

// unit name (lowercase) → { upkeep, recruit, category, soldiers }
// mtime-keyed cache: EDU is >1 MB and parseUnitStats is hit per faction by the
// balance overview — re-parse only when export_descr_unit.txt changes on disk.
const _unitStatsCache = new Map();
function parseUnitStats(modDataDir) {
  const p = require("path").join(modDataDir, "export_descr_unit.txt");
  let mt = 0;
  try { mt = require("fs").statSync(p).mtimeMs; } catch { }
  const hit = _unitStatsCache.get(modDataDir);
  if (hit && hit.mt === mt) return hit.v;
  const v = parseUnitStatsUncached(modDataDir);
  _unitStatsCache.set(modDataDir, { mt, v });
  return v;
}
function parseUnitStatsUncached(modDataDir) {
  const txt = readMod(modDataDir, "export_descr_unit.txt");
  const out = {};
  if (!txt) return out;
  for (const b of txt.split(/\n(?=type\s)/)) {
    const t = b.match(/^type\s+(.+?)\s*$/m); if (!t) continue;
    const name = t[1].trim().toLowerCase();
    const cost = b.match(/^stat_cost\s+(.+?)\s*$/m);
    const cat = b.match(/^category\s+(\w+)/m);          // infantry / cavalry / siege / handler / ship
    const cls = b.match(/^class\s+(\w+)/m);             // light / heavy / missile / spearmen / skirmish
    const sol = b.match(/^soldier\s+\w+,\s*(\d+)/m);
    const f = cost ? cost[1].split(",").map(s => s.trim()) : [];
    out[name] = {
      recruit: f[1] != null ? +f[1] : null,
      upkeep: f[2] != null ? +f[2] : null,
      category: cat ? cat[1] : null,
      cls: cls ? cls[1] : null,
      soldiers: sol ? +sol[1] : null,
    };
  }
  return out;
}

// Parse the mic (military_industrial_complex) tier from a settlement's building list.
// buildings = array of {type, name} or the raw descr_strat building names.
function micTierFromBuildings(buildingNames) {
  for (const b of buildingNames || []) {
    const m = String(b).match(/mic_(\d)/);
    if (m) return +m[1];
  }
  return 0;
}

// Is a single recruit condition string satisfied for (faction, micTier, regionRes)?
// opts.firedEvents: Set of major_event tokens that have fired. The harness models the
// CAMPAIGN START, where no reform has fired — so by default every `major_event "x"`
// gated line is NOT recruitable (USER RULE 2026-06-10: never suggest units gated by a
// reform; RIS gates 3,449 recruit lines on reforms like marian_reforms / aor_reforms /
// suebi_reforms — all mid-game progression events).
function conditionSatisfied(cond, faction, micTier, regionRes, opts) {
  // mic tier gate
  const tier = cond.match(/mic_tier_(\d)/);
  if (tier && +tier[1] > micTier) return false;
  // reform / major_event gates: require the event to have fired (none at start —
  // USER-CONFIRMED 2026-06-10: "No reforms at the start")
  const fired = (opts && opts.firedEvents) || null;
  for (const m of cond.matchAll(/(not\s+)?major_event\s+"([^"]+)"/g)) {
    const has = fired ? fired.has(m[2].toLowerCase()) : false;
    if (m[1] ? has : !has) return false; // `major_event` needs fired; `not major_event` needs not-fired
  }
  // PLAYER PERSPECTIVE ONLY (USER RULE 2026-06-10: "Only go for is_player options —
  // we set up the factions for players"): AI-only lines (`not is_player`) are excluded;
  // `is_player` lines pass since the pool models the human player's options.
  if (/not\s+is_player\b/.test(cond)) return false;
  // positive hidden_resource requirements (aor_/homeland_/etc.) must be present
  for (const m of cond.matchAll(/(?<!not )hidden_resource\s+(\w+)/g)) {
    if (!regionRes.has(m[1].toLowerCase())) return false;
  }
  // negative hidden_resource requirements must be absent
  for (const m of cond.matchAll(/not\s+hidden_resource\s+(\w+)/g)) {
    if (regionRes.has(m[1].toLowerCase())) return false;
  }
  // `not factions { ... }` exclusion list (e.g. the AOR variant of a unit excludes its
  // HOME faction, which gets the native version instead)
  for (const m of cond.matchAll(/not\s+factions\s*\{([^}]*)\}/g)) {
    if (new RegExp("\\b" + String(faction).toLowerCase().replace(/[^a-z0-9_]/g, "") + "\\b").test(m[1].toLowerCase())) return false;
  }
  return true;
}

// Build the recruitable pool. Returns [{ unit, upkeep, recruit, category, cls, tier }].
// regionRes = Set of the settlement's region hidden_resource tags.
function recruitablePool(edb, faction, micTier, regionRes, unitStats) {
  const fac = String(faction || "").toLowerCase();
  const pool = new Map();
  const re = /recruit\s+"([^"]+)"\s+\d+\s+requires factions \{([^}]*)\}([^\n]*)/g;
  let m;
  while ((m = re.exec(edb)) !== null) {
    const unit = m[1];
    const facs = m[2].toLowerCase();
    const cond = m[3];
    if (!new RegExp("\\b" + fac.replace(/[^a-z0-9_]/g, "") + "\\b").test(facs)) continue;
    if (!conditionSatisfied(cond, fac, micTier, regionRes)) continue;
    const tier = cond.match(/mic_tier_(\d)/);
    if (!pool.has(unit)) {
      const st = unitStats[unit.toLowerCase()] || {};
      pool.set(unit, { unit, upkeep: st.upkeep ?? null, recruit: st.recruit ?? null, category: st.category || null, cls: st.cls || null, tier: tier ? +tier[1] : 0 });
    }
  }
  return [...pool.values()];
}

// High-level: pool for one settlement given the mod dir, faction, the settlement's
// building names, and its region name.
function poolForSettlement(modDataDir, faction, buildingNames, regionName, _cache) {
  const cache = _cache || {};
  const edb = cache.edb || (cache.edb = readMod(modDataDir, "export_descr_buildings.txt") || "");
  const unitStats = cache.unitStats || (cache.unitStats = parseUnitStats(modDataDir));
  const regionRes = cache.regions || (cache.regions = parseRegionHiddenResources(modDataDir));
  const res = regionRes[regionName] || new Set();
  const micTier = micTierFromBuildings(buildingNames);
  return recruitablePool(edb, faction, micTier, res, unitStats);
}

module.exports = {
  parseRegionHiddenResources,
  parseUnitStats,
  micTierFromBuildings,
  recruitablePool,
  poolForSettlement,
};
