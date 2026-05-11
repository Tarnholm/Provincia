// dig-unitstats15.js — Confirm the +20 byte = XP. Probe ALL veterans:
//   * What's the value at +20 for each veteran across snapshots?
//   * Does it correlate with cumulative battle activity?
//   * Are values in [0..9] only?

const fs = require("fs");
const path = require("path");
const { findUnitRecords } = require("../../src/unitParser.js");

const ARCHIVE = "C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z";

const allFiles = fs.readdirSync(ARCHIVE).filter(f => f.endsWith(".sav"));
const byTurn = new Map();
for (const f of allFiles) {
  const m = f.match(/Turn (\d+) (End|Start)/);
  if (!m) continue;
  const turn = parseInt(m[1], 10);
  const phase = m[2];
  const stat = fs.statSync(path.join(ARCHIVE, f));
  const k = `${turn}|${phase}`;
  const prev = byTurn.get(k);
  if (!prev || prev.size < stat.size) byTurn.set(k, { file: f, size: stat.size, turn, phase });
}

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

// Use the Turn 13 End save as the "current state" reference
const refK = "13|End";
const refEntry = byTurn.get(refK);
const refBuf = fs.readFileSync(path.join(ARCHIVE, refEntry.file));
const refUnits = findUnitRecords(refBuf);

// Distribution of +20 byte values across all units in Turn 13 End
const xpDist = new Map();
const byUnitName = new Map();
for (const u of refUnits) {
  const rE = regionEnd(refBuf, u);
  if (rE < 0) continue;
  const v = refBuf[rE + 20];
  xpDist.set(v, (xpDist.get(v) || 0) + 1);
  if (!byUnitName.has(u.name)) byUnitName.set(u.name, new Map());
  const m = byUnitName.get(u.name);
  m.set(v, (m.get(v) || 0) + 1);
}

console.log(`+20 byte distribution in T13 End (${refUnits.length} units):`);
const sortedDist = [...xpDist.entries()].sort((a, b) => a[0] - b[0]);
for (const [v, c] of sortedDist) console.log(`  +20=${v}: ${c} units`);

// Sample units by their XP byte value
console.log(`\n+20=1 unit examples (5):`);
let s1 = 0;
for (const u of refUnits) {
  if (s1 >= 5) break;
  const rE = regionEnd(refBuf, u);
  if (rE < 0) continue;
  if (refBuf[rE + 20] === 1) {
    console.log(`  ${u.name} @ ${u.region} soldiers=${u.soldiers}/${u.maxSoldiers}`);
    s1++;
  }
}

console.log(`\n+20=2 unit examples (5):`);
let s2 = 0;
for (const u of refUnits) {
  if (s2 >= 5) break;
  const rE = regionEnd(refBuf, u);
  if (rE < 0) continue;
  if (refBuf[rE + 20] === 2) {
    console.log(`  ${u.name} @ ${u.region} soldiers=${u.soldiers}/${u.maxSoldiers}`);
    s2++;
  }
}

console.log(`\n+20 >= 3 examples:`);
for (const u of refUnits) {
  const rE = regionEnd(refBuf, u);
  if (rE < 0) continue;
  if (refBuf[rE + 20] >= 3 && refBuf[rE + 20] <= 9) {
    console.log(`  +20=${refBuf[rE+20]}  ${u.name} @ ${u.region} soldiers=${u.soldiers}/${u.maxSoldiers}`);
  }
}

// Now: trace the SAME unit (e.g., the Macedon Phalangists Stack 0 that went from 0 to 1 at +20) across all turns
// Find the specific unit instance: phalangists @ Macedon with no commander, max 240
const targetName = "phalangists", targetRegion = "Macedon", targetMax = 240;
const trace = [];
for (const k of ["1|Start", "1|End", "2|Start", "2|End", "3|Start", "3|End", "4|Start", "4|End", "5|Start", "5|End", "6|Start", "6|End", "7|Start", "7|End", "8|Start", "8|End", "9|Start", "9|End", "10|Start", "10|End", "11|Start", "11|End", "12|Start", "12|End", "13|Start", "13|End"]) {
  const entry = byTurn.get(k);
  if (!entry) continue;
  const buf = fs.readFileSync(path.join(ARCHIVE, entry.file));
  const units = findUnitRecords(buf);
  // Find first phalangists Macedon max=240 with no commander
  const matches = units.filter(u => u.name === targetName && u.region === targetRegion && u.maxSoldiers === targetMax && !u.commanderUuid);
  for (const u of matches) {
    const rE = regionEnd(buf, u);
    if (rE < 0) continue;
    trace.push({ k, soldiers: u.soldiers, xp: buf[rE + 20], armor: buf[rE + 16], weapon: buf[rE + 17], plus18: buf[rE + 18], plus19: buf[rE + 19], plus21: buf[rE + 21] });
  }
}

console.log(`\nTrace of ${targetName} @ ${targetRegion} max=${targetMax}:`);
for (const t of trace.slice(-30)) {
  console.log(`  ${t.k} soldiers=${t.soldiers}, +16=${t.armor} +17=${t.weapon} +18=${t.plus18} +19=${t.plus19} +20=${t.xp} +21=${t.plus21}`);
}
