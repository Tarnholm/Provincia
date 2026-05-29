"use strict";
// Run crackSave on every save we have and validate turn + treasury.
const fs = require("fs");
const path = require("path");
const { crackSave } = require("../src/saveCracker.js");

const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const SAVES = [
  { name: "T1   Julii", file: "save_Autosave   Republic of Rome   Turn 1.sav", expTurn: 1,  expPlayer: "romans_julii" },
  { name: "T6E  Julii", file: "save_Autosave   Republic of Rome   Turn 6 End.sav", expTurn: 6,  expPlayer: "romans_julii" },
  { name: "T7S  Julii", file: "save_Autosave   Republic of Rome   Turn 7 Start.sav", expTurn: 7,  expPlayer: "romans_julii" },
  { name: "T7   Julii", file: "save_Julii turn7.sav", expTurn: 7,  expPlayer: "romans_julii", expTreasury: 23856 },
  { name: "T20S Dummies", file: "save_Autosave   Dummies   Turn 20 Start.sav", expTurn: 20, expPlayer: "dummies" },
  { name: "T20  Dummies", file: "save_Autosave   Dummies   Turn 20 End.sav", expTurn: 20, expPlayer: "dummies" },
  { name: "T3   Bactria", file: "save_Autosave   Bactria   Turn 3.sav", expTurn: 3,  expPlayer: "bactria" },
];

console.log(`${"save".padEnd(18)} ${"player".padEnd(15)} ${"turn(parsed/expected)".padEnd(22)} ${"Julii$".padEnd(10)} ${"OK?"}`);
for (const s of SAVES) {
  const p = path.join(SAVE_DIR, s.file);
  if (!fs.existsSync(p)) { console.log(`${s.name.padEnd(18)} <missing>`); continue; }
  const buf = fs.readFileSync(p);
  try {
    const r = crackSave(buf, "C:\\RIS\\RIS\\data");
    const turn = r.turn;
    const julii = r.factions.romans_julii;
    const okPlayer = r.playerFaction === s.expPlayer ? "✓" : `✗(got ${r.playerFaction})`;
    const okTurn = turn === s.expTurn ? "✓" : `✗`;
    const okTreas = s.expTreasury ? (julii.treasury === s.expTreasury ? "✓" : `✗(got ${julii.treasury})`) : "-";
    console.log(`${s.name.padEnd(18)} ${(r.playerFaction||"?").padEnd(15)} ${(turn + "/" + s.expTurn).padEnd(22)} ${(julii.treasury||"?").toString().padEnd(10)} player:${okPlayer} turn:${okTurn} treasury:${okTreas}`);
  } catch (e) {
    console.log(`${s.name.padEnd(18)} ERROR: ${e.message}`);
  }
}
