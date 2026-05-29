"use strict";
// Smart war-declaration diff: Spain T4 Start (no war with Carthage) vs
// Spain T4 attack Carthage army (war just declared).
// Focus on bytes that look like diplomatic-state transitions.
const fs = require("fs");
const path = require("path");
const xtras = require("../src/saveCrackerExtras.js");

const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const BEFORE = fs.readFileSync(path.join(SAVE_DIR, "save_Autosave   Spain   Turn 4 Start.sav"));
const AFTER  = fs.readFileSync(path.join(SAVE_DIR, "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav"));

console.log(`BEFORE=${BEFORE.length}  AFTER=${AFTER.length}`);

// Step 1: locate the diplomacy matrix in BOTH saves and check Spain row's
// Carthage column for att change.
const SM = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
const smOrder = [];
for (const line of fs.readFileSync(SM, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\t"([a-z_0-9]+)":/);
  if (m) smOrder.push(m[1]);
}
console.log(`smOrder N=${smOrder.length}`);

const dipB = xtras.parseDiplomacyMatrix(BEFORE, smOrder);
const dipA = xtras.parseDiplomacyMatrix(AFTER, smOrder);
if (!dipB || !dipA) { console.log("matrix not found in one save"); process.exit(1); }
console.log("BEFORE meta:", dipB._meta);
console.log("AFTER  meta:", dipA._meta);

// Find ALL cells that changed between the two matrices (aligned by smOrder)
const { base: bB, stride: sB, N: nB } = dipB._meta;
const { base: bA, stride: sA, N: nA } = dipA._meta;
console.log(`\n=== ALL diplomacy matrix cells that changed ===`);
if (nB !== nA) { console.log(`!!!  matrix dimensions differ`); process.exit(1); }
const changes = [];
for (let A = 0; A < nB; A++) {
  for (let B2 = 0; B2 < nB; B2++) {
    const oB = bB + (A * nB + B2) * sB;
    const oA = bA + (A * nA + B2) * sA;
    if (oB + 20 > BEFORE.length || oA + 20 > AFTER.length) continue;
    const attB = BEFORE.readUInt32LE(oB + 4);
    const bondB = BEFORE.readUInt32LE(oB + 12);
    const aggB = BEFORE.readInt32LE(oB + 16);
    const attA = AFTER.readUInt32LE(oA + 4);
    const bondA = AFTER.readUInt32LE(oA + 12);
    const aggA = AFTER.readInt32LE(oA + 16);
    if (attB !== attA || bondB !== bondA || aggB !== aggA) {
      changes.push({ A, B: B2, smA: smOrder[A], smB: smOrder[B2], attB, attA, bondB, bondA, aggB, aggA });
    }
  }
}
console.log(`total changed cells: ${changes.length}`);
for (const c of changes.slice(0, 30)) {
  console.log(`  ${c.smA.padEnd(20)} → ${c.smB.padEnd(20)}  att:${c.attB}→${c.attA}  bond:${c.bondB}→${c.bondA}  agg:${c.aggB}→${c.aggA}`);
}
