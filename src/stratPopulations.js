// src/stratPopulations.js
//
// STARTING-POPULATION EDITS to descr_strat (2026-08-06, mod-team request:
// an editable table of every settlement's starting population).
//
// Pure text transforms — no fs, no electron — so the corruption-prone part
// (rewriting lines inside settlement blocks) is unit-testable byte-for-byte.
// The IPC handlers in saveAnalysisHandlers.js own file I/O + backups.
//
// A settlement block looks like:
//   settlement
//   {
//       level huge_city
//       region Qart-Khadasht
//       year_founded 0
//       population 12000
//       ...building blocks with their own braces...
//   }
// Blocks are keyed by their `region` line — region names are unique across
// descr_strat, and population edits must not care which faction block the
// settlement currently sits under. Brace DEPTH is tracked, not "first }",
// because every nested building block closes with its own brace (the
// update-region-buildings 0.9.444 lesson).

"use strict";

// changes: { regionNameLowerOrExact: newPop } — keys matched case-insensitively.
// → { text, applied: [{ region, from, to, line }], missing: [region...],
//     noPopLine: [region...] }  (text unchanged for every non-applied region;
//     ONLY the matched population lines differ, indentation preserved).
function applyPopulations(text, changes) {
  const want = new Map(); // lower region → newPop
  for (const k of Object.keys(changes || {})) {
    const v = Math.round(Number(changes[k]));
    if (Number.isFinite(v) && v >= 1) want.set(String(k).toLowerCase(), v);
  }
  const eol = /\r\n/.test(text) ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const applied = [];
  const noPopLine = [];
  let inSettlement = false, depth = 0, regionName = null, popLineIdx = -1, blockStart = -1;
  const closeBlock = () => {
    if (regionName && want.has(regionName.toLowerCase())) {
      const to = want.get(regionName.toLowerCase());
      if (popLineIdx >= 0) {
        const m = lines[popLineIdx].match(/^(\s*population\s+)(\d+)(.*)$/);
        const from = +m[2];
        lines[popLineIdx] = m[1] + to + m[3];
        applied.push({ region: regionName, from, to, line: popLineIdx + 1 });
      } else {
        noPopLine.push(regionName);
      }
      want.delete(regionName.toLowerCase());
    }
    inSettlement = false; depth = 0; regionName = null; popLineIdx = -1; blockStart = -1;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inSettlement) {
      if (/^settlement\b/.test(line)) { inSettlement = true; depth = 0; regionName = null; popLineIdx = -1; blockStart = i; }
      continue;
    }
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;
    if (depth === 1) { // directly inside the settlement braces (not in a building block)
      const rm = line.match(/^\s*region\s+(\S+)/);
      if (rm) regionName = rm[1];
      if (/^\s*population\s+\d+/.test(line)) popLineIdx = i;
    }
    depth += opens;
    depth -= closes;
    if (depth <= 0 && (opens > 0 || closes > 0)) closeBlock();
  }
  return { text: lines.join(eol), applied, missing: [...want.keys()], noPopLine };
}

module.exports = { applyPopulations };
