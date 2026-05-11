// dig-unitstats6.js — Decode the +26 SURVIVOR-ONLY byte. List value transitions across all survivors.
// Also dump +20..+30 byte-by-byte to see context.

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

const survivors = [];
for (const u of after) {
  const ub = bMap.get(key(u));
  if (!ub) continue;
  if (ub.soldiers > u.soldiers && u.soldiers > 0 && ub.soldiers > 0) {
    const bE = regionEnd(bBuf, ub);
    const aE = regionEnd(aBuf, u);
    if (bE >= 0 && aE >= 0) survivors.push({ ub, u, bE, aE });
  }
}

console.log(`Survivors with full record-ends: ${survivors.length}`);

// For each, print: name, region, current/max before/after, +12 (soldiers verify), +26 byte before/after,
// and the byte at +20..+30 for full context.
console.log(`\nname | losses | bef/aft soldiers (+12) | +26 byte`);
for (const s of survivors.slice(0, 30)) {
  const lost = s.ub.soldiers - s.u.soldiers;
  const sB = bBuf[s.bE + 12];
  const sA = aBuf[s.aE + 12];
  const x26B = bBuf[s.bE + 26];
  const x26A = aBuf[s.aE + 26];
  console.log(`  ${s.u.name.padEnd(20)} ${s.ub.region.padEnd(16)} losses=${lost.toString().padStart(3)}  +12: ${sB}→${sA}  +26: ${x26B}→${x26A}`);
}

// Now check fully across all survivors what +26 distribution looks like
const xpDist = new Map();
for (const s of survivors) {
  const before26 = bBuf[s.bE + 26];
  const after26 = aBuf[s.aE + 26];
  const k = `${before26}→${after26}`;
  xpDist.set(k, (xpDist.get(k) || 0) + 1);
}
console.log(`\n+26 transitions across all ${survivors.length} survivors:`);
const sortedDist = [...xpDist.entries()].sort((a, b) => b[1] - a[1]);
for (const [k, v] of sortedDist) console.log(`  ${k}: ${v}`);

// Investigate: is +26 some kind of unique "per-record" hash? Survey full-strength units too
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
console.log(`\nFull-strength units +26 distribution: (${fullStrengthControl.length} units)`);
const fsDist = new Map();
for (const s of fullStrengthControl) {
  const v = aBuf[s.aE + 26];
  fsDist.set(v, (fsDist.get(v) || 0) + 1);
}
const fsSorted = [...fsDist.entries()].sort((a, b) => b[1] - a[1]);
for (const [v, c] of fsSorted.slice(0, 20)) console.log(`  +26=${v}: ${c}`);

// Now check +26 for survivors AFTER battle compared to current soldier count
console.log(`\nIs +26 == current soldiers (=+12) for survivors?`);
let match = 0;
for (const s of survivors) if (aBuf[s.aE + 12] === aBuf[s.aE + 26]) match++;
console.log(`  matches: ${match}/${survivors.length}`);

// Maybe +12 is also a current-soldiers tracker?
console.log(`\nCheck soldier count at +12 vs unit.soldiers for survivor #0:`);
const s0 = survivors[0];
console.log(`  unit.soldiers (after) = ${s0.u.soldiers}`);
console.log(`  byte at +12 (after) = ${aBuf[s0.aE + 12]}`);
console.log(`  byte at +26 (after) = ${aBuf[s0.aE + 26]}`);
