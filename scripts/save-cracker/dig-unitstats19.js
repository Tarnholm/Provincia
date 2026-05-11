// dig-unitstats19.js — Find units with HIGH XP (e.g. +20 >= 3) and check their +16/+17/+19 bytes.
// We want to know: does +17=weapon track? Does +16=armor track? What is +19=64 really?

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

// Across all 196 saves, find all unit records and tabulate (name, +16, +17, +20, +19)
// for units with +20 >= 3 (significant XP).
const highXP = [];
for (const k of byTurn.keys()) {
  const ent = byTurn.get(k);
  const buf = fs.readFileSync(path.join(ARCHIVE, ent.file));
  const units = findUnitRecords(buf);
  for (const u of units) {
    const rE = regionEnd(buf, u);
    if (rE < 0) continue;
    const xp = buf[rE + 20];
    if (xp >= 3) {
      highXP.push({
        save: ent.file, turn: ent.turn, phase: ent.phase,
        name: u.name, region: u.region, soldiers: u.soldiers, max: u.maxSoldiers,
        h16: buf[rE+16], h17: buf[rE+17], h18: buf[rE+18], h19: buf[rE+19], h20: xp, h21: buf[rE+21],
      });
    }
  }
}

console.log(`High-XP units across all saves: ${highXP.length}`);
const sample = new Map();
for (const u of highXP) {
  const k = `${u.name}|${u.h16},${u.h17},${u.h18},${u.h19},${u.h20},${u.h21}`;
  sample.set(k, (sample.get(k) || 0) + 1);
}
const sorted = [...sample.entries()].sort((a, b) => b[1] - a[1]);
for (const [k, c] of sorted.slice(0, 30)) {
  console.log(`  ${c}× ${k}`);
}

// Also: pick one high-XP unit and trace its life
const sampleUnit = highXP.find(u => u.name === "hypaspists");
if (sampleUnit) {
  console.log(`\nSample hypaspists @ ${sampleUnit.region} (XP=${sampleUnit.h20})`);
}

// Look at >5 XP
console.log(`\n+20 >= 5 (high-XP) sample:`);
for (const u of highXP.filter(u => u.h20 >= 5).slice(0, 20)) {
  console.log(`  [T${u.turn} ${u.phase}] ${u.name} @ ${u.region}: +16=${u.h16}, +17=${u.h17}, +18=${u.h18}, +19=${u.h19}, +20=${u.h20}, +21=${u.h21}`);
}
