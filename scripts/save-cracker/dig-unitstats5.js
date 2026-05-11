// dig-unitstats5.js — For all survivors in T12 End → T13 Start, find bytes at the SAME relative
// offset (relative to regionEnd) that change 0 → small positive (1..9) or any small change in [0..9] range.
// XP is u8 0..9; armor and weapon u8 0..3. These should show up as exact 0→K transitions.

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

// For each survivor pair, check bytes at relative offsets -20..+24 from regionEnd.
// Track: which offsets DIFFER between before/after, and what the differing values are.
const survivors = [];
for (const u of after) {
  const ub = bMap.get(key(u));
  if (!ub) continue;
  // Take SURVIVORS that lost at least some soldiers
  if (ub.soldiers > u.soldiers && u.soldiers > 0 && ub.soldiers > 0) {
    const bE = regionEnd(bBuf, ub);
    const aE = regionEnd(aBuf, u);
    if (bE >= 0 && aE >= 0) survivors.push({ ub, u, bE, aE });
  }
}

console.log(`Survivors with full record-ends: ${survivors.length}`);

// For each relative offset -20..+60, count how many survivors have a DIFFERENT byte
// before vs after, AND track if the value range is small (likely XP/armor/weapon).
const offsetStats = {};
for (let off = -20; off <= 60; off++) {
  let differCount = 0, anyChange = false;
  let smallTransitions = [];
  for (const s of survivors) {
    const bV = bBuf[s.bE + off], aV = aBuf[s.aE + off];
    if (bV !== aV) {
      differCount++;
      anyChange = true;
      if (bV <= 9 && aV <= 9) smallTransitions.push(`${bV}→${aV}`);
    }
  }
  offsetStats[off] = { differCount, smallTransitions };
}

// Print interesting offsets (small-value transitions or significant difference counts)
console.log(`\nOffset stats (from regionEnd):`);
for (let off = -20; off <= 60; off++) {
  const s = offsetStats[off];
  if (s.differCount === 0) continue;
  const sample = s.smallTransitions.slice(0, 8).join(", ");
  console.log(`  +${off.toString().padStart(3)}: ${s.differCount}/${survivors.length} changed ${sample ? `  small: ${sample}` : ''}`);
}

// Same for AFTER survivor 0+: check FULL-strength matched (no losses) units — they're the control.
// We want a byte that's STABLE for full-strength but CHANGES for survivors.
const fullStrengthControl = [];
for (const u of after) {
  const ub = bMap.get(key(u));
  if (!ub) continue;
  if (ub.soldiers === u.soldiers && ub.maxSoldiers === u.maxSoldiers && u.soldiers > 0) {
    const bE = regionEnd(bBuf, ub);
    const aE = regionEnd(aBuf, u);
    if (bE >= 0 && aE >= 0) fullStrengthControl.push({ ub, u, bE, aE });
  }
}
console.log(`\nFull-strength controls: ${fullStrengthControl.length}`);
console.log(`\nControl offset stats (changes in NON-battle units):`);
for (let off = -20; off <= 60; off++) {
  let differCount = 0;
  for (const s of fullStrengthControl) {
    if (bBuf[s.bE + off] !== aBuf[s.aE + off]) differCount++;
  }
  const surv = offsetStats[off].differCount;
  if (differCount === 0 && surv > 0) {
    console.log(`  +${off}: 0/${fullStrengthControl.length} control changes, ${surv}/${survivors.length} survivor changes  *** SURVIVOR-ONLY ***`);
  }
}
