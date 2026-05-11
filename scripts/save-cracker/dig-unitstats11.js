// dig-unitstats11.js — Now that we know 9 bytes/soldier, find:
// 1. The exact array start (+28 from regionEnd) and array length = 9*max.
// 2. The trailer bytes AFTER the soldier array but BEFORE the next unit's nameLen.
// 3. Compare BEFORE/AFTER for survivors at the trailer offsets — XP/armor/weapon should be in trailer.

const fs = require("fs");
const path = require("path");
const { findUnitRecords } = require("../../src/unitParser.js");

const ARCHIVE = "C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z";
const F_BEFORE = "0184_save_Autosave   Macedon   Turn 12 End.sav";
const F_AFTER = "0192_save_Autosave   Macedon   Turn 13 Start.sav";

const bBuf = fs.readFileSync(path.join(ARCHIVE, F_BEFORE));
const aBuf = fs.readFileSync(path.join(ARCHIVE, F_AFTER));

const before = findUnitRecords(bBuf);
const after = findUnitRecords(aBuf);

function key(u) { return `${u.name}|${u.region}|${u.commanderUuid || 0}`; }
const bMap = new Map(); for (const u of before) bMap.set(key(u), u);

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

// Now: for each survivor, soldier array starts at regionEnd+28, ends at regionEnd+28+9*max.
// Trailer is between that and the NEXT unit (or end of region). The trailer should hold XP/armor/weapon.

const survivors = [];
const fsControl = [];
const allMatched = [];
for (const u of after) {
  const ub = bMap.get(key(u));
  if (!ub) continue;
  if (u.soldiers === 0 || ub.soldiers === 0) continue;
  const bE = regionEnd(bBuf, ub);
  const aE = regionEnd(aBuf, u);
  if (bE < 0 || aE < 0) continue;
  const losses = ub.soldiers - u.soldiers;
  const item = { ub, u, bE, aE, losses };
  if (losses > 0) survivors.push(item);
  else fsControl.push(item);
  allMatched.push(item);
}

console.log(`Survivors: ${survivors.length}, Controls: ${fsControl.length}`);

// For each survivor, trailerStart = regionEnd + 28 + 9 * max
// Check bytes BEYOND the soldier array.
console.log(`\nProbe: bytes at trailer (relative to regionEnd + 28 + 9 * max):`);
const trailerStats = {};
for (let off = 0; off < 80; off++) {
  let survChange = 0, fsChange = 0;
  let smallVals = [];
  for (const s of survivors) {
    const bStart = s.bE + 28 + 9 * s.ub.maxSoldiers;
    const aStart = s.aE + 28 + 9 * s.u.maxSoldiers;
    if (bStart + off >= bBuf.length || aStart + off >= aBuf.length) continue;
    const bV = bBuf[bStart + off], aV = aBuf[aStart + off];
    if (bV !== aV) {
      survChange++;
      if (bV <= 9 && aV <= 9) smallVals.push(`${bV}→${aV}`);
    }
  }
  for (const s of fsControl) {
    const bStart = s.bE + 28 + 9 * s.ub.maxSoldiers;
    const aStart = s.aE + 28 + 9 * s.u.maxSoldiers;
    if (bStart + off >= bBuf.length || aStart + off >= aBuf.length) continue;
    if (bBuf[bStart + off] !== aBuf[aStart + off]) fsChange++;
  }
  if (survChange > 0 || fsChange > 0) {
    trailerStats[off] = { survChange, fsChange, smallVals };
  }
}
console.log("Trailer offset stats:");
for (const off of Object.keys(trailerStats).map(Number).sort((a, b) => a - b)) {
  const s = trailerStats[off];
  if (s.survChange > 0 || s.fsChange > 0) {
    console.log(`  trailer+${off}: ${s.survChange}/${survivors.length} surv, ${s.fsChange}/${fsControl.length} ctrl${s.smallVals.length ? ` small: ${s.smallVals.slice(0,5).join(", ")}` : ''}`);
  }
}

// Dump trailer for survivor 0
const s0 = survivors[0];
const bTrail = s0.bE + 28 + 9 * s0.ub.maxSoldiers;
const aTrail = s0.aE + 28 + 9 * s0.u.maxSoldiers;
console.log(`\nSurvivor 0 (${s0.u.name} ${s0.ub.region}, max=${s0.ub.maxSoldiers}, losses=${s0.losses})`);
console.log(`  bTrail = 0x${bTrail.toString(16)}, aTrail = 0x${aTrail.toString(16)}`);
console.log(`  Trailer dump (60 bytes):`);
let rowsB = "", rowsA = "", diff = "";
for (let i = 0; i < 60; i++) {
  const xb = bBuf[bTrail + i] || 0, xa = aBuf[aTrail + i] || 0;
  rowsB += xb.toString(16).padStart(2, "0") + " ";
  rowsA += xa.toString(16).padStart(2, "0") + " ";
  diff += (xb !== xa) ? "** " : ".. ";
  if (i % 16 === 15) {
    console.log(`    +${(i - 15).toString().padStart(3)}: B ${rowsB.trim()}`);
    console.log(`         A ${rowsA.trim()}`);
    console.log(`         D ${diff.trim()}`);
    rowsB = ""; rowsA = ""; diff = "";
  }
}
