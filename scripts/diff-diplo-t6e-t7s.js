"use strict";
// Diff diplomacy matrix between T6 End and T7 Start (full AI turn played).
// Looking for any cells that changed: AI declaring wars/sign treaties.
const fs = require("fs");
const path = require("path");
const xtras = require("../src/saveCrackerExtras.js");

const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const T6E = fs.readFileSync(path.join(SAVE_DIR, "save_Autosave   Republic of Rome   Turn 6 End.sav"));
const T7S = fs.readFileSync(path.join(SAVE_DIR, "save_Autosave   Republic of Rome   Turn 7 Start.sav"));

const SM = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
const smOrder = [];
for (const line of fs.readFileSync(SM, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\t"([a-z_0-9]+)":/);
  if (m) smOrder.push(m[1]);
}

const dipB = xtras.parseDiplomacyMatrix(T6E, smOrder);
const dipA = xtras.parseDiplomacyMatrix(T7S, smOrder);
if (!dipB || !dipA) { console.log("matrix not found"); process.exit(1); }
console.log("T6E meta:", dipB._meta);
console.log("T7S meta:", dipA._meta);

const { base: bB, stride: sB, N } = dipB._meta;
const { base: bA, stride: sA } = dipA._meta;
const changes = [];
for (let A = 0; A < N; A++) {
  for (let B2 = 0; B2 < N; B2++) {
    const oB = bB + (A * N + B2) * sB;
    const oA = bA + (A * N + B2) * sA;
    if (oB + 20 > T6E.length || oA + 20 > T7S.length) continue;
    const attB = T6E.readUInt32LE(oB + 4);
    const bondB = T6E.readUInt32LE(oB + 12);
    const aggB = T6E.readInt32LE(oB + 16);
    const attA = T7S.readUInt32LE(oA + 4);
    const bondA = T7S.readUInt32LE(oA + 12);
    const aggA = T7S.readInt32LE(oA + 16);
    if (attB !== attA || bondB !== bondA || aggB !== aggA) {
      changes.push({ A, B: B2, smA: smOrder[A], smB: smOrder[B2], attB, attA, bondB, bondA, aggB, aggA });
    }
  }
}
console.log(`\ntotal changed matrix cells: ${changes.length}`);
for (const c of changes.slice(0, 40)) {
  console.log(`  ${c.smA.padEnd(22)} → ${c.smB.padEnd(22)}  att:${c.attB}→${c.attA}  bond:${c.bondB}→${c.bondA}  agg:${c.aggB}→${c.aggA}`);
}

// Filter to cells where att or bond CHANGED to/from a meaningful value
console.log("\n=== changes involving att=600 (war indicator) ===");
const warChanges = changes.filter(c => c.attA === 600 || c.attB === 600);
for (const c of warChanges.slice(0, 40)) {
  console.log(`  ${c.smA.padEnd(22)} → ${c.smB.padEnd(22)}  att:${c.attB}→${c.attA}  bond:${c.bondB}→${c.bondA}  agg:${c.aggB}→${c.aggA}`);
}
console.log(`(${warChanges.length} total)`);

console.log("\n=== changes involving bond change (alliance/trade indicator) ===");
const bondChanges = changes.filter(c => c.bondA !== c.bondB);
for (const c of bondChanges.slice(0, 30)) {
  console.log(`  ${c.smA.padEnd(22)} → ${c.smB.padEnd(22)}  att:${c.attB}→${c.attA}  bond:${c.bondB}→${c.bondA}  agg:${c.aggB}→${c.aggA}`);
}
console.log(`(${bondChanges.length} bond changes total)`);

console.log("\n=== changes that ARE NOT just agg-by-20 increments ===");
const realChanges = changes.filter(c =>
  c.attA !== c.attB || c.bondA !== c.bondB || Math.abs(c.aggA - c.aggB) !== 20
);
console.log(`(${realChanges.length} meaningful changes — filtering out the global agg+20 noise)`);
for (const c of realChanges.slice(0, 40)) {
  console.log(`  ${c.smA.padEnd(22)} → ${c.smB.padEnd(22)}  att:${c.attB}→${c.attA}  bond:${c.bondB}→${c.bondA}  agg:${c.aggB}→${c.aggA}`);
}
