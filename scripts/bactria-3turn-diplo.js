"use strict";
const fs = require("fs");
const path = require("path");
const xtras = require("../src/saveCrackerExtras.js");
const { crackSave } = require("../src/saveCracker.js");

const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const SAVES = [
  { name: "T1", file: "save_Bactria turn1.sav" },
  { name: "T2", file: "save_Bactria turn2.sav" },
  { name: "T3S", file: "save_Autosave   Bactria   Turn 3 Start.sav" },
];

const SM = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
const smOrder = [];
for (const line of fs.readFileSync(SM, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\t"([a-z_0-9]+)":/);
  if (m) smOrder.push(m[1]);
}

// Run parser on each save
console.log("=== parser output per save ===");
const parsed = SAVES.map(s => {
  const buf = fs.readFileSync(path.join(SAVE_DIR, s.file));
  const r = crackSave(buf, "C:\\RIS\\RIS\\data");
  console.log(`\n${s.name}: player=${r.playerFaction} turn=${r.turn} treasury=${r.factions.bactria && r.factions.bactria.treasury}`);
  const d = r.diplomacy && r.diplomacy.bactria;
  if (d) {
    console.log(`  parser says: war=[${d.war.join(",")}], allied=[${d.allied.join(",")}], hostile=[${d.hostile.join(",")}], trade=[${d.trade.join(",")}]`);
  }
  return { ...s, buf, parsed: r };
});

// Show Bactria's non-default matrix cells at each turn
console.log("\n\n=== Bactria's row non-default cells per save ===");
for (const s of parsed) {
  const dipMeta = s.parsed.diplomacy && s.parsed.diplomacy._meta;
  if (!dipMeta) continue;
  const { base, stride, N, C } = dipMeta;
  const A = smOrder.indexOf("bactria");
  console.log(`\n${s.name} (matrix base=${base}, stride=${stride}, N=${N}):`);
  const nonDefault = [];
  for (let B = 0; B < N; B++) {
    const o = base + (A * N + B + C) * stride;
    if (o + 20 > s.buf.length) continue;
    const att = s.buf.readUInt32LE(o + 4);
    const bond = s.buf.readUInt32LE(o + 12);
    const agg = s.buf.readInt32LE(o + 16);
    if (att !== 200 || bond !== 6) {
      nonDefault.push({ B, smB: smOrder[B], att, bond, agg });
    }
  }
  for (const c of nonDefault.slice(0, 40)) {
    console.log(`  -> ${(c.smB||'?').padEnd(22)} att=${c.att} bond=${c.bond} agg=${c.agg}`);
  }
  console.log(`  (total ${nonDefault.length} non-default cells)`);
}
