"use strict";
const fs = require("fs");
const path = require("path");
const { crackSave } = require("../src/saveCracker.js");

const SAVE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_Julii turn7.sav";
const buf = fs.readFileSync(SAVE);
const r = crackSave(buf, "C:\\RIS\\RIS\\data");

const byFac = {};
for (const [city, owner] of Object.entries(r.ownerByCity)) byFac[owner] = (byFac[owner] || 0) + 1;

console.log("All factions with 1-3 provinces (protectorate candidates):");
const small = Object.entries(byFac)
  .filter(([f, n]) => n >= 1 && n <= 3 && f !== "slave" && f !== "dummies" && f !== "romans_julii")
  .sort((a, b) => b[1] - a[1]);
let sum = 0;
for (const [f, n] of small) { console.log(`  ${f.padEnd(22)} ${n}`); sum += n; }
console.log(`TOTAL provinces in 1-3 bucket (excluding slave/dummies/julii): ${sum} across ${small.length} factions`);

console.log("\nThe 3 roman factions:");
for (const f of ["roman_rebels_1", "roman_rebels_2", "roman_senate"]) {
  console.log(`  ${f.padEnd(22)} ${byFac[f] || 0}`);
}
