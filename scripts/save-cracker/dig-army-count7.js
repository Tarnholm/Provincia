// In a single-continuous-game window (T1-T13), look for u32 fields that
// EXACTLY match the turn number, or shift +1 per turn. Could be a turn-since-
// start-of-this-faction counter, faction turn-of-rotation, etc.

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

// Single-continuous-game window — find Macedon records.
const turns = [];
for (let t = 2; t <= 13; t++) {
  const buf = load(`Autosave   Macedon   Turn ${t} Start`);
  if (!buf) continue;
  const recs = findMajorFactionRecords(buf);
  if (recs.length !== 5) continue;
  const trailing = buf.subarray(recs[0].offset, recs[1].offset);
  turns.push({ t, trailing });
}

const minLen = Math.min(...turns.map(t => t.trailing.length));
console.log(`T2-T13 Macedon trailing slice ${turns.length} saves, minLen=${minLen}`);

// Find u32 offsets where val EQUALS turn number for every turn (turn counter)
const exactTurn = [];
for (let off = 0; off + 4 <= minLen; off++) {
  let match = true;
  for (const t of turns) {
    if (t.trailing.readUInt32LE(off) !== t.t) { match = false; break; }
  }
  if (match) exactTurn.push(off);
}
console.log(`\n${exactTurn.length} u32 offsets where value == turn number for every save:`);
for (const off of exactTurn.slice(0, 20)) console.log(`  +${off}`);

// Find u32 offsets where val EQUALS turn-1 (i.e. "completed turns")
const exactTurnMinus = [];
for (let off = 0; off + 4 <= minLen; off++) {
  let match = true;
  for (const t of turns) {
    if (t.trailing.readUInt32LE(off) !== t.t - 1) { match = false; break; }
  }
  if (match) exactTurnMinus.push(off);
}
console.log(`\n${exactTurnMinus.length} u32 offsets where value == turn-1 for every save:`);
for (const off of exactTurnMinus.slice(0, 20)) console.log(`  +${off}`);

// Find u32 offsets where val is *strictly increasing each turn by exactly N*.
console.log(`\nLooking for u32 offsets that strictly increase each turn (any rate):`);
const strictInc = [];
for (let off = 0; off + 4 <= minLen; off++) {
  const vals = turns.map(t => t.trailing.readUInt32LE(off));
  if (vals.some(v => v > 10000 || v < 0)) continue;
  let inc = true;
  for (let i = 1; i < vals.length; i++) if (vals[i] <= vals[i-1]) { inc = false; break; }
  if (!inc) continue;
  const totalRange = vals[vals.length - 1] - vals[0];
  if (totalRange === 0) continue;
  strictInc.push({ off, vals, range: totalRange });
}
strictInc.sort((a, b) => a.range - b.range);
console.log(`${strictInc.length} strictly-increasing u32 fields, smallest-range first:`);
for (const c of strictInc.slice(0, 30)) {
  console.log(`  +${c.off.toString().padStart(7)} range=${c.range}  vals=[${c.vals.join(',')}]`);
}
