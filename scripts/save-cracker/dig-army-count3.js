// In Macedon's faction record trailing data, count occurrences of any byte/u32
// that increases monotonically across T1->T13 and slowly throughout the campaign.
// A "number of armies owned" counter should slowly grow as the player recruits.
//
// Strategy: Macedon's trailing data shifts in absolute file offset across turns
// but is roughly the same internal layout. We can't directly diff by offset.
// Instead, slice each Macedon record's trailing data, and for each *relative*
// offset (0..150000), check if the u32 value is monotonically non-decreasing
// across turns (with realistic increment scale).

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

// Get Macedon record for all T1..T20 Start saves
const turns = [];
for (let t = 1; t <= 99; t++) {
  const buf = load(`Autosave   Macedon   Turn ${t} Start`);
  if (!buf) continue;
  const recs = findMajorFactionRecords(buf);
  if (recs.length !== 5) continue;
  const player = recs[0];
  const next = recs[1].offset;
  const trailing = buf.subarray(player.offset, next);
  turns.push({ t, trailing, player });
}
console.log(`Loaded ${turns.length} Macedon player-records`);

// Min trailing length
const minLen = Math.min(...turns.map(t => t.trailing.length));
console.log(`Min trailing length: ${minLen}`);

// Scan for u32 offsets that are monotone non-decreasing across all turns
// with reasonable counter scale (1..200).
const candidates = [];
for (let off = 0; off + 4 <= minLen; off++) {
  const vals = turns.map(t => t.trailing.readUInt32LE(off));
  // reject huge values
  if (vals.some(v => v > 1000)) continue;
  // monotone non-decreasing?
  let mono = true;
  for (let i = 1; i < vals.length; i++) if (vals[i] < vals[i-1]) { mono = false; break; }
  if (!mono) continue;
  if (vals[vals.length - 1] === vals[0]) continue;
  // distinct deltas, to filter out turn-id type fields
  const deltas = new Set();
  for (let i = 1; i < vals.length; i++) deltas.add(vals[i] - vals[i-1]);
  if (deltas.size < 2) continue;
  const range = vals[vals.length - 1] - vals[0];
  if (range > 500) continue;
  candidates.push({ off, vals, range, distinctDeltas: deltas.size });
}

console.log(`\n${candidates.length} monotone u32 counters in Macedon trailing data (max=500)`);
candidates.sort((a, b) => b.range - a.range);
for (const c of candidates.slice(0, 30)) {
  console.log(`  off=+${c.off.toString().padStart(7)} range=${c.range.toString().padStart(4)} dd=${c.distinctDeltas}  vals=[${c.vals.slice(0,4).join(',')},...,${c.vals.slice(-3).join(',')}]`);
}
