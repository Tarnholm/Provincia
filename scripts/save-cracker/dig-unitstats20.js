// dig-unitstats20.js — Now look at non-phalangist/hypaspists high-XP units (these have weapon_lvl=0).
// What does their +19 byte look like? If +19 is morale-from-XP, it should track XP.

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

// Find all (unit_name, +20=xp, +17=weapon, +19, +16=armor) tuples ever observed
const tuples = new Map();
for (const k of byTurn.keys()) {
  const ent = byTurn.get(k);
  const buf = fs.readFileSync(path.join(ARCHIVE, ent.file));
  const units = findUnitRecords(buf);
  for (const u of units) {
    const rE = regionEnd(buf, u);
    if (rE < 0) continue;
    const xp = buf[rE + 20];
    if (xp >= 1) {  // any XP
      const k = `${u.name}|+16=${buf[rE+16]}|+17=${buf[rE+17]}|+19=${buf[rE+19]}|+20=${xp}`;
      tuples.set(k, (tuples.get(k) || 0) + 1);
    }
  }
}
const sorted = [...tuples.entries()].sort((a, b) => b[1] - a[1]);
// Filter to non-phalangist/hypaspists
console.log("Non-phalangist/hypaspists units with XP >= 1:");
for (const [k, c] of sorted) {
  if (k.startsWith("phalangists") || k.startsWith("hypaspists")) continue;
  if (c >= 2) console.log(`  ${c}× ${k}`);
}

// Show all unique unit-types that have ANY +20 >= 1
console.log("\nAll unit names ever observed with XP > 0:");
const namesWithXP = new Set();
for (const k of tuples.keys()) namesWithXP.add(k.split("|")[0]);
for (const n of namesWithXP) console.log(`  ${n}`);
