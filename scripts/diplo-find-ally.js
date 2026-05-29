"use strict";
// Scan EVERY cell in the 239×239 diplomacy matrix for bond=54 (= alliance).
// In a symmetric alliance Julii ↔ cisalpine_boii there should be exactly 2
// cells with bond=54: (Julii_row, ally_col) and (ally_row, Julii_col). Their
// row/column indices tell us the matrix's true ordering.
const fs = require("fs");
const xtras = require("../src/saveCrackerExtras.js");

const SAVE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_Julii turn7.sav";
const SM   = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
const buf  = fs.readFileSync(SAVE);

const smOrder = [];
for (const line of fs.readFileSync(SM, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\t"([a-z_0-9]+)":/);
  if (m) smOrder.push(m[1]);
}
console.log(`smOrder N=${smOrder.length}`);

const diplo = xtras.parseDiplomacyMatrix(buf, smOrder);
const { base, stride, N, C } = diplo._meta;
console.log(`matrix base=${base} stride=${stride} N=${N} C=${C}`);

// Walk every cell, list all that have bond=54.
const bond54 = [];
for (let A = 0; A < N; A++) {
  for (let B = 0; B < N; B++) {
    const o = base + (A * N + B + C) * stride;
    if (o + 20 > buf.length) continue;
    if (buf.readUInt32LE(o + 12) === 54) {
      bond54.push({
        A, B,
        att: buf.readUInt32LE(o + 4),
        bond: buf.readUInt32LE(o + 12),
        agg: buf.readInt32LE(o + 16),
        smA: smOrder[A], smB: smOrder[B],
      });
    }
  }
}
console.log(`\nFound ${bond54.length} cells with bond=54:`);
for (const c of bond54) {
  console.log(`  A=${c.A} B=${c.B}  att=${c.att} agg=${c.agg}   smOrder labels: ${c.smA} -> ${c.smB}`);
}

// Find Julii's row index by finding which row has a unique distinctive pattern.
// Test: scan every row looking for one that has the same 4 att=600 cells we
// saw earlier (ingauni, mauri, pentapolis, salluvii) — those were Julii's
// initial hostilities in source descr_strat.
console.log("\nSearching for Julii's actual row (the one with 4+ att=600 cells)...");
for (let A = 0; A < N; A++) {
  let count600 = 0;
  for (let B = 0; B < N; B++) {
    const o = base + (A * N + B + C) * stride;
    if (o + 20 > buf.length) continue;
    if (buf.readUInt32LE(o + 4) === 600) count600++;
  }
  if (count600 >= 3) console.log(`  A=${A} (smOrder=${smOrder[A]}) has ${count600} att=600 cells`);
}
