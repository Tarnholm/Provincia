"use strict";
// Calibrate the diplomacy matrix locator using Antigonid 3-turn saves.
// Source descr_strat ground truth: Antigonid initial state has:
//   - att=600 with epirus, galatians (wars)
//   - att=0  bond=54 with seleucid (allied)
//   - probably also: bond=54 with cabyle, knossos, messene, athens (per old test)
// All 3 saves should show IDENTICAL bactria — er, ANTIGONID diplomacy state.
const fs = require("fs");
const path = require("path");
const xtras = require("../src/saveCrackerExtras.js");

const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const SAVES = [
  { name: "T1 ", file: "save_antigonid turn1.sav" },
  { name: "T2 ", file: "save_antigonid turn2.sav" },
  { name: "T3 ", file: "save_antigonid turn3.sav" },
];

const SM = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
const smOrder = [];
for (const line of fs.readFileSync(SM, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\t"([a-z_0-9]+)":/);
  if (m) smOrder.push(m[1]);
}
const idxOf = (n) => smOrder.indexOf(n);
console.log(`smOrder N=${smOrder.length}  antigonid=${idxOf("antigonid")} seleucid=${idxOf("seleucid")} epirus=${idxOf("epirus")} galatians=${idxOf("galatians")} ptolemaic=${idxOf("ptolemaic")}`);

// Read each save's descr_strat ground truth (the core_attitudes block)
const STRAT = "C:\\RIS\\RIS\\data\\world\\maps\\campaign\\imperial_campaign\\descr_strat.txt";
const stratText = fs.readFileSync(STRAT, "utf8");
console.log("\n=== source descr_strat core_attitudes mentioning antigonid (non-default) ===");
for (const line of stratText.split(/\r?\n/)) {
  if (/^core_attitudes\s+.*antigonid/i.test(line) || /^core_attitudes\s+antigonid/i.test(line)) {
    const t = line.trim();
    if (!/200\s+/.test(t)) console.log(`  ${t}`);
  }
}

// For each save, what's at expected positions?
console.log("\n=== Read specific cells in each save (using current locator + smOrder) ===");
const aIdx = idxOf("antigonid");
for (const s of SAVES) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, s.file));
  const dip = xtras.parseDiplomacyMatrix(buf, smOrder);
  if (!dip) { console.log(`${s.name} NO MATRIX`); continue; }
  const { base, stride, N, C, key } = dip._meta;
  console.log(`\n${s.name} base=${base} stride=${stride} key=${key} N=${N}`);
  // Print cells we expect to be specific values:
  for (const targetName of ["seleucid", "epirus", "galatians", "ptolemaic", "carthage", "cabyle", "knossos", "messene", "athens"]) {
    const B = idxOf(targetName);
    if (B < 0) continue;
    const o = base + (aIdx * N + B + C) * stride;
    if (o + 20 > buf.length) continue;
    const att = buf.readUInt32LE(o + 4);
    const bond = buf.readUInt32LE(o + 12);
    const agg = buf.readInt32LE(o + 16);
    console.log(`  ant -> ${targetName.padEnd(12)} att=${att} bond=${bond} agg=${agg}`);
  }
}
