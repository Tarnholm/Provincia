// dig-unitstats17.js — Look at the unit header bytes for MID-CAMPAIGN saves to see
// if armor/weapon/XP values exist beyond starting values. Survey all units in T13 End
// for value distributions at +16, +17, +18, +19, +20, +21.

const fs = require("fs");
const path = require("path");
const { findUnitRecords } = require("../../src/unitParser.js");

const ARCHIVE = "C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z";
const F = "0199_save_Autosave   Macedon   Turn 13 End.sav";

const buf = fs.readFileSync(path.join(ARCHIVE, F));
const units = findUnitRecords(buf);

function regionEnd(buf, u) {
  const len = buf.readUInt16LE(u.offset);
  const ns = u.offset + 2, ne = ns + len - 1;
  for (let q = ne + 1; q < ne + 80; q++) {
    const rlen = buf[q];
    if (rlen < 3 || rlen > 50 || buf[q + 1] !== 0) continue;
    const rs = q + 2, re = rs + rlen * 2;
    if (re + 8 > buf.length) continue;
    let ok = true;
    for (let j = rs; j < re; j += 2) {
      if (buf[j + 1] !== 0 || buf[j] < 0x20 || buf[j] > 0x7e) { ok = false; break; }
    }
    if (!ok) continue;
    return re + 4;
  }
  return -1;
}

// Distribution of each byte
for (const off of [16, 17, 18, 19, 20, 21, 22, 23, 24, 25]) {
  const dist = new Map();
  for (const u of units) {
    const rE = regionEnd(buf, u);
    if (rE < 0) continue;
    const v = buf[rE + off];
    dist.set(v, (dist.get(v) || 0) + 1);
  }
  const sortedDist = [...dist.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`+${off}: ${sortedDist.slice(0, 8).map(([v, c]) => `${v}=${c}`).join(", ")}`);
}

// For each (name, +16, +17, +20) tuple, list units. Want to see if these track armor/weapon/XP.
console.log(`\nDistinct (name, +16=armor?, +17=weapon?, +20=xp) tuples:`);
const tuples = new Map();
for (const u of units) {
  const rE = regionEnd(buf, u);
  if (rE < 0) continue;
  const k = `${u.name}|${buf[rE+16]}|${buf[rE+17]}|${buf[rE+20]}`;
  tuples.set(k, (tuples.get(k) || 0) + 1);
}
const sortedTuples = [...tuples.entries()].sort((a, b) => b[1] - a[1]);
for (const [k, c] of sortedTuples.slice(0, 30)) {
  console.log(`  ${c.toString().padStart(3)}× ${k}`);
}

// Also check: distinct (name, +18, +19) tuples — to ensure +18, +19 are unit-class
// invariants. +19=64 for phalangists, =0 for everything else; we don't expect this to change.
console.log(`\nDistinct (name, +18, +19) tuples:`);
const tuples2 = new Map();
for (const u of units) {
  const rE = regionEnd(buf, u);
  if (rE < 0) continue;
  const k = `${u.name}|${buf[rE+18]}|${buf[rE+19]}`;
  tuples2.set(k, (tuples2.get(k) || 0) + 1);
}
const sortedT2 = [...tuples2.entries()].sort((a, b) => b[1] - a[1]);
for (const [k, c] of sortedT2.slice(0, 30)) {
  console.log(`  ${c.toString().padStart(3)}× ${k}`);
}
