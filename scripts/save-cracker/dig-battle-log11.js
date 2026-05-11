// Session 21: Wider scan for monotone-counter u32 fields across the whole save.
// File offsets shift between turns since saves are different sizes. So scan
// only the *common-prefix* region where bytes align — actually save sizes
// differ, but the early header is fixed-layout. Section bodies after the body
// root may shift.
//
// Strategy: scan all u32 offsets in the COMMON-PREFIX (min size of all saves).
// Filter: (a) monotone non-decreasing across the 20-turn sequence,
//         (b) increment 1..100 per turn (not RNG-counter scale),
//         (c) some turns have +0, some have +N (variable rate = event counter)
//         (d) value range in a reasonable counter range (≤ 5000)

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
const minLen = Math.min(...turns.map(t => t.buf.length));
console.log(`Loaded ${turns.length} saves, minLen=0x${minLen.toString(16)}=${minLen}`);

// Scan u32 LE
const candidates = [];
const reportEvery = 50000;
for (let off = 0; off < minLen - 4; off++) {
  if (off % reportEvery === 0) process.stderr.write(`\r  scanning ${off}/${minLen}`);
  const vals = turns.map(t => t.buf.readUInt32LE(off));
  // Quick reject:
  if (vals[0] > 100000) continue;          // first value too large to be a count
  if (vals[vals.length - 1] < vals[0]) continue;  // not monotone
  if (vals[vals.length - 1] === vals[0]) continue; // no change
  if (vals[vals.length - 1] > 5000) continue;     // counter ceiling

  // strictly monotone?
  let mono = true;
  let zeroDelta = 0, posDelta = 0;
  for (let i = 1; i < vals.length; i++) {
    const d = vals[i] - vals[i-1];
    if (d < 0) { mono = false; break; }
    if (d === 0) zeroDelta++;
    else posDelta++;
  }
  if (!mono) continue;
  if (zeroDelta === 0 || posDelta === 0) continue;  // need both kinds of deltas (event-driven)

  candidates.push({ off, vals, range: vals[vals.length - 1] - vals[0] });
}
process.stderr.write('\n');
console.log(`${candidates.length} mono-event-driven u32 counters in T80→T99`);
// Sort by range descending — bigger ranges = more frequent events = battle count plausibly
candidates.sort((a, b) => b.range - a.range);
for (const c of candidates.slice(0, 40)) {
  const deltas = [];
  for (let i = 1; i < c.vals.length; i++) deltas.push(c.vals[i] - c.vals[i-1]);
  console.log(`  0x${c.off.toString(16).padStart(8,'0')} range=${c.range} deltas=[${deltas.join(',')}]  vals=[${c.vals.join(',')}]`);
}
