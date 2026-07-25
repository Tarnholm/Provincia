// src/modLint.js — parse-time mod consistency lint (2026-07-17).
//
// lintMod(modDataDir) cross-checks the mod's core text files for the mistakes
// that otherwise surface in-game as cryptic failures (the RIS "unrecognised
// resource class" Building-DB-init crash, silently unrecruitable units, dead
// requires-conditions). Reuses the proven parsers from growthEval.js
// (parseRegions / parseEDB) and incomeModel.js (parseResourceValues); anything
// they don't expose (EDU type list, descr_sm_resources entries with uppercase
// or hyphens in the name, campaign-script add_hidden_resource grants) is
// parsed locally here — existing files are NOT modified.
//
// Checks (see lintMod below):
//   1. FATAL  edb-undeclared-resource — hidden_resource/resource token in an EDB
//             requires-condition that descr_sm_resources.txt does not declare.
//             The proven-crash case is a token that IS a region hidden tag but
//             is missing from the JSON (Building DB init: "unrecognised
//             resource class").
//   2. ERROR  strat-unknown-unit — descr_strat army `unit` line naming a unit
//             with no `type` in export_descr_unit.txt.
//   3. ERROR  edb-unknown-recruit — EDB recruit/recruit_pool naming a unit with
//             no `type` in the EDU.
//   4. WARN   edb-unknown-building — building_present / building_present_min_level
//             referencing a chain (or a level within a chain) the EDB never defines.
//   5. WARN   edb-dead-hidden-resource — hidden_resource token used in EDB that
//             appears in ZERO regions' hidden-tag lists AND is never granted by
//             add_hidden_resource in any campaign script: the condition can
//             never be true anywhere.
//
// Precision notes (validated live against C:/RIS/RIS/data, which must lint
// with 0 fatals / 0 errors — the mod runs):
//   - "capital" is an engine-virtual hidden resource (the settlement's capital
//     flag); UnderSiege1-6 / Blockaded are set by the engine at runtime. All
//     are skipped by the dead-condition check (they ARE still required to be
//     declared in descr_sm_resources — Remastered's vanilla file declares them).
//   - incomeModel.parseResourceValues only matches lowercase [a-z_0-9] names;
//     real RIS entries include "UnderSiege1" and "aor_galato-thracian". A local
//     tolerant pass supplements it so those are not false "undeclared" fatals.
//   - descr_regions tags and JSON names are compared case-insensitively (the
//     engine is case-tolerant here; parseRegions lowercases tags).
//   - hidden_resource tokens that are undeclared AND not region tags (RIS ships
//     farm1..farm14, inherited from vanilla) do not crash the game — they are
//     reported by check 5 as dead conditions, not by check 1 as fatals.
"use strict";
const fs = require("fs");
const path = require("path");
const gv = require("./growthEval.js");
const { parseResourceValues } = require("./incomeModel.js");

const STRAT_REL = path.join("world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
const REGIONS_REL = path.join("world", "maps", "base", "descr_regions.txt");

// Engine-virtual hidden resources: true/false is decided by the engine at
// runtime, never by descr_regions tags or scripts.
const ENGINE_HIDDEN = new Set([
  "capital",
  "undersiege1", "undersiege2", "undersiege3", "undersiege4", "undersiege5", "undersiege6",
  "blockaded",
]);

function readLatin1(p) {
  try { return fs.readFileSync(p, "latin1"); } catch { return null; }
}

// descr_sm_resources.txt, tolerant pass: name -> subtype (lowercased). Handles
// uppercase/hyphen names ("UnderSiege1", "aor_galato-thracian") and blocks with
// nothing but a "subtype" line, which parseResourceValues' block regex misses.
function scanSmResources(txt) {
  const out = new Map(); // nameLower -> { subtype }
  if (!txt) return out;
  const lines = txt.split(/\r?\n/);
  let cur = null;
  for (const raw of lines) {
    const ln = raw.replace(/;.*$/, "");
    const nm = ln.match(/^\s*"([A-Za-z0-9_\-]+)"\s*:\s*\{?\s*$/);
    if (nm && nm[1].toLowerCase() !== "resources") { cur = nm[1].toLowerCase(); if (!out.has(cur)) out.set(cur, { subtype: "none" }); continue; }
    if (!cur) continue;
    const st = ln.match(/"subtype"\s*:\s*"([a-z_]+)"/);
    if (st) out.get(cur).subtype = st[1];
  }
  return out;
}

// Merge the reused parser with the tolerant local scan: entry exists if EITHER
// saw it; the local scan's subtype wins for names the reused parser missed.
function loadResourceDecls(modDataDir) {
  const decls = new Map(); // nameLower -> { hidden: bool }
  const fromModel = parseResourceValues(modDataDir); // reused parser (lowercase names)
  for (const [name, v] of Object.entries(fromModel)) decls.set(name.toLowerCase(), { hidden: !!v.hidden });
  const local = scanSmResources(readLatin1(path.join(modDataDir, "descr_sm_resources.txt")));
  for (const [name, v] of local) if (!decls.has(name)) decls.set(name, { hidden: v.subtype === "hidden" });
  return decls;
}

// EDU: Set of lowercased `type` names.
function scanEduTypes(txt) {
  const types = new Set();
  if (!txt) return types;
  for (const raw of txt.split(/\r?\n/)) {
    const m = raw.replace(/;.*$/, "").match(/^type\s+(.+?)\s*$/);
    if (m) types.add(m[1].trim().toLowerCase());
  }
  return types;
}

// Campaign scripts: every token granted via `add_hidden_resource <where> <token>`.
// Scans all .txt files under world/maps/campaign/ (one directory level deep —
// RIS keeps its scripts next to descr_strat in imperial_campaign/).
function scanScriptGrants(modDataDir) {
  const grants = new Set();
  const campDir = path.join(modDataDir, "world", "maps", "campaign");
  let subdirs = [];
  try { subdirs = fs.readdirSync(campDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return grants; }
  for (const sub of subdirs) {
    const dir = path.join(campDir, sub);
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => /\.txt$/i.test(f)); } catch { continue; }
    for (const f of files) {
      const txt = readLatin1(path.join(dir, f));
      if (!txt) continue;
      for (const raw of txt.split(/\r?\n/)) {
        const ln = raw.replace(/;.*$/, ""); // commented-out grants must NOT suppress dead-condition warns
        const m = ln.match(/\badd_hidden_resource\s+\S+\s+([A-Za-z0-9_\-]+)/);
        if (m) grants.add(m[1].toLowerCase());
      }
    }
  }
  return grants;
}

function lintMod(modDataDir) {
  const t0 = Date.now();
  const warnings = [];
  const push = (severity, check, file, detail) => warnings.push({ severity, check, file, detail });

  const edbPath = path.join(modDataDir, "export_descr_buildings.txt");
  const eduPath = path.join(modDataDir, "export_descr_unit.txt");
  const stratPath = path.join(modDataDir, STRAT_REL);
  const regionsPath = path.join(modDataDir, REGIONS_REL);

  const edbTxt = readLatin1(edbPath);
  const eduTxt = readLatin1(eduPath);
  const stratTxt = readLatin1(stratPath);
  if (!edbTxt) push("fatal", "missing-file", "export_descr_buildings.txt", "export_descr_buildings.txt not found — EDB checks skipped");
  if (!eduTxt) push("fatal", "missing-file", "export_descr_unit.txt", "export_descr_unit.txt not found — unit checks skipped");
  if (!stratTxt) push("fatal", "missing-file", STRAT_REL, "descr_strat.txt not found — army checks skipped");
  if (!fs.existsSync(regionsPath)) push("fatal", "missing-file", REGIONS_REL, "descr_regions.txt not found — region-tag checks degraded");
  if (!fs.existsSync(path.join(modDataDir, "descr_sm_resources.txt"))) push("fatal", "missing-file", "descr_sm_resources.txt", "descr_sm_resources.txt not found — every EDB resource token would be an unrecognised resource class");

  // ---- shared indexes ----
  const decls = loadResourceDecls(modDataDir);                 // resource name -> { hidden }
  const { byRegion } = gv.parseRegions(modDataDir);            // reused parser
  const regionTags = new Set();
  for (const r of Object.values(byRegion)) for (const h of (r.hidden || [])) regionTags.add(String(h).toLowerCase());
  const eduTypes = scanEduTypes(eduTxt);
  const scriptGrants = scanScriptGrants(modDataDir);
  const edb = edbTxt ? gv.parseEDB(edbPath) : { chainLevels: {} }; // reused parser (memoized)
  const chainLevels = edb.chainLevels || {};

  // ---- one defensive line scan over the EDB drives checks 1, 3, 4, 5 ----
  // hiddenUses/resourceUses dedupe per token: tokenLower -> { first line, count, raw }
  const hiddenUses = new Map(), resourceUses = new Map();
  const seenRecruitMiss = new Set(), seenBpMiss = new Set();
  if (edbTxt) {
    const lines = edbTxt.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i].replace(/;.*$/, ""); // strip comments
      if (!ln.trim()) continue;
      const lineNo = i + 1;

      // resource tokens (word-boundary keeps hidden_resource/mine_resource separate)
      for (const m of ln.matchAll(/\bhidden_resource\s+([A-Za-z0-9_\-]+)/g)) {
        const k = m[1].toLowerCase();
        const u = hiddenUses.get(k);
        if (u) u.count++; else hiddenUses.set(k, { line: lineNo, count: 1, raw: m[1] });
      }
      for (const m of ln.matchAll(/\bresource\s+([A-Za-z0-9_\-]+)/g)) {
        const k = m[1].toLowerCase();
        const u = resourceUses.get(k);
        if (u) u.count++; else resourceUses.set(k, { line: lineNo, count: 1, raw: m[1] });
      }

      // check 3: recruit / recruit_pool unit names vs EDU
      const rm = ln.match(/^\s*recruit(?:_pool)?\s+"([^"]+)"/);
      if (rm && eduTypes.size) {
        const unit = rm[1].trim().toLowerCase();
        if (!eduTypes.has(unit) && !seenRecruitMiss.has(unit)) {
          seenRecruitMiss.add(unit);
          push("error", "edb-unknown-recruit", "export_descr_buildings.txt",
            `line ${lineNo}: recruit "${rm[1].trim()}" — no such unit type in export_descr_unit.txt (unit is silently unrecruitable or crashes on hover)`);
        }
      }

      // check 4: building_present(_min_level) vs the EDB's own chains/levels
      if (Object.keys(chainLevels).length) {
        for (const m of ln.matchAll(/\bbuilding_present_min_level\s+([A-Za-z0-9_+\-]+)\s+([A-Za-z0-9_+\-]+)/g)) {
          const chain = m[1], level = m[2];
          if (!(chain in chainLevels)) {
            if (!seenBpMiss.has("c:" + chain)) {
              seenBpMiss.add("c:" + chain);
              push("warn", "edb-unknown-building", "export_descr_buildings.txt",
                `line ${lineNo}: building_present_min_level references chain "${chain}" which no building block defines — condition is never true`);
            }
          } else if (level !== "queued" && !(chainLevels[chain] || []).includes(level)) {
            if (!seenBpMiss.has("l:" + chain + ":" + level)) {
              seenBpMiss.add("l:" + chain + ":" + level);
              push("warn", "edb-unknown-building", "export_descr_buildings.txt",
                `line ${lineNo}: building_present_min_level ${chain} ${level} — chain exists but has no level "${level}" (levels: ${(chainLevels[chain] || []).join(" ")})`);
            }
          }
        }
        for (const m of ln.matchAll(/\bbuilding_present\s+([A-Za-z0-9_+\-]+)/g)) {
          const chain = m[1];
          if (chain === "queued") continue; // `building_present X queued` modifier
          if (!(chain in chainLevels) && !seenBpMiss.has("c:" + chain)) {
            seenBpMiss.add("c:" + chain);
            push("warn", "edb-unknown-building", "export_descr_buildings.txt",
              `line ${lineNo}: building_present references chain "${chain}" which no building block defines — condition is never true`);
          }
        }
      }
    }
  }

  // check 1 (fatal) + check 5 (warn) from the collected hidden_resource tokens
  for (const [tok, u] of hiddenUses) {
    const declared = decls.get(tok);
    if (!declared) {
      if (regionTags.has(tok)) {
        // The proven Building-DB-init crash: tag exists on a region, resource
        // class was never declared → "unrecognised resource class" at startup.
        push("fatal", "edb-undeclared-resource", "export_descr_buildings.txt",
          `hidden_resource "${u.raw}" (first at line ${u.line}, ${u.count} use${u.count === 1 ? "" : "s"}) is a region hidden tag in descr_regions but is NOT declared in descr_sm_resources.txt — crashes Building DB init ("unrecognised resource class")`);
        continue;
      }
      if (!ENGINE_HIDDEN.has(tok)) {
        // Undeclared AND unused by any region/script: the game tolerates it
        // (RIS ships farm1..farm14) but the condition is dead weight.
        push("warn", "edb-dead-hidden-resource", "export_descr_buildings.txt",
          `hidden_resource "${u.raw}" (first at line ${u.line}, ${u.count} use${u.count === 1 ? "" : "s"}) is not declared in descr_sm_resources.txt, appears in no region and no script — condition is never true`);
      }
      continue;
    }
    // check 5: declared but never true anywhere (no region tag, no script grant, not engine-set)
    if (!regionTags.has(tok) && !scriptGrants.has(tok) && !ENGINE_HIDDEN.has(tok)) {
      push("warn", "edb-dead-hidden-resource", "export_descr_buildings.txt",
        `hidden_resource "${u.raw}" (first at line ${u.line}, ${u.count} use${u.count === 1 ? "" : "s"}) appears in ZERO regions in descr_regions and is never add_hidden_resource-granted by a campaign script — condition is never true anywhere`);
    }
  }
  // check 1, plain `resource X` tokens: flag only if absent from descr_sm_resources ENTIRELY
  for (const [tok, u] of resourceUses) {
    if (!decls.has(tok) && !ENGINE_HIDDEN.has(tok)) {
      push("fatal", "edb-undeclared-resource", "export_descr_buildings.txt",
        `resource "${u.raw}" (first at line ${u.line}, ${u.count} use${u.count === 1 ? "" : "s"}) is not declared in descr_sm_resources.txt at all — unrecognised resource class`);
    }
  }

  // ---- check 2: descr_strat army/garrison units vs EDU ----
  if (stratTxt && eduTypes.size) {
    const seen = new Set();
    const lines = stratTxt.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i].replace(/;.*$/, "");
      // `unit <name with spaces> exp N armour N weapon_lvl N` (trailing stat
      // block optional in some mods — fall back to the full remainder).
      let m = ln.match(/^\s*unit\s+(.+?)\s+exp\s+\d+/i);
      if (!m) { m = ln.match(/^\s*unit\s+(\S.*?)\s*$/i); if (m && /^of\b|^size\b/i.test(m[1])) m = null; }
      if (!m) continue;
      const unit = m[1].trim().toLowerCase();
      if (!unit || eduTypes.has(unit) || seen.has(unit)) continue;
      seen.add(unit);
      push("error", "strat-unknown-unit", STRAT_REL,
        `line ${i + 1}: unit "${m[1].trim()}" — no such unit type in export_descr_unit.txt (army fails to spawn / campaign load error)`);
    }
  }

  // ---- check 6: requires clauses that mix `and` with a trailing `or` ----
  // RTW's requires syntax has NO parentheses, and the conditions are evaluated
  // left-to-right with no operator precedence — which is how this app's own EDB
  // evaluator reads them (src/growthEval.js evalReq, calibrated line-for-line
  // against the in-game growth scroll). Under that rule
  //     A and B or C
  // means (A and B) or C, so C ALONE satisfies the clause. When an author writes
  //     not is_player and homeland and size1 or size2 or size3
  // the intent is almost always "AI, in a homeland region, at size 1-3", but the
  // trailing terms make size2/size3 sufficient on their own.
  //
  // Reported as a WARNING, not an error: a clause of this shape *can* be exactly
  // what the author meant, and the engine's own precedence is not something this
  // app can prove — so the message states the reading and asks for confirmation
  // rather than declaring a bug.
  if (edbTxt) {
    const seenClause = new Set();
    const lines = edbTxt.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (ln.trim().startsWith(";")) continue;          // commented-out
      const m = /\brequires\s+(.+)$/.exec(ln.replace(/;.*$/, ""));
      if (!m) continue;
      const clause = m[1].trim();
      if (!clause) continue;
      // only the risky shape: at least one `and` BEFORE the first `or`
      const firstOr = clause.search(/\bor\b/);
      if (firstOr < 0) continue;
      if (!/\band\b/.test(clause.slice(0, firstOr))) continue;
      // dedupe — RIS repeats the same clause across many building levels
      const key = clause.toLowerCase();
      if (seenClause.has(key)) continue;
      seenClause.add(key);
      // `factions { a, b, c, … }` lists run to 40+ names and would swamp the
      // message, so collapse them to a count. The clause is quoted once, not
      // twice — the point is the trailing terms, not the whole condition.
      const abbrev = (s) => s.replace(/factions\s*\{([^}]*)\}/g, (_, g) => {
        const n = g.split(",").map((x) => x.trim()).filter(Boolean).length;
        return `factions {…${n}}`;
      });
      // Show the ACTUAL left-to-right grouping rather than describing it, so the
      // message is right even when the tail contains further `and`s — in
      // `A and B or C and D` the reading is ((A and B) or C) and D, and C does
      // NOT satisfy the clause on its own. Getting that wrong would be worse
      // than not reporting at all.
      const shown = abbrev(clause);
      const toks = shown.split(/\s+(and|or)\s+/);
      let grouped = toks[0];
      for (let t = 1; t < toks.length; t += 2) grouped = `(${grouped} ${toks[t]} ${toks[t + 1]})`;
      // Does a trailing term short-circuit the whole thing? Only when every
      // operator after the first `or` is also `or`.
      const ops = [];
      for (let t = 1; t < toks.length; t += 2) ops.push(toks[t]);
      const firstOrIdx = ops.indexOf("or");
      const allOrAfter = ops.slice(firstOrIdx).every((o) => o === "or");
      const orTerms = [];
      for (let t = 1; t < toks.length; t += 2) if (toks[t] === "or") orTerms.push(toks[t + 1]);
      push("warn", "edb-and-or-precedence", "export_descr_buildings.txt",
        `line ${i + 1}: requires "${shown}" mixes and/or without grouping. RTW has no parentheses and evaluates ` +
        `left-to-right, so it reads as ${grouped}. ` +
        (allOrAfter
          ? `That means ${orTerms.map((t2) => `"${t2}"`).join(" or ")} alone satisfies the whole condition, bypassing every term before the first "or".`
          : `Note the trailing "and" — the grouping is not "either side of the or", which is usually what this shape is meant to express.`) +
        ` Confirm that is intended.`);
    }
  }

  const counts = { fatal: 0, error: 0, warn: 0 };
  for (const w of warnings) counts[w.severity] = (counts[w.severity] || 0) + 1;
  return { warnings, counts, ms: Date.now() - t0 };
}

module.exports = { lintMod, scanEduTypes, scanSmResources, scanScriptGrants };
