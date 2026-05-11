// dig-unitstats16.js — Survey +16, +17, +18, +19, +20, +21 across all units in T1 Start
// (no battles yet). Distribution by unit name. We want to identify which bytes are
// armor/weapon (constant per unit type) vs XP (always 0 for fresh).

const fs = require("fs");
const path = require("path");
const { findUnitRecords } = require("../../src/unitParser.js");

const ARCHIVE = "C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z";
const F = "0001_save_Autosave   Macedon   Turn 1 End.sav";  // largest T1 End

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

// For each unit, record (name, +16, +17, +18, +19, +20, +21)
const byName = new Map();
for (const u of units) {
  const rE = regionEnd(buf, u);
  if (rE < 0) continue;
  const k = u.name;
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push({
    region: u.region,
    soldiers: u.soldiers,
    maxSoldiers: u.maxSoldiers,
    h16: buf[rE + 16], h17: buf[rE + 17], h18: buf[rE + 18], h19: buf[rE + 19],
    h20: buf[rE + 20], h21: buf[rE + 21],
  });
}

// Print one line per unit name with distinct headers
const sortedNames = [...byName.entries()].sort((a, b) => b[1].length - a[1].length);
console.log(`Unit type: count | +16, +17, +18, +19, +20, +21 distinct values`);
for (const [name, recs] of sortedNames.slice(0, 50)) {
  const distinct = new Set();
  for (const r of recs) distinct.add(`${r.h16},${r.h17},${r.h18},${r.h19},${r.h20},${r.h21}`);
  console.log(`  ${name.padEnd(35)} ${recs.length.toString().padStart(3)} units: ${[...distinct].slice(0,5).join(" | ")}`);
}
