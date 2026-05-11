// Session 21: Find bytes that monotonically increase across turns proportional
// to battle count. The 0x43f8 RNG counter is universal. But what about counters
// that only tick on specific events?
//
// Strategy: collect *every* u32 field at byte offset O across all 19 turn-pair
// Start saves. Filter those that:
//   (a) are monotonically increasing (or weakly monotone)
//   (b) increment varies per turn (some turns +1, some +10, some +0)
//   (c) is NOT 0x43f8 (that's the per-save counter, ticks unconditionally)
//
// A "battle count" or "famous-battle index" field should look like that.

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

const turns = [];
for (let t = 80; t <= 99; t++) {
  const b = load(`Autosave   Macedon   Turn ${t} Start`);
  if (b) turns.push({ t, buf: b });
}
console.log(`Loaded ${turns.length} Start saves`);

// Look at the first 0x20000 bytes (header + early body); battle counts likely
// live in fixed metadata not in the deep section tree.
const HEADER_END = 0x20000;
const minLen = Math.min(...turns.map(t => t.buf.length), HEADER_END);

// Scan for u32 offsets that are monotone non-decreasing across all turns,
// with at least 2 distinct deltas.
const candidates = [];
for (let off = 0x3300; off < minLen - 4; off += 4) {
  const vals = turns.map(t => t.buf.readUInt32LE(off));
  // monotone non-decreasing?
  let mono = true;
  for (let i = 1; i < vals.length; i++) if (vals[i] < vals[i-1]) { mono = false; break; }
  if (!mono) continue;
  // strictly some change?
  if (vals[vals.length - 1] === vals[0]) continue;
  // reasonable magnitude (not huge offsets)
  const range = vals[vals.length - 1] - vals[0];
  if (range > 1000000) continue;
  // distinct deltas?
  const deltas = new Set();
  for (let i = 1; i < vals.length; i++) deltas.add(vals[i] - vals[i-1]);
  if (deltas.size < 2) continue;
  // not the 0x43f8 RNG (much larger increments)
  if (range > 100000) continue;
  candidates.push({ off, vals, range, deltaCount: deltas.size });
}

console.log(`\n${candidates.length} monotone-increasing u32 fields (range 1..100000):`);
// Show first 30 sorted by smallest range (most-likely event counters):
candidates.sort((a, b) => a.range - b.range);
for (const c of candidates.slice(0, 40)) {
  const deltas = [];
  for (let i = 1; i < c.vals.length; i++) deltas.push(c.vals[i] - c.vals[i-1]);
  console.log(`  0x${c.off.toString(16).padStart(8,'0')} range=${c.range} deltas=[${deltas.join(',')}]  values=[${c.vals.slice(0, 5).join(',')}...${c.vals.slice(-3).join(',')}]`);
}
