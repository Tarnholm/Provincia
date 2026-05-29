"use strict";
const fs = require("fs");
const path = require("path");
const { crackSave } = require("../src/saveCracker.js");

const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const savePath = path.join(SAVE_DIR, "save_Julii turn7.sav");
const modDir = "C:\\RIS\\RIS\\data";

const buf = fs.readFileSync(savePath);
console.log(`save bytes: ${buf.length}`);

const result = crackSave(buf, modDir);

console.log("\n== KEYS ==");
console.log(Object.keys(result).sort().join(", "));

console.log("\n== HEADER ==");
console.log("player:", result.playerFaction);
console.log("turn:", result.saveDate && result.saveDate.turn,
            result.saveDate && result.saveDate.season,
            result.saveDate && result.saveDate.year);
console.log("header:", JSON.stringify(result.header, null, 2));
console.log("treasuriesRaw count:", result.treasuriesRaw ? result.treasuriesRaw.length : "n/a");
if (result.treasuriesRaw && result.treasuriesRaw.length) {
  console.log("treasuriesRaw[0..3]:", JSON.stringify(result.treasuriesRaw.slice(0, 3), null, 2));
}

console.log("\n== FACTIONS ==");
if (result.factions) {
  console.log("count:", Object.keys(result.factions).length);
  console.log("first entry:", JSON.stringify(result.factions[Object.keys(result.factions)[0]], null, 2));
  console.log("\nJulii entry:", JSON.stringify(result.factions.romans_julii, null, 2));
}

console.log("\n== REGIONS OWNED ==");
if (result.ownerByCity) {
  const byFac = {};
  for (const [city, owner] of Object.entries(result.ownerByCity)) {
    byFac[owner] = (byFac[owner] || 0) + 1;
  }
  for (const [f, n] of Object.entries(byFac).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${f.padEnd(22)} ${n}`);
  }
}

console.log("\n== CHARACTERS ==");
console.log("typeof result.characters:", typeof result.characters, Array.isArray(result.characters) ? `array len=${result.characters.length}` : "");
if (result.characters && typeof result.characters === "object" && !Array.isArray(result.characters)) {
  console.log("keys:", Object.keys(result.characters).join(", "));
}

console.log("\n== JULII FACTION DEEP ==");
const julii = result.factions && result.factions.romans_julii;
if (julii) {
  console.log("keys:", Object.keys(julii).join(", "));
  if (julii.characters) {
    console.log("characters:", Array.isArray(julii.characters) ? `array len=${julii.characters.length}` : Object.keys(julii.characters));
  }
}

console.log("\n== DIPLOMACY META ==");
if (result.diplomacy && result.diplomacy._meta) {
  console.log(JSON.stringify(result.diplomacy._meta, null, 2));
}
console.log("\n== Julii FULL diplomacy cells ==");
// Re-run the per-cell reader for every faction to get att/bond/agg, not just
// the classified result. Need direct buffer access.
const xtras = require("../src/saveCrackerExtras.js");
const fs2 = require("fs");
const buf2 = fs2.readFileSync(savePath);
const meta = result.diplomacy && result.diplomacy._meta;
if (meta && result.diplomacy.romans_julii) {
  // Build engine order from playable list (saveCracker uses this).
  const engineOrder = xtras.deriveEngineFactionOrder(
    require("../src/saveCracker.js").__test_readPlayableFromStrat
      ? require("../src/saveCracker.js").__test_readPlayableFromStrat(modDir)
      : []
  );
}
// Easier: replicate parseDiplomacyMatrix's cell read for the Julii row only.
const { base, stride, key, C, N } = meta;
// The matrix is [N x N], cell at (a,b) = base + (a*N + b)*stride.
// We need Julii's row → need Julii's index in the engine order.
// Re-parse cells directly and bucket by att value to see distribution.
function readCell(buf, base, N, stride, a, b) {
  const o = base + (a * N + b) * stride;
  return { att: buf.readUInt32LE(o + 4), bond: buf.readUInt32LE(o + 12), agg: buf.readInt32LE(o + 16) };
}
// Need Julii's row index. Faction list comes from engine order. Try to infer
// from playable + slave injection.
const stratPath = require("path").join(modDir, "world/maps/campaign/imperial_campaign/descr_strat.txt");
const stratText = fs2.readFileSync(stratPath, "utf8");
const playables = [];
{
  let inBlock = false;
  for (const raw of stratText.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "playable") { inBlock = true; continue; }
    if (inBlock && line === "end") break;
    if (inBlock && !line.startsWith(";") && line) playables.push(line);
  }
}
const factionList = require("../src/saveCrackerExtras.js").deriveEngineFactionOrder(
  // saveCrackerExtras wants stratOrder which is the FULL faction list from descr_strat.
  // Extract every `faction X` line for full order.
  (() => {
    const out = [];
    for (const line of stratText.split(/\r?\n/)) {
      const m = line.match(/^\s*faction\s+([a-z_0-9]+)/i);
      if (m && !out.includes(m[1])) out.push(m[1]);
    }
    return out;
  })()
);
const julIdx = factionList.indexOf("romans_julii");
console.log(`Julii idx in engineOrder = ${julIdx}, N=${N}`);
if (julIdx !== -1 && meta) {
  console.log("\n  === Julii ROW (Julii's view of others) — non-default cells ===");
  for (let b = 0; b < N; b++) {
    const c = readCell(buf2, base, N, stride, julIdx, b);
    if (c.att !== 200 || c.bond !== 6 || c.agg !== 170) {
      console.log(`    -> ${(factionList[b]||'?').padEnd(22)} att=${c.att} bond=${c.bond} agg=${c.agg}`);
    }
  }
  console.log("\n  === Julii COLUMN (others' view of Julii) — non-default cells ===");
  for (let a = 0; a < N; a++) {
    if (a === julIdx) continue;
    const c = readCell(buf2, base, N, stride, a, julIdx);
    if (c.att !== 200 || c.bond !== 6 || c.agg !== 170) {
      console.log(`    <- ${(factionList[a]||'?').padEnd(22)} att=${c.att} bond=${c.bond} agg=${c.agg}`);
    }
  }
}
