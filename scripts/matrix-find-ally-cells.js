"use strict";
// Source descr_strat has explicit non-default core_attitudes between SOME
// faction pairs. Find ALL bond=54 cells in the ANT T1 matrix and see if any
// pair matches a known source ally pair.
// Known: seleucid <-> antigonid should be allied per old test
//        antigonid <-> cabyle, knossos, messene, athens also allied
// Pick the alliance pair, find that cell, and verify which row/col indices
// it sits at.
const fs = require("fs");
const path = require("path");
const xtras = require("../src/saveCrackerExtras.js");

const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const buf = fs.readFileSync(path.join(SAVE_DIR, "save_antigonid turn1.sav"));

const SM = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
const smOrder = [];
for (const line of fs.readFileSync(SM, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\t"([a-z_0-9]+)":/);
  if (m) smOrder.push(m[1]);
}
const idxOf = (n) => smOrder.indexOf(n);

const dip = xtras.parseDiplomacyMatrix(buf, smOrder);
const { base, stride, N, C } = dip._meta;
console.log(`base=${base} stride=${stride} N=${N}`);

// Get ALL bond=54 cells (potential allies) with their row/col indices.
console.log("\n=== ALL bond=54 + att=0 cells in matrix (allies) ===");
const allies = [];
for (let A = 0; A < N; A++) {
  for (let B = 0; B < N; B++) {
    const o = base + (A * N + B + C) * stride;
    if (o + 20 > buf.length) continue;
    if (buf.readUInt32LE(o + 12) === 54 && buf.readUInt32LE(o + 4) === 0) {
      allies.push({ A, B, smA: smOrder[A], smB: smOrder[B] });
    }
  }
}
console.log(`total ally cells: ${allies.length}`);

// Find SYMMETRIC pairs (both A->B and B->A are allied)
const set = new Set(allies.map(a => `${a.A},${a.B}`));
const sym = [];
for (const a of allies) {
  if (a.A < a.B && set.has(`${a.B},${a.A}`)) sym.push(a);
}
console.log(`symmetric ally pairs: ${sym.length}`);
console.log("first 20 symmetric pairs (these are confirmed alliances by both sides):");
for (const a of sym.slice(0, 20)) {
  console.log(`  row=${a.A.toString().padStart(3)} sm=${a.smA.padEnd(20)} <-> row=${a.B.toString().padStart(3)} sm=${a.smB}`);
}

// Filter to pairs that should be REAL alliances from source descr_strat
// Source says: antigonid <-> seleucid allied  (att=-10 both ways, bond=54 means ally treaty signed)
// Source says: ptolemaic <-> egypt are protectorates? Actually let me grep
console.log("\n=== Source descr_strat 'allied' / 'protected' lines ===");
const STRAT = "C:\\RIS\\RIS\\data\\world\\maps\\campaign\\imperial_campaign\\descr_strat.txt";
for (const line of fs.readFileSync(STRAT, "utf8").split(/\r?\n/)) {
  if (/^faction_relationships/.test(line.trim())) console.log("  " + line.trim());
}
