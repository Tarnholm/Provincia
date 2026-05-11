// dig-unitstats10.js — Determine the actual per-soldier record size.
// Approach: find where the array ENDS by detecting the start of the NEXT unit (look for u16 nameLen pattern).

const fs = require("fs");
const path = require("path");
const { findUnitRecords } = require("../../src/unitParser.js");

const ARCHIVE = "C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z";
const F_AFTER = "0192_save_Autosave   Macedon   Turn 13 Start.sav";

const aBuf = fs.readFileSync(path.join(ARCHIVE, F_AFTER));
const units = findUnitRecords(aBuf);

// Find array sizes: distance from one unit's regionEnd to the next unit's start.
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

units.sort((a, b) => a.offset - b.offset);

// For each consecutive pair, distance from u[i].regionEnd to u[i+1].offset
let sample = [];
for (let i = 0; i < units.length - 1; i++) {
  const cur = units[i], next = units[i + 1];
  const rE = regionEnd(aBuf, cur);
  if (rE < 0) continue;
  // Skip header bytes (we know regionEnd → +28 starts per-soldier array)
  const arrStart = rE + 28;
  const arrEnd = next.offset;
  const arrLen = arrEnd - arrStart;
  const max = cur.maxSoldiers;
  if (max === 0) continue;
  const ratio = arrLen / max;
  if (Math.abs(ratio - Math.round(ratio)) < 0.1 || arrLen > 0) {
    sample.push({ name: cur.name, max, arrLen, ratio });
  }
}

// Print distribution: ratio of (next_unit_offset - this_unit_array_start) / max_soldiers
console.log("First 30 units (probe header skip):");
for (const s of sample.slice(0, 30)) {
  console.log(`  ${s.name.padEnd(30)} max=${s.max} arrLen=${s.arrLen} ratio=${s.ratio.toFixed(2)}`);
}

// What's the most common ratio?
const ratioCounts = new Map();
for (const s of sample) {
  if (s.arrLen < 0 || s.arrLen > 5000) continue;
  const rounded = Math.round(s.ratio);
  ratioCounts.set(rounded, (ratioCounts.get(rounded) || 0) + 1);
}
console.log("\nRatio distribution (arrLen / max_soldiers):");
const sortedR = [...ratioCounts.entries()].sort((a, b) => b[1] - a[1]);
for (const [r, c] of sortedR.slice(0, 15)) console.log(`  ratio ${r}: ${c}`);
