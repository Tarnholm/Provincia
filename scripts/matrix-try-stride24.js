"use strict";
// What if the matrix uses tightly packed 24-byte cells and stride=267 is wrong?
// Try reading the matrix as 24-byte cells, with row pitch = 24 * 239 = 5736.
const fs = require("fs");
const path = require("path");
const xtras = require("../src/saveCrackerExtras.js");

const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const SAVES = [
  { name: "ANT T1", file: "save_antigonid turn1.sav", player: "antigonid" },
  { name: "ANT T2", file: "save_antigonid turn2.sav", player: "antigonid" },
  { name: "ANT T3", file: "save_antigonid turn3.sav", player: "antigonid" },
  { name: "BAC T1", file: "save_Bactria turn1.sav", player: "bactria" },
];

const SM = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
const smOrder = [];
for (const line of fs.readFileSync(SM, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\t"([a-z_0-9]+)":/);
  if (m) smOrder.push(m[1]);
}
const idxOf = (n) => smOrder.indexOf(n);
const N = 239;
const CELL = 24;
const ROW = CELL * N; // 5736

// For each save, take locator-reported base, then try BOTH packings (stride=267 and stride=24/ROW=5736)
for (const s of SAVES) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, s.file));
  const dip = xtras.parseDiplomacyMatrix(buf, smOrder);
  if (!dip) { console.log(`${s.name} NO MATRIX`); continue; }
  const base = dip._meta.base;
  const playerIdx = idxOf(s.player);

  // Read player's row using stride=267
  const cells267 = [];
  for (let B = 0; B < N; B++) {
    const o = base + (playerIdx * N + B) * 267;
    if (o + 24 > buf.length) continue;
    const att = buf.readUInt32LE(o + 8);
    const bond = buf.readUInt32LE(o + 12);
    if (att !== 200 || bond !== 6) cells267.push({ B, smB: smOrder[B], att, bond });
  }
  // Read player's row using packed stride
  const cellsPack = [];
  for (let B = 0; B < N; B++) {
    const o = base + playerIdx * ROW + B * CELL;
    if (o + 24 > buf.length) continue;
    const att = buf.readUInt32LE(o + 8);
    const bond = buf.readUInt32LE(o + 12);
    if (att !== 200 || bond !== 6) cellsPack.push({ B, smB: smOrder[B], att, bond });
  }
  console.log(`\n${s.name} player=${s.player} idx=${playerIdx} base=${base}`);
  console.log(`  stride=267 non-default: ${cells267.map(c => `${c.smB}(att=${c.att},bond=${c.bond})`).join(", ")}`);
  console.log(`  packed24 non-default:   ${cellsPack.map(c => `${c.smB}(att=${c.att},bond=${c.bond})`).join(", ")}`);
}
