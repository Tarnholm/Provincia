// Display raw bytes of 0xfc0..0xfef in both states (odd-turn and even-turn).
// Look for ASCII / structured patterns / faction IDs / etc.

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

const t1 = load(`Autosave   Macedon   Turn 1 End`);  // odd turn
const t2 = load(`Autosave   Macedon   Turn 2 Start`); // even turn

console.log(`odd-turn (T1E) bytes 0xfc0..0xff0:`);
console.log(`  hex: ${t1.subarray(0xfc0, 0xff0).toString('hex')}`);
console.log(`even-turn (T2S) bytes 0xfc0..0xff0:`);
console.log(`  hex: ${t2.subarray(0xfc0, 0xff0).toString('hex')}`);

// Try interpreting as 12 u32 or 6 u64:
console.log(`\nu32 values 0xfc0..0xff0:`);
console.log(`  odd:  ${[...Array(12)].map((_, i) => '0x' + t1.readUInt32LE(0xfc0 + i*4).toString(16).padStart(8,'0')).join(' ')}`);
console.log(`  even: ${[...Array(12)].map((_, i) => '0x' + t2.readUInt32LE(0xfc0 + i*4).toString(16).padStart(8,'0')).join(' ')}`);

console.log(`\nf64 values 0xfc0..0xff0:`);
console.log(`  odd:  ${[...Array(6)].map((_, i) => t1.readDoubleLE(0xfc0 + i*8).toExponential(3)).join(' ')}`);
console.log(`  even: ${[...Array(6)].map((_, i) => t2.readDoubleLE(0xfc0 + i*8).toExponential(3)).join(' ')}`);

// Look at the surrounding context (0xf00..0x1100):
console.log(`\n=== Hexdump of 0xf80..0x1040 (odd-turn T1E) ===`);
const start = 0xf80, end = 0x1040;
for (let off = start; off < end; off += 16) {
  const row = t1.subarray(off, off + 16);
  const hex = [...row].map(b => b.toString(16).padStart(2, '0')).join(' ');
  const ascii = [...row].map(b => b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.').join('');
  console.log(`  0x${off.toString(16).padStart(8,'0')}: ${hex}  ${ascii}`);
}
console.log(`\n=== Hexdump of 0xf80..0x1040 (even-turn T2S) ===`);
for (let off = start; off < end; off += 16) {
  const row = t2.subarray(off, off + 16);
  const hex = [...row].map(b => b.toString(16).padStart(2, '0')).join(' ');
  const ascii = [...row].map(b => b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.').join('');
  console.log(`  0x${off.toString(16).padStart(8,'0')}: ${hex}  ${ascii}`);
}
