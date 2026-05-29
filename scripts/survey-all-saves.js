"use strict";
// Survey every save file we have — extract player, turn, and treasury for
// each. Group by (faction, turn) to find comparison opportunities.
const fs = require("fs");
const path = require("path");
const { crackSave } = require("../src/saveCracker.js");

const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const files = fs.readdirSync(SAVE_DIR).filter(f => f.endsWith(".sav"));

console.log(`${"file".padEnd(75)} ${"player".padEnd(15)} ${"turn".padEnd(5)} ${"treas".padEnd(8)} regs`);
const results = [];
for (const f of files) {
  const p = path.join(SAVE_DIR, f);
  const stat = fs.statSync(p);
  try {
    const buf = fs.readFileSync(p);
    const r = crackSave(buf, "C:\\RIS\\RIS\\data");
    const pf = r.playerFaction;
    const pfac = pf ? r.factions[pf] : null;
    const treas = pfac ? pfac.treasury : "?";
    const regs = pfac ? pfac.regionCount : "?";
    console.log(`${f.padEnd(75)} ${(pf||"?").padEnd(15)} ${(r.turn||"?").toString().padEnd(5)} ${treas.toString().padEnd(8)} ${regs}`);
    results.push({ file: f, player: pf, turn: r.turn, treasury: treas, regions: regs, sz: stat.size });
  } catch (e) {
    console.log(`${f.padEnd(75)} ERROR: ${e.message}`);
  }
}

// Group by (player, turn)
const groups = {};
for (const r of results) {
  if (!r.player || !r.turn) continue;
  const k = `${r.player}@T${r.turn}`;
  (groups[k] ||= []).push(r.file);
}
console.log("\n=== groups with multiple saves (potential diff pairs) ===");
for (const [k, files] of Object.entries(groups)) {
  if (files.length > 1) console.log(`  ${k}: ${files.join(" | ")}`);
}
