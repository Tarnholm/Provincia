"use strict";
const fs = require("fs");
const path = require("path");
const xtras = require("../src/saveCrackerExtras.js");

const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const SAVES = [
  { name: "T1 ", file: "save_Bactria turn1.sav" },
  { name: "T2 ", file: "save_Bactria turn2.sav" },
  { name: "T3S", file: "save_Autosave   Bactria   Turn 3 Start.sav" },
];

const SM = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
const smOrder = [];
for (const line of fs.readFileSync(SM, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\t"([a-z_0-9]+)":/);
  if (m) smOrder.push(m[1]);
}
const idxOf = (n) => smOrder.indexOf(n);
console.log(`indices: bactria=${idxOf("bactria")} antigonid=${idxOf("antigonid")} ptolemaic=${idxOf("ptolemaic")} seleucid=${idxOf("seleucid")}`);

// Find every row/col combination that's bond=54 across all 3 saves
console.log("\n=== ALL bond=54 cells in each save (att=0 = ally) ===");
for (const s of SAVES) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, s.file));
  const diplo = xtras.parseDiplomacyMatrix(buf, smOrder);
  if (!diplo) { console.log(`${s.name} no matrix`); continue; }
  const { base, stride, N, C, key } = diplo._meta;
  console.log(`\n${s.name} base=${base} key=${key} stride=${stride} N=${N}`);
  // List all cells with bond=54 — limit to relevant rows
  for (const rowName of ["bactria", "antigonid", "ptolemaic", "seleucid"]) {
    const A = idxOf(rowName);
    const cells = [];
    for (let B = 0; B < N; B++) {
      const o = base + (A * N + B + C) * stride;
      if (o + 20 > buf.length) continue;
      const att = buf.readUInt32LE(o + 4);
      const bond = buf.readUInt32LE(o + 12);
      if (bond === 54 && att === 0) cells.push(smOrder[B]);
    }
    console.log(`  ${rowName.padEnd(12)} ally cells: [${cells.join(", ")}]`);
  }
}
