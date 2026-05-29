"use strict";
// Re-read Julii's diplomacy row using descr_sm_factions.txt order (the
// canonical engine order), not descr_strat.txt order. The matrix N=239
// matches the descr_sm_factions count exactly.
const fs = require("fs");
const path = require("path");
const xtras = require("../src/saveCrackerExtras.js");

const SAVE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_Julii turn7.sav";
const SM   = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
const buf  = fs.readFileSync(SAVE);

// Parse descr_sm_factions for top-level faction names (single-tab indent).
const smOrder = [];
for (const line of fs.readFileSync(SM, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\t"([a-z_0-9]+)":/);
  if (m) smOrder.push(m[1]);
}
console.log(`smOrder length: ${smOrder.length}`);
console.log(`first 5: ${smOrder.slice(0, 5).join(", ")}`);
console.log(`last 5:  ${smOrder.slice(-5).join(", ")}`);

const diplo = xtras.parseDiplomacyMatrix(buf, smOrder);
if (!diplo) { console.log("no matrix"); process.exit(1); }
console.log("\nmeta:", diplo._meta);

const julii = diplo.romans_julii;
console.log("\nJulii row counts:");
console.log(`  war:    ${julii.war.length} -> ${julii.war.join(", ")}`);
console.log(`  allied: ${julii.allied.length} -> ${julii.allied.join(", ")}`);
console.log(`  hostile:${julii.hostile.length} -> ${julii.hostile.join(", ")}`);
console.log(`  trade:  ${julii.trade.length} -> ${julii.trade.join(", ")}`);

console.log("\nAll non-default cells (raw rel):");
for (const r of julii.rel) {
  console.log(`  ${r.to.padEnd(22)} att=${r.att} bond=${r.bond} agg=${r.agg}`);
}

// Now: scan Julii's row at ALL 239 positions, print every cell + the
// smOrder name at each position. Compare against descr_strat order labeling.
const { base, stride, N, C } = diplo._meta;
const stratPath = "C:\\RIS\\RIS\\data\\world\\maps\\campaign\\imperial_campaign\\descr_strat.txt";
const stratOrder = [];
for (const line of fs.readFileSync(stratPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*faction\s+([a-z_0-9]+)/i);
  if (m && !stratOrder.includes(m[1])) stratOrder.push(m[1]);
}
console.log(`\nstratOrder length: ${stratOrder.length}`);
const engineOrder = xtras.deriveEngineFactionOrder(stratOrder);
console.log(`engineOrder last 5: ${engineOrder.slice(-5).join(", ")}`);

console.log("\nNon-default cells in Julii row — labeled by BOTH orders:");
const A = smOrder.indexOf("romans_julii");
for (let B = 0; B < N; B++) {
  const o = base + (A * N + B + C) * stride;
  if (o + 20 > buf.length) continue;
  const att = buf.readUInt32LE(o + 4);
  const bond = buf.readUInt32LE(o + 12);
  const agg = buf.readInt32LE(o + 16);
  if (att === 200 && bond === 6 && agg === 170) continue;
  const smName = smOrder[B] || "?";
  const stratName = stratOrder[B] || "?";
  const engineName = engineOrder[B] || "?";
  console.log(`  B=${B}: att=${att} bond=${bond} agg=${agg}  sm=${smName} | strat=${stratName} | engine=${engineName}`);
}

console.log("\nspecific cell check: Julii -> cisalpine_boii");
const cb = smOrder.indexOf("cisalpine_boii");
console.log(`cisalpine_boii idx in smOrder: ${cb}`);
{
  const o = base + (A * N + cb + C) * stride;
  console.log(`  att=${buf.readUInt32LE(o+4)} bond=${buf.readUInt32LE(o+12)} agg=${buf.readInt32LE(o+16)}`);
}
