"use strict";
const fs = require("fs");
const path = require("path");
const { crackSave } = require("../src/saveCracker.js");

const SAVE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_Autosave   Dummies   Turn 20 End.sav";
const buf = fs.readFileSync(SAVE);
const r = crackSave(buf, "C:\\RIS\\RIS\\data");
console.log("player:", r.playerFaction);
console.log("turn:", r.turn);
console.log("dummies factions:", JSON.stringify(r.factions.dummies, null, 2));
console.log("first 3 factions (by descrOrder pos):");
const stratOrder = Object.keys(r.factions);
for (const name of stratOrder.slice(0, 3)) {
  console.log(`  ${name}: treasury=${r.factions[name].treasury} regionCount=${r.factions[name].regionCount}`);
}
