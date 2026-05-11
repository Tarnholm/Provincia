// Probe 0xfc0..0xfef in greater detail. Both states are fixed; let me find ALL
// byte offsets in 0x0..0x3000 that show the same odd/even turn alternation.
// If many do, they're collectively a "turn-parity" structural state, not AI
// weights.

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

// Just Start saves to remove S/E within-turn variation
const turns = [];
for (let t = 1; t <= 99; t++) {
  const s = load(`Autosave   Macedon   Turn ${t} Start`);
  if (s) turns.push({ t, parity: t % 2, label: `T${t}S`, buf: s });
}
console.log(`Loaded ${turns.length} Start saves`);

// For each byte 0..0x3000, check if it matches the "odd vs even turn" pattern:
// all odd turns have the same byte value; all even turns have the same (different) value.
const minLen = Math.min(...turns.map(t => t.buf.length), 0x3000);
const odds = turns.filter(t => t.parity === 1);
const evens = turns.filter(t => t.parity === 0);
const parityBytes = [];
for (let off = 0; off < minLen; off++) {
  const oddVals = new Set();
  const evenVals = new Set();
  for (const t of odds) oddVals.add(t.buf[off]);
  for (const t of evens) evenVals.add(t.buf[off]);
  if (oddVals.size === 1 && evenVals.size === 1) {
    const ov = [...oddVals][0];
    const ev = [...evens][0].buf[off];
    if (ov !== ev) {
      parityBytes.push({ off, oddVal: ov, evenVal: ev });
    }
  }
}
console.log(`\n${parityBytes.length} bytes in 0..0x3000 perfectly alternate by turn parity`);
// Group by contiguous offset:
const groups = [];
let cur = null;
for (const p of parityBytes) {
  if (cur && p.off === cur.end + 1) { cur.end = p.off; cur.bytes.push(p); }
  else { if (cur) groups.push(cur); cur = { start: p.off, end: p.off, bytes: [p] }; }
}
if (cur) groups.push(cur);
console.log(`${groups.length} contiguous groups:`);
for (const g of groups) {
  console.log(`  0x${g.start.toString(16).padStart(8,'0')}..0x${g.end.toString(16).padStart(8,'0')}  len=${g.bytes.length}`);
}
