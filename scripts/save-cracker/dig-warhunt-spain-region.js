// dig-warhunt-spain-region.js
// Dump a byte region across ALL spain saves (pre + war) side by side so we can
// see exactly what flips on declaring war.
"use strict";
const fs = require("fs");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const ALL = [
  ["T2-trade", "save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav"],
  ["T3End-PRE", "save_Autosave   Spain   Turn 3 End.sav"],
  ["T4Start-PRE", "save_Autosave   Spain   Turn 4 Start.sav"],
  ["declareWAR", "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav"],
  ["besieged", "save_Autosave   Spain   Turn 4 besiged .sav"],
  ["T4-WAR", "save_Autosave   Spain   Turn 4.sav"],
];
const bufs = ALL.map(([t, f]) => { try { return [t, fs.readFileSync(SAVES_DIR + f)]; } catch { return [t, null]; } });

const start = parseInt(process.argv[2] || "11900", 16);
const len = parseInt(process.argv[3] || "0xc0", 16);

for (const [tag, b] of bufs) {
  if (!b) { console.log(`${tag.padEnd(12)} (missing)`); continue; }
  let line = `${tag.padEnd(12)} `;
  for (let o = start; o < start + len; o++) {
    line += (o < b.length ? b[o].toString(16).padStart(2, "0") : "--") + (((o - start) % 4 === 3) ? " " : "");
  }
  console.log(line);
}
