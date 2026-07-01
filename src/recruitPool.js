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
    // RTW:R EDU: "soldiers  6, 0, 3.2" (count first); vanilla: "soldier name, 12, ..."
    const sol = b.match(/^soldiers\s+(\d+)/m) || b.match(/^soldier\s+\w+,\s*(\d+)/m);
    const officers = (b.match(/^officer\s/gm) || []).length;
    const f = cost ? cost[1].split(",").map(s => s.trim()) : [];
    out[name] = {
      recruit: f[1] != null ? +f[1] : null,
      upkeep: f[2] != null ? +f[2] : null,
      category: cat ? cat[1] : null,
      cls: cls ? cls[1] : null,
      soldiers: sol ? +sol[1] : null,
      officers,
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
  // FIX 2026-07-01: RIS conditions are a real boolean expression with `and`, `or`, `not`
  // and (after alias expansion) parentheses — NOT a flat AND of tokens. The old flat model
  // treated every `building_present_min_level` inside the OR-based `gov_tier_1` alias as a
  // mandatory AND, wrongly demanding the settlement own ALL four government buildings.
  // Tokenise + recursive-descent evaluate instead.
  const facTok = String(faction).toLowerCase().replace(/[^a-z0-9_]/g, "");
  const ctx = {
    faction: facTok, micTier, regionRes,
    owned: (opts && opts.ownedBuildings) || null,
    levelIdx: (opts && opts.buildingLevelIndex) || null,
    fired: (opts && opts.firedEvents) || null,
  };
  const toks = tokenizeCond(cond);
  if (!toks.length) return true;
  const p = { toks, i: 0 };
  const val = parseExpr(p, ctx);
  return val;
}

// Tokeniser: emits `(`, `)`, `and`, `or`, `not`, and atom tokens. An atom is a predicate
// with its arguments glued (e.g. `hidden_resource:aor_oscan`, `building_present_min_level:governmenta:gov1`,
// `factions:{capua,samnites}`, `major_event:marian_reforms`, `mic_tier:1`, `is_player`).
function tokenizeCond(cond) {
  const out = [];
  // normalise: strip leading `and`/`requires`
  const s = " " + cond.trim().replace(/^requires\s+/, "") + " ";
  const re = /\(|\)|\bnot\b|\band\b|\bor\b|factions\s*\{[^}]*\}|major_event\s+"[^"]+"|building_present_min_level\s+\w+\s+\w+|building_present\s+\w+|hidden_resource\s+\w+|resource\s+\w+|mic_tier_\d|is_player|[a-z][a-z0-9_]*/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    let t = m[0].trim().toLowerCase().replace(/\s+/g, " ");
    if (t === "(" || t === ")" || t === "and" || t === "or" || t === "not") { out.push(t); continue; }
    if (t.startsWith("factions")) { out.push("atom:factions:" + t.replace(/factions\s*\{|\}/g, "").replace(/\s/g, "")); continue; }
    if (t.startsWith("major_event")) { out.push("atom:major_event:" + t.replace(/major_event\s+"|"/g, "")); continue; }
    if (t.startsWith("building_present_min_level")) { out.push("atom:bpml:" + t.split(/\s+/).slice(1).join(":")); continue; }
    if (t.startsWith("building_present")) { out.push("atom:bp:" + t.split(/\s+/)[1]); continue; }
    if (t.startsWith("hidden_resource")) { out.push("atom:hr:" + t.split(/\s+/)[1]); continue; }
    if (t.startsWith("resource ")) { out.push("atom:res:" + t.split(/\s+/)[1]); continue; }
    if (/^mic_tier_\d$/.test(t)) { out.push("atom:mic_tier:" + t.slice(-1)); continue; }
    out.push("atom:kw:" + t); // is_player, noisland, nobuilding, not_homeland, homeland, etc.
  }
  return out;
}

// expr ::= term ( (and|or) term )*   (left-assoc, and/or same precedence — matches engine)
function parseExpr(p, ctx) {
  let v = parseTerm(p, ctx);
  while (p.i < p.toks.length && p.toks[p.i] !== ")") {
    let op = "and";
    if (p.toks[p.i] === "and" || p.toks[p.i] === "or") op = p.toks[p.i++]; // else implicit AND
    const r = parseTerm(p, ctx);
    v = op === "and" ? (v && r) : (v || r);
  }
  return v;
}
// term ::= not term | ( expr ) | atom
function parseTerm(p, ctx) {
  const t = p.toks[p.i];
  if (t === "not") { p.i++; return !parseTerm(p, ctx); }
  if (t === "(") { p.i++; const v = parseExpr(p, ctx); if (p.toks[p.i] === ")") p.i++; return v; }
  p.i++;
  return evalAtom(t, ctx);
}

function evalAtom(tok, ctx) {
  const parts = tok.split(":"); // ["atom", kind, ...args]
  const kind = parts[1];
  if (kind === "factions") {
    if (/(^|,)all(,|$)/.test(parts[2])) return true; // `all` matches every faction
    return new RegExp("(^|,)" + ctx.faction + "(,|$)").test(parts[2]);
  }
  if (kind === "hr") return ctx.regionRes.has(parts[2]);
  // `resource <x>` = a MAP trade good on a tile in the region. We surface it from the region's
  // hidden_resource set when present; otherwise a resource-gated line is NOT recruitable here
  // (e.g. `resource elephants` at Neapolis — no elephants → reject).
  if (kind === "res") return ctx.regionRes.has(parts[2]);
  if (kind === "mic_tier") return +parts[2] <= ctx.micTier;
  if (kind === "major_event") return ctx.fired ? ctx.fired.has(parts[2]) : false; // none fired at start
  if (kind === "bpml") {
    const cls = parts[2], reqLvl = parts[3];
    if (!ctx.owned) return true; // no building info → don't gate
    if (!ctx.owned.has(cls)) return false;
    const idx = ctx.levelIdx && ctx.levelIdx[cls];
    if (idx) {
      const haveOrd = idx[ctx.owned.get(cls)], reqOrd = idx[reqLvl];
      if (haveOrd != null && reqOrd != null) return haveOrd >= reqOrd;
    }
    return true; // present, level unknown → treat as met
  }
  if (kind === "bp") return ctx.owned ? ctx.owned.has(parts[2]) : true;
  if (kind === "kw") {
    const k = parts[2];
    if (k === "is_player") return true;      // player-perspective pool
    // homeland / not_homeland / not_capital / noisland / nobuilding / no_other_government …
    // are settlement-context flags we don't model directly; they gate the ENCLOSING building,
    // which we already check via ownedBuildings. So inside a recruit line, treat as neutral(true).
    return true;
  }
  return true; // unknown token → neutral
}

// Build the recruitable pool. Returns [{ unit, upkeep, recruit, category, cls, tier }].
// regionRes = Set of the settlement's region hidden_resource tags.
// opts (FIX 2026-07-01): { ownedBuildings, buildingLevelIndex } — the settlement's
// building classes+levels + the EDB level ordinals, for building-presence gating.
function recruitablePool(edb, faction, micTier, regionRes, unitStats, opts) {
  const fac = String(faction || "").toLowerCase();
  const facTok = fac.replace(/[^a-z0-9_]/g, "");
  const pool = new Map();
  // FIX 2026-07-01: scan block-aware — each recruit line inherits its enclosing
  // `building <class> { … }` header; expand alias tokens; drop lines whose building
  // the settlement doesn't own. `aliases` = Map alias -> requires-body (from EDB).
  const aliases = parseEdbAliases(edb);
  const re = /^\s*building\s+(\w+)|recruit\s+"([^"]+)"\s+\d+\s+requires factions \{([^}]*)\}([^\n]*)/gm;
  let curBuilding = null;
  let m;
  while ((m = re.exec(edb)) !== null) {
    if (m[1]) { curBuilding = m[1].toLowerCase(); continue; } // building block header
    const unit = m[2];
    const facs = m[3].toLowerCase();
    let cond = m[4];
    // FIX: `factions { all }` matches every faction; else literal token match.
    if (!/\ball\b/.test(facs) && !new RegExp("\\b" + facTok + "\\b").test(facs)) continue;
    // FIX: gate on the enclosing building — the settlement must own that building class.
    if (opts && opts.ownedBuildings && curBuilding && !opts.ownedBuildings.has(curBuilding)) continue;
    // FIX: inline-expand alias tokens (gov_tier_N, colony_tier_N, aor_tier_N, …) so the
    // building_present_min_level / hidden_resource checks below can evaluate them.
    cond = expandAliases(cond, aliases);
    if (!conditionSatisfied(cond, fac, micTier, regionRes, opts)) continue;
    const tier = cond.match(/mic_tier_(\d)/);
    if (!pool.has(unit)) {
      const st = unitStats[unit.toLowerCase()] || {};
      pool.set(unit, { unit, upkeep: st.upkeep ?? null, recruit: st.recruit ?? null, category: st.category || null, cls: st.cls || null, tier: tier ? +tier[1] : 0 });
    }
  }
  return [...pool.values()];
}

// Parse `alias <name> { requires <body> }` blocks from the EDB into name -> body.
function parseEdbAliases(edb) {
  const out = {};
  const re = /alias\s+(\w+)\s*\{\s*requires\s+([^\n}]*)/g;
  let m;
  while ((m = re.exec(edb)) !== null) out[m[1].toLowerCase()] = m[2].trim();
  return out;
}

// Recursively replace alias tokens in a condition with their `requires` body. Aliases
// like aor_tier_1 → "gov_tier_1 and not colony_tier_2" → building_present_min_level … .
// `not <alias>` wraps the expanded body in not(...) via De Morgan-safe grouping is NOT
// attempted; we only invert the SINGLE building_present it resolves to (RIS aliases here
// each resolve to one gate or an OR of building_present_min_level, matching engine intent).
function expandAliases(cond, aliases, depth) {
  if ((depth || 0) > 8) return cond;
  let changed = false;
  // Replace each *_tier_N alias token with its parenthesised requires-body. The boolean
  // evaluator handles a preceding `not` correctly (it applies to the whole ( … ) group).
  const out = cond.replace(/\b([a-z_]+_tier_\d)\b/gi, (whole, name) => {
    const body = aliases[name.toLowerCase()];
    if (!body) return whole;
    changed = true;
    return "( " + body + " )";
  });
  return changed ? expandAliases(out, aliases, (depth || 0) + 1) : out;
}

// Parse EDB `building <class> { … levels lv1 lv2 … }` into class -> { level -> ordinal }.
// Used to evaluate building_present_min_level (does the owned level meet the required one).
function parseBuildingLevelIndex(edb) {
  const out = {};
  const re = /^\s*building\s+(\w+)|^\s*levels\s+([^\n{;]+)/gm;
  let cur = null, m;
  while ((m = re.exec(edb)) !== null) {
    if (m[1]) { cur = m[1].toLowerCase(); continue; }
    if (cur && m[2]) {
      const lv = m[2].trim().split(/\s+/).map(s => s.toLowerCase());
      out[cur] = {};
      lv.forEach((name, i) => { out[cur][name] = i + 1; });
      cur = null; // only the first levels line per building
    }
  }
  return out;
}

// Turn descr_strat building tokens ("governmentA gov1", "military_industrial_complex mic_1")
// into a Map class -> level. Accepts strings or {type} objects.
function parseOwnedBuildings(buildingNames) {
  const owned = new Map();
  for (const b of buildingNames || []) {
    const s = String(b && b.type != null ? b.type : b).trim();
    // accept BOTH the app/incomeModel "class:level" form and the descr_strat "class level" form
    const m = s.match(/^(\w+)[:\s]+(\w+)/);
    if (m) owned.set(m[1].toLowerCase(), m[2].toLowerCase());
  }
  return owned;
}

// High-level: pool for one settlement given the mod dir, faction, the settlement's
// building names, and its region name.
function poolForSettlement(modDataDir, faction, buildingNames, regionName, _cache) {
  const cache = _cache || {};
  const edb = cache.edb || (cache.edb = readMod(modDataDir, "export_descr_buildings.txt") || "");
  const unitStats = cache.unitStats || (cache.unitStats = parseUnitStats(modDataDir));
  const regionRes = cache.regions || (cache.regions = parseRegionHiddenResources(modDataDir));
  const buildingLevelIndex = cache.buildingLevelIndex || (cache.buildingLevelIndex = parseBuildingLevelIndex(edb));
  const res = regionRes[regionName] || new Set();
  const micTier = micTierFromBuildings(buildingNames);
  const ownedBuildings = parseOwnedBuildings(buildingNames);
  return recruitablePool(edb, faction, micTier, res, unitStats, { ownedBuildings, buildingLevelIndex });
}

module.exports = {
  parseRegionHiddenResources,
  parseUnitStats,
  micTierFromBuildings,
  recruitablePool,
  poolForSettlement,
};
