"use strict";
// Look at the actual bytes at the locator-reported matrix base for ANT T1.
// Dump the first 10 cells of row 5 (smOrder antigonid) and see if any of
// them look like real cell data (0, key, 200, att, flag pattern).
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

const dip = xtras.parseDiplomacyMatrix(buf, smOrder);
const { base, stride, N, C, key } = dip._meta;
console.log(`base=${base} stride=${stride} key=${key}`);

// Per the code comment: cell = [u32 0, u32 key, u32 200, u32 attitude, u32 flag]
// So at base, the first cell (row 0, col 0) should have these markers.
console.log("\nFirst 5 cells from base (row 0):");
for (let B = 0; B < 5; B++) {
  const o = base + B * stride;
  console.log(`  cell(0,${B}) @ ${o}: bytes=${buf.slice(o, o + 24).toString("hex")}`);
  console.log(`    u32s: ${[0,4,8,12,16,20].map(d => buf.readUInt32LE(o+d)).join(",")}`);
}

console.log("\nRow 5 (smOrder antigonid) — first 10 cells:");
for (let B = 0; B < 10; B++) {
  const o = base + (5 * N + B) * stride;
  const u = [0,4,8,12,16].map(d => buf.readUInt32LE(o+d));
  console.log(`  (5,${B}) o=${o}  +0=${u[0]} +4=${u[1]} +8=${u[2]} +12=${u[3]} +16=${u[4]}  smB=${smOrder[B]}`);
}

// Search ALL cells in the matrix for the specific pattern: att=600 + adjacent
// to a specific faction. Antigonid → epirus should have att=600.
// Find (anything, epirus_idx=98) cells where att=600.
console.log("\nSearch: ALL cells where col=98 (epirus) and att=600:");
for (let A = 0; A < N; A++) {
  const o = base + (A * N + 98) * stride;
  if (o + 20 > buf.length) continue;
  const att = buf.readUInt32LE(o + 4);
  if (att === 600) {
    const bond = buf.readUInt32LE(o + 12);
    const agg = buf.readInt32LE(o + 16);
    console.log(`  row=${A} (sm=${smOrder[A]||'?'}) att=600 bond=${bond} agg=${agg}`);
  }
}

// Same for col=102 (galatians)
console.log("\nSearch: ALL cells where col=102 (galatians) and att=600:");
for (let A = 0; A < N; A++) {
  const o = base + (A * N + 102) * stride;
  if (o + 20 > buf.length) continue;
  const att = buf.readUInt32LE(o + 4);
  if (att === 600) {
    const bond = buf.readUInt32LE(o + 12);
    console.log(`  row=${A} (sm=${smOrder[A]||'?'}) att=600 bond=${bond}`);
  }
}

// Find rows that have att=600 in BOTH cols 98 and 102 (the rows at war with BOTH epirus and galatians)
console.log("\nRows at war with BOTH epirus (98) and galatians (102) [att=600 in both]:");
for (let A = 0; A < N; A++) {
  const oE = base + (A * N + 98) * stride;
  const oG = base + (A * N + 102) * stride;
  if (oE + 20 > buf.length || oG + 20 > buf.length) continue;
  if (buf.readUInt32LE(oE + 4) === 600 && buf.readUInt32LE(oG + 4) === 600) {
    console.log(`  row=${A} (sm=${smOrder[A]||'?'})`);
  }
}
