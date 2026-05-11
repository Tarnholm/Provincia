// dig-upkeep12.js — final probe: characterize the +860 counter and the financial fields
//
// Across rome saves the player faction has:
//   +860 = 8 (rome1..rome6), 13 (rome7..rome9), 8 (rome10)  Δ=+5 at turn boundary
//
// Hypothesis: +860 is the AGE counter inside an EMBEDDED character record.
// At offset +860 from the major-record start, we're well past the header
// (+0 treasury + region list ends at +192 + treasury snapshot at +232 + ...)
// and could be inside a sub-record.
//
// Just dump player record bytes +840..+880 and check if it looks like a char header.

const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function findMajorRecords(buf) {
  const hits = [];
  for (let i = 0; i + 64 < buf.length; i += 1) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 32) !== 0 || buf.readUInt32LE(i + 36) !== 0) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    const regionCount = buf.readUInt32LE(i + 48);
    if (regionCount > 200) continue;
    const treasury = buf.readInt32LE(i);
    hits.push({ pos: i, treasury, regionCount });
  }
  return hits;
}

const r5 = fs.readFileSync(path.join(SAVES, "save_rome5..sav"));
const r7 = fs.readFileSync(path.join(SAVES, "save_rome7.sav"));
const recs5 = findMajorRecords(r5);
const recs7 = findMajorRecords(r7);
const p5 = recs5[0], p7 = recs7[0];

// Player has 35 regions, so region-list ends at +192, treasury dup at +232.
// Bytes from +236 to ~+1500 are the "main" trailing structure for the player record.
// Looking at rome5 region: starts after the region list.

console.log("=== Romans Julii rec interior, rome5 vs rome7 — byte-level deltas in +236..+1500 ===");
const start = 236;
const end = 1500;
const diffs = [];
for (let off = start; off < end; off++) {
  const a = r5.readUInt8(p5.pos + off);
  const b = r7.readUInt8(p7.pos + off);
  if (a !== b) diffs.push({ off, a, b });
}
console.log(`${diffs.length} byte-differences in +${start}..+${end}`);

// Cluster diffs into runs
const runs = [];
for (const d of diffs) {
  const last = runs[runs.length - 1];
  if (last && last.endOff === d.off - 1) {
    last.endOff = d.off;
    last.aBytes.push(d.a);
    last.bBytes.push(d.b);
  } else {
    runs.push({ startOff: d.off, endOff: d.off, aBytes: [d.a], bBytes: [d.b] });
  }
}
console.log(`${runs.length} contiguous diff runs`);
for (const r of runs) {
  const len = r.endOff - r.startOff + 1;
  const ah = r.aBytes.map(b => b.toString(16).padStart(2, '0')).join(' ');
  const bh = r.bBytes.map(b => b.toString(16).padStart(2, '0')).join(' ');
  let interp = '';
  if (len === 4) {
    const aU = Buffer.from(r.aBytes).readUInt32LE(0);
    const bU = Buffer.from(r.bBytes).readUInt32LE(0);
    const aI = Buffer.from(r.aBytes).readInt32LE(0);
    const bI = Buffer.from(r.bBytes).readInt32LE(0);
    interp = `u32: ${aU}→${bU} (i32: ${aI}→${bI}, Δ=${bI - aI})`;
  } else if (len === 2) {
    const aU = Buffer.from(r.aBytes).readUInt16LE(0);
    const bU = Buffer.from(r.bBytes).readUInt16LE(0);
    interp = `u16: ${aU}→${bU} Δ=${bU - aU}`;
  }
  console.log(`  +${String(r.startOff).padStart(5)}..+${r.endOff} (${len}B): ${ah} → ${bh}  ${interp}`);
}
