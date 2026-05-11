// dig-unitstats13.js — Dump the per-unit header bytes (regionEnd+16..+27) for representative units
// to understand its layout. Then trace one specific unit across many saves to see what changes.

const fs = require("fs");
const path = require("path");
const { findUnitRecords } = require("../../src/unitParser.js");

const ARCHIVE = "C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z";
const F_AFTER = "0192_save_Autosave   Macedon   Turn 13 Start.sav";

const aBuf = fs.readFileSync(path.join(ARCHIVE, F_AFTER));
const units = findUnitRecords(aBuf);

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

// For 20 different units, dump regionEnd+0..+30 to find the structure
console.log("Unit header dumps (regionEnd+0..+30):");
console.log("Format: regionEnd+0..3 commander, +4..7 MP, +8..11 max, +12..15 cur, +16..27 ???, +28+ per-soldier");
let count = 0;
const seenNames = new Set();
for (const u of units) {
  if (seenNames.has(u.name)) continue;
  if (u.soldiers === 0) continue;
  seenNames.add(u.name);
  const rE = regionEnd(aBuf, u);
  if (rE < 0) continue;
  const slice = aBuf.slice(rE, rE + 32);
  const hex = [];
  for (let i = 0; i < 32; i++) hex.push(aBuf[rE + i].toString(16).padStart(2, "0"));
  console.log(`  ${u.name.padEnd(30)} max=${u.maxSoldiers.toString().padStart(3)} cur=${u.soldiers.toString().padStart(3)} | ${hex.slice(0,4).join(" ")} | ${hex.slice(4,8).join(" ")} | ${hex.slice(8,12).join(" ")} | ${hex.slice(12,16).join(" ")} | ${hex.slice(16,20).join(" ")} | ${hex.slice(20,24).join(" ")} | ${hex.slice(24,28).join(" ")} | ${hex.slice(28,32).join(" ")}`);
  count++;
  if (count >= 30) break;
}
