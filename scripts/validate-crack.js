// scripts/validate-crack.js — corpus regression harness for the save parsers.
//
// Runs crackSave across the full RIS save corpus and asserts a battery of
// ground-truth invariants (treasuries, family, diplomacy, faction-knowledge,
// settlement growth roll-forward, events). One command to confirm none of the
// shipped parsers (family / siege / event / settlementFields / eventSchedule /
// scriptCounters / factionKnowledge / diplomacy / treasury) have regressed.
//
// Saves aren't committed, so this is a manual harness (not CI). Run:
//   node scripts/validate-crack.js [--mod <modDataDir>] [--saves <dir>]
// Exit code 0 if all checks pass, 1 otherwise.

"use strict";
const fs = require("fs");
const path = require("path");
const { crackSave } = require("../src/saveCracker.js");

const argv = process.argv.slice(2);
const getArg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const MOD = getArg("--mod", "C:\\RIS\\RIS\\data");
const SAVES = getArg("--saves", "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves");

let pass = 0, fail = 0, skip = 0;
function check(name, cond, detail) {
  if (cond === null) { skip++; console.log(`  SKIP ${name}${detail ? "  — " + detail : ""}`); return; }
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? "  — " + detail : ""}`); }
}

// Cache cracked saves by filename.
const cache = {};
function crack(file) {
  if (file in cache) return cache[file];
  const p = path.join(SAVES, file);
  if (!fs.existsSync(p)) return (cache[file] = null);
  try { return (cache[file] = crackSave(fs.readFileSync(p), MOD)); }
  catch (e) { console.log(`  (crack threw on ${file}: ${e.message})`); return (cache[file] = false); }
}

function run() {
  console.log(`=== crackSave corpus regression — mod=${MOD}\n    saves=${SAVES} ===`);

  // --- robustness: no save crashes ---
  console.log("\n[robustness]");
  const allFiles = ["save_julii1.sav", "save_julii2.sav", "save_julii3.sav",
    "save_Carthage1.sav", "save_carthage2.sav", "save_carthage3.sav"];
  for (const f of allFiles) {
    const r = crack(f);
    check(`crack ${f}`, r === null ? null : !!r, r === false ? "threw" : "missing");
  }

  // --- treasury ground truth ---
  console.log("\n[treasury]");
  const TREAS = {
    "save_julii1.sav": ["romans_julii", 17500], "save_julii2.sav": ["romans_julii", 7268], "save_julii3.sav": ["romans_julii", 5485],
    "save_Carthage1.sav": ["carthage", 25500], "save_carthage2.sav": ["carthage", 34381], "save_carthage3.sav": ["carthage", 43075],
  };
  for (const [f, [fac, exp]] of Object.entries(TREAS)) {
    const r = crack(f); if (!r) { check(`treasury ${f}`, null, "no save"); continue; }
    const got = r.factions[fac] && r.factions[fac].treasury;
    check(`treasury ${fac} ${f} == ${exp}`, got === exp, `got ${got}`);
  }

  // --- turn + player + faction count ---
  console.log("\n[meta]");
  for (const [f, [fac]] of Object.entries(TREAS)) {
    const r = crack(f); if (!r) continue;
    check(`${f} player == ${fac}`, r.playerFaction === fac, `got ${r.playerFaction}`);
    check(`${f} factions == 239`, r._stats.factions === 239, `got ${r._stats.factions}`);
  }

  // --- family ground truth (julii1) ---
  console.log("\n[family]");
  const j1 = crack("save_julii1.sav");
  if (j1) {
    const fam = j1.characters.family || [];
    const names = new Set(fam.map((m) => m.firstName));
    for (const w of ["Baebiana", "Alypia", "Dryantilla", "Papiria", "Prisca", "Honoria"])
      check(`julii1 family has ${w}`, names.has(w));
    check("julii1 family count > 1000", fam.length > 1000, `got ${fam.length}`);
    // spouse reciprocity among in-table pairs
    const byU = new Map(fam.map((m) => [m.uuid >>> 0, m]));
    let pairs = 0, recip = 0;
    for (const m of fam) { if (m.spouseUuid) { const s = byU.get(m.spouseUuid >>> 0); if (s) { pairs++; if ((s.spouseUuid >>> 0) === (m.uuid >>> 0)) recip++; } } }
    check("julii1 spouse reciprocity 100%", pairs > 10 && recip === pairs, `${recip}/${pairs}`);
  }

  // --- diplomacy: julii T1 wars only rebels/placeholders (italics folded) ---
  console.log("\n[diplomacy]");
  if (j1) {
    const d = j1.diplomacy.romans_julii;
    check("julii1 diplomacy matrix located", j1.diplomacy._meta && j1.diplomacy._meta.symmetry >= 0.99, `sym ${j1.diplomacy._meta?.symmetry}`);
    check("julii1 war list excludes real factions", d.war.every((w) => /(_rebels|^slave$|^rebels$|^dummies$|^italics$)/.test(w) || w === "italics"), `war=${d.war.join(",")}`);
    check("julii1 protectorates == 6", (d.protectorates || []).length === 6, `got ${(d.protectorates || []).length}`);
  }

  // --- faction knowledge (julii1) ---
  console.log("\n[knowledge]");
  if (j1) check("julii1 factionsWithTail == 107", j1._stats.factionsWithKnowledge === 107, `got ${j1._stats.factionsWithKnowledge}`);

  // --- settlement growth roll-forward: julii2.projected(Rome) == julii3.committed(Rome) ---
  console.log("\n[settlement growth]");
  const j2 = crack("save_julii2.sav"), j3 = crack("save_julii3.sav");
  if (j2 && j3 && j2.settlementFields.Rome && j3.settlementFields.Rome) {
    check("Rome pop roll-forward (j2.projected == j3.committed)",
      j2.settlementFields.Rome.projectedPopulation === j3.settlementFields.Rome.committedPopulation,
      `${j2.settlementFields.Rome.projectedPopulation} vs ${j3.settlementFields.Rome.committedPopulation}`);
  }

  // --- events (julii3 has a populated, well-typed log) ---
  console.log("\n[events]");
  if (j3) {
    check("julii3 events > 100", (j3.events || []).length > 100, `got ${(j3.events || []).length}`);
    check("julii3 events all faction-tagged", (j3.events || []).every((e) => typeof e.subject === "string"));
  }

  console.log(`\n========================================\nTOTAL: ${pass} PASS / ${fail} FAIL / ${skip} SKIP\n========================================`);
  process.exit(fail > 0 ? 1 : 0);
}

run();
