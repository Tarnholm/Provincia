// dig-unitstats14.js — Trace ONE specific veteran unit across many saves looking for monotonic byte increases.
// XP can only increase (or stay same), so a u8 that grows by 1-2 over many turns is a strong XP candidate.

const fs = require("fs");
const path = require("path");
const { findUnitRecords } = require("../../src/unitParser.js");

const ARCHIVE = "C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z";

// Largest unique save per turn
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

// Walk turns 1..13 (where most saves exist). For each, find all unique unit "fingerprints" by
// (name, region, commanderUuid) and dump bytes near the regionEnd.
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

const sequence = ["1|Start", "1|End", "2|Start", "2|End", "3|Start", "3|End", "4|Start", "4|End", "5|Start", "5|End", "6|Start", "6|End", "7|Start", "7|End", "8|Start", "8|End", "9|Start", "9|End", "10|Start", "10|End", "11|Start", "11|End", "12|Start", "12|End", "13|Start", "13|End"];

// Find a unit that exists in all/most snapshots: pick a Macedon player's hoplites
const unitData = new Map(); // key → array of {turn, regionEnd, headerBytes}

for (const k of sequence) {
  const entry = byTurn.get(k);
  if (!entry) continue;
  const buf = fs.readFileSync(path.join(ARCHIVE, entry.file));
  const units = findUnitRecords(buf);
  for (const u of units) {
    const ku = `${u.name}|${u.region}|${u.commanderUuid || 0}|${u.maxSoldiers}`;
    const rE = regionEnd(buf, u);
    if (rE < 0) continue;
    if (!unitData.has(ku)) unitData.set(ku, []);
    // Capture the header bytes (regionEnd-30 to regionEnd+30)
    const before = [];
    const after = [];
    for (let i = -30; i < 0; i++) before.push(buf[rE + i] || 0);
    for (let i = 0; i < 30; i++) after.push(buf[rE + i] || 0);
    unitData.get(ku).push({
      turn: k, fileSize: buf.length,
      soldiers: u.soldiers,
      maxSoldiers: u.maxSoldiers,
      rE,
      before, after,
    });
  }
}

// Find units that exist in many snapshots AND have at least one battle (soldiers < max ever)
const veterans = [];
for (const [k, snaps] of unitData) {
  if (snaps.length < 10) continue;
  const sawBattle = snaps.some(s => s.soldiers < s.maxSoldiers);
  if (sawBattle) veterans.push({ key: k, snaps });
}

console.log(`Veteran units in ${veterans.length} different unit fingerprints (≥10 snapshots, lost soldiers at some point)`);

// For top 5 veterans, trace the +28 byte (first byte of first soldier record) across turns.
// Actually, look at each of bytes 0..28 across all snapshots, and identify any monotonically-increasing u8.
for (const v of veterans.slice(0, 5)) {
  console.log(`\n=== Veteran: ${v.key}, ${v.snaps.length} snapshots ===`);
  // For each header offset, get the sequence of values across snapshots
  for (let off = 0; off < 30; off++) {
    const seq = v.snaps.map(s => s.after[off]);
    // Look for monotonic non-decreasing AND variation > 0
    const u8min = Math.min(...seq);
    const u8max = Math.max(...seq);
    if (u8min === u8max) continue;
    if (u8max > 20) continue; // Filter: XP/armor/weapon all < 20
    // Show the sequence
    console.log(`  +${off}: min=${u8min} max=${u8max} seq=${seq.join(",")}`);
  }
}
