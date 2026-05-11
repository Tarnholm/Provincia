// dig-unitstats8.js — Investigate offsets -24, -23 (relative to regionEnd) -- the 0→1 candidates.
// Also: maybe XP/armor/weapon are stored elsewhere (per-character record? Each unit's char-record stores it?).
//
// Strategy: try a different probe -- check bytes after the per-soldier array. Need to find where the
// per-soldier array ENDS. Typical layout: array of 8-byte per-soldier entries, count = max soldiers.

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
const fsControl = [];
for (const u of after) {
  const ub = bMap.get(key(u));
  if (!ub) continue;
  if (u.soldiers === 0 || ub.soldiers === 0) continue;
  const bE = regionEnd(bBuf, ub);
  const aE = regionEnd(aBuf, u);
  if (bE < 0 || aE < 0) continue;
  const losses = ub.soldiers - u.soldiers;
  if (losses > 0) survivors.push({ ub, u, bE, aE, losses });
  else fsControl.push({ ub, u, bE, aE, losses });
}

// Show the 6 survivors that have +-24 = 0→1
console.log(`Survivors with +-24 = 0→1:`);
for (const s of survivors) {
  const bV = bBuf[s.bE - 24];
  const aV = aBuf[s.aE - 24];
  if (bV === 0 && aV === 1) {
    console.log(`  ${s.u.name} @ ${s.u.region} cmdr=${s.u.commanderUuid} losses=${s.losses}`);
  }
}

console.log(`\nSurvivors with +-23 = 1→0:`);
for (const s of survivors) {
  const bV = bBuf[s.bE - 23];
  const aV = aBuf[s.aE - 23];
  if (bV === 1 && aV === 0) {
    console.log(`  ${s.u.name} @ ${s.u.region} cmdr=${s.u.commanderUuid} losses=${s.losses}`);
  }
}

// Now: detailed look at survivor #0's per-soldier array. Soldier count is in +12 (after) so each
// soldier has bytes at +28 + 8*i for i in [0..max-1]?
// Survivor 0: hoplites Greece, max=160, before 160, after 145
// We saw 53 bytes (+28 to +98) changed somehow. Let me dump full record.
const s0 = survivors[0];
console.log(`\n=== Survivor 0 ${s0.u.name} dump ${s0.ub.soldiers}→${s0.u.soldiers}/${s0.ub.maxSoldiers} ===`);
function hexDump(buf, off, len, label) {
  for (let i = 0; i < len; i += 16) {
    const row = [];
    for (let j = 0; j < 16 && i + j < len; j++) row.push(buf[off + i + j].toString(16).padStart(2, "0"));
    console.log(`${label} +${(i).toString().padStart(4)}: ${row.join(" ")}`);
  }
}
console.log(`\n--- BEFORE (regionEnd=${s0.bE.toString(16)}) ---`);
hexDump(bBuf, s0.bE - 32, 80, "B");
console.log(`\n--- AFTER (regionEnd=${s0.aE.toString(16)}) ---`);
hexDump(aBuf, s0.aE - 32, 80, "A");

// Also dump per-soldier array region (assume 8 bytes per soldier × 160 = 1280 bytes starting at +28)
console.log(`\n--- Per-soldier-array region (extending past 16-byte sample): ---`);
// Print +28 to +28+8*5=68 plus another stretch near end-of-array
console.log("First 5 soldiers (per soldier @ +28+8i):");
for (let i = 0; i < 5; i++) {
  const off = 28 + 8 * i;
  const b = [];
  const a = [];
  for (let j = 0; j < 8; j++) { b.push(bBuf[s0.bE + off + j].toString(16).padStart(2, "0")); a.push(aBuf[s0.aE + off + j].toString(16).padStart(2, "0")); }
  console.log(`  Sld ${i}: B ${b.join(" ")} | A ${a.join(" ")}`);
}

// Length of per-soldier array = max * 8 + something? Check what comes after at offset 28 + 8 * max
const expectedArrayEnd = 28 + 8 * 160;
console.log(`\nExpected array end at +${expectedArrayEnd}. Bytes at +${expectedArrayEnd - 16}..+${expectedArrayEnd + 16}:`);
for (let i = -16; i < 24; i++) {
  const xb = bBuf[s0.bE + expectedArrayEnd + i] || 0;
  const xa = aBuf[s0.aE + expectedArrayEnd + i] || 0;
  console.log(`  +${expectedArrayEnd + i}: B 0x${xb.toString(16).padStart(2,"0")} | A 0x${xa.toString(16).padStart(2,"0")} ${xb !== xa ? "**" : ""}`);
}
