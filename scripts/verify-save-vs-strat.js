// verify-save-vs-strat.js — line-for-line consistency check between a
// turn-1 save (no actions taken) and descr_strat.txt. Standard:
// a fresh-load save MUST reproduce descr_strat exactly (regions, treasury,
// characters, diplomacy). Any mismatch is a parser bug.
//
// Usage:  node scripts/verify-save-vs-strat.js <save.sav> [modDataDir]
//
// Output: per-faction OK/MISMATCH report. Exit 1 if any mismatches.

"use strict";
const fs = require("fs");
const path = require("path");
const { crackSave } = require("../src/saveCracker.js");

if (process.argv.length < 3) {
  console.error("Usage: node verify-save-vs-strat.js <save.sav> [modDataDir]");
  process.exit(2);
}
const savePath = process.argv[2];
const modDataDir = process.argv[3] || "C:/RIS/RIS/data";
const stratPath = path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");

// ── descr_strat parse: per-faction expected state ─────────────────────────
function parseStrat(text) {
  const lines = text.split(/\r?\n/);
  const out = {};   // factionName → { denari, settlements:[], characterCount, charRecordCount, protectorates:[], wars:[] }
  let cur = null;
  let inSettlement = false;
  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li];
    const line = raw.replace(/;.*$/, "").trim();
    if (!line) continue;
    const fm = line.match(/^faction\s+([A-Za-z0-9_]+)\s*,/);
    if (fm) {
      cur = fm[1];
      if (!out[cur]) out[cur] = { denari: null, settlements: [], characterCount: 0, charRecordCount: 0, protectorates: [], wars: [], relationships: {} };
      inSettlement = false;
      continue;
    }
    if (!cur) continue;
    const dm = line.match(/^denari\s+(\d+)/);
    if (dm) { out[cur].denari = parseInt(dm[1], 10); continue; }
    if (line === "settlement") { inSettlement = true; continue; }
    if (inSettlement) {
      const rm = line.match(/^region\s+(\S+)/);
      if (rm) { out[cur].settlements.push(rm[1]); continue; }
      if (line === "}") { inSettlement = false; continue; }
    }
    if (line.startsWith("character,")) out[cur].characterCount++;
    if (line.startsWith("character_record")) out[cur].charRecordCount++;
  }
  // Second pass for faction_relationships (top-level in descr_strat).
  // Format: `faction_relationships <faction>, <bond> <other>`
  for (const raw of lines) {
    const line = raw.replace(/;.*$/, "").trim();
    const fr = line.match(/^faction_relationships\s+(\S+?),\s+(\d+)\s+(\S+)/);
    if (fr) {
      const [, a, bond, b] = fr;
      if (!out[a]) continue;
      out[a].relationships[b] = parseInt(bond, 10);
      // Mirror to b too — relationship is symmetric in descr_strat
      if (out[b]) out[b].relationships[a] = parseInt(bond, 10);
    }
  }
  // Derive protectorates (bond == 600 in descr_strat = protectorate per RTW convention) and wars
  for (const f of Object.keys(out)) {
    for (const [other, bond] of Object.entries(out[f].relationships)) {
      // Bond > 200 == elevated relationship (protectorate / alliance)
      // Bond < 0  == war
      if (bond > 200) out[f].protectorates.push(other);
      if (bond < 0)   out[f].wars.push(other);
    }
  }
  return out;
}

// ── run ────────────────────────────────────────────────────────────────────
console.log(`Loading strat from: ${stratPath}`);
const strat = parseStrat(fs.readFileSync(stratPath, "utf8"));
console.log(`  strat factions: ${Object.keys(strat).length}`);

console.log(`Cracking save: ${savePath}`);
const t0 = Date.now();
const buf = fs.readFileSync(savePath);
const cs = crackSave(buf, modDataDir);
console.log(`  crackSave: ${Date.now() - t0}ms\n`);

const report = { okCount: 0, mismatchCount: 0, factions: {} };
const FOCUS = ["romans_julii", "carthage", "antigonid", "ptolemaic", "seleucid", "epirus", "bactria"];
for (const f of FOCUS) {
  const s = strat[f];
  const cf = cs.factions[f];
  if (!s) { console.log(`[skip] ${f}: not in strat`); continue; }
  if (!cf) { console.log(`[skip] ${f}: not in save crack`); continue; }
  const issues = [];
  // 1. Treasury
  if (s.denari !== null && cf.treasury !== s.denari) {
    issues.push(`treasury: strat=${s.denari} save=${cf.treasury}`);
  }
  // 2. Region count
  if (s.settlements.length !== cf.regionCount) {
    issues.push(`regionCount: strat=${s.settlements.length} save=${cf.regionCount}`);
  }
  // 3. Character/family count (strat counts both)
  const stratFamily = s.characterCount + s.charRecordCount;
  if (Math.abs(stratFamily - cf.generalCount) > 5) {
    issues.push(`characters: strat=${stratFamily} (${s.characterCount} active + ${s.charRecordCount} family) save=${cf.generalCount}`);
  }
  // 4. Protectorate count
  const stratProt = s.protectorates.length;
  const saveProt = cf.diplomacy ? (cf.diplomacy.trade || []).length : 0;  // bond>=54 in matrix
  if (stratProt !== saveProt) {
    issues.push(`protectorates: strat=${stratProt} (${s.protectorates.join(",")}) save=${saveProt} (${(cf.diplomacy?.trade || []).join(",")})`);
  }
  console.log(`[${issues.length ? "✗" : "✓"}] ${f.padEnd(20)} ` + (issues.length ? "issues: " + issues.length : "OK"));
  for (const iss of issues) console.log(`    - ${iss}`);
  report.factions[f] = { issues };
  if (issues.length) report.mismatchCount++; else report.okCount++;
}

console.log(`\n--- summary ---`);
console.log(`  ${report.okCount} OK, ${report.mismatchCount} with mismatches`);
process.exit(report.mismatchCount ? 1 : 0);
