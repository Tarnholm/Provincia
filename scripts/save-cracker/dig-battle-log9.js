// Session 21: T86Start vs T86End has only 48 bytes of diff in 31 regions.
// Identify exactly which bytes changed — likely the 0x43f8 RNG counter and
// some persistent counters. Then compare against turns that DID have battles
// to see which of those 31 region positions ticks differently.

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
  return { name: label, buf: fs.readFileSync(path.join(dir, v.file)) };
}

function diffByteList(a, b) {
  const len = Math.min(a.length, b.length);
  const out = [];
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) out.push(i);
  return out;
}

// Snapshot: T86 Start ↔ T86 End (no diff was a no-op turn).
// Let's find turns with similar low diff counts to identify the metadata counter set.
const turns = [];
for (let t = 80; t <= 99; t++) {
  const s = load(`Autosave   Macedon   Turn ${t} Start`);
  const e = load(`Autosave   Macedon   Turn ${t} End`);
  if (s && e) turns.push({ t, s, e });
}

console.log(`Loaded ${turns.length} turn pairs`);
const turn86 = turns.find(t => t.t === 86);
const t86bytes = diffByteList(turn86.s.buf, turn86.e.buf);
console.log(`\nT86 (no-op pair) differs at ${t86bytes.length} bytes:`);
console.log(`  offsets: ${t86bytes.map(b => '0x' + b.toString(16)).join(' ')}`);
for (const off of t86bytes) {
  console.log(`    0x${off.toString(16).padStart(8,'0')}  ${turn86.s.buf[off].toString(16).padStart(2,'0')} → ${turn86.e.buf[off].toString(16).padStart(2,'0')}`);
}

// Look at what diffs each turn-pair has at each of these offsets
console.log(`\nPer-turn diff at the T86-changing offsets:`);
const cols = t86bytes.slice(0, 20);
for (const tp of turns) {
  const ds = diffByteList(tp.s.buf, tp.e.buf);
  const total = ds.length;
  const dsSet = new Set(ds);
  const present = cols.map(c => dsSet.has(c) ? '*' : '.');
  console.log(`  T${tp.t.toString().padStart(2)} diff=${total.toString().padStart(5)}  cols: ${present.join('')}  size: ${tp.s.buf.length}→${tp.e.buf.length}`);
}
