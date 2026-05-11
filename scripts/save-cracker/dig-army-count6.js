// Different angle: in Macedon's trailing data, find small ints (1..30) at
// offsets that diff across T2->T13. The "number of armies" is likely a
// per-faction state that increments when a general is recruited.

const fs = require('fs');
const path = require('path');

const dir = 'C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z/';
const all = fs.readdirSync(dir).sort();
const byLabel = new Map();
for (const f of all) {
  const m = f.match(/^(\d{4})_save_(.+)\.sav$/);
  if (!m) continue;
  const size = fs.statSync(path.join(dir, f)).size;
  const prev = byLabel.get(m[2]);
  if (!prev || size > prev.size) byLabel.set(m[2], { file: f, size, idx: parseInt(m[1], 10) });
}
function load(label) {
  const v = byLabel.get(label);
  if (!v) return null;
  return fs.readFileSync(path.join(dir, v.file));
}
function findMajorFactionRecords(buf) {
  const recs = [];
  const n = buf.length;
  for (let i = 0; i + 100 < n; i++) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    const N = buf.readUInt32LE(i + 48);
    if (N > 200) continue;
    recs.push({ offset: i, treasury: buf.readInt32LE(i), N });
  }
  return recs;
}

// Get only the T1S..T20S range, which is a single contiguous game
const turns = [];
for (let t = 1; t <= 20; t++) {
  const buf = load(`Autosave   Macedon   Turn ${t} Start`);
  if (!buf) continue;
  const recs = findMajorFactionRecords(buf);
  if (recs.length !== 5) continue;
  const trailing = buf.subarray(recs[0].offset, recs[1].offset);
  turns.push({ t, trailing });
}
console.log(`Loaded ${turns.length} Macedon player-records in T1-T20`);

const minLen = Math.min(...turns.map(t => t.trailing.length));
console.log(`Min trailing length: ${minLen}`);

// Find u32 offsets that have small-int (1..50), present in EVERY turn,
// and vary by at least 1 between SOME pair of consecutive turns.
const cands = [];
for (let off = 0; off + 4 <= minLen; off++) {
  const vals = turns.map(t => t.trailing.readUInt32LE(off));
  if (vals.some(v => v > 100 || v < 1)) continue;
  // varies?
  const min = Math.min(...vals), max = Math.max(...vals);
  if (max === min) continue;
  if (max - min > 50) continue;
  cands.push({ off, vals });
}
console.log(`${cands.length} small-int (1..100) variable u32 offsets in T1-T20`);

// Show first 60 most interesting (most distinct values):
cands.sort((a, b) => new Set(b.vals).size - new Set(a.vals).size);
for (const c of cands.slice(0, 50)) {
  const set = new Set(c.vals);
  console.log(`  off=+${c.off.toString().padStart(7)} distinct=${set.size}  vals=[${c.vals.join(',')}]`);
}
