// Decode 0xfa0..0x1010 as a structured payload. Hypothesis: this is a small
// table of (key, value) pairs where one row alternates per turn.

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

const t1 = load(`Autosave   Macedon   Turn 1 End`);
const t2 = load(`Autosave   Macedon   Turn 2 Start`);

function decodeAsF32(buf, label) {
  console.log(`\n=== ${label} f32 array 0xfc0..0xff0 ===`);
  for (let i = 0; i < 12; i++) {
    const f = buf.readFloatLE(0xfc0 + i*4);
    const u = buf.readUInt32LE(0xfc0 + i*4);
    console.log(`  +${(i*4).toString().padStart(2)} 0x${(0xfc0+i*4).toString(16)} = 0x${u.toString(16).padStart(8,'0')}  f32=${f.toExponential(4).padStart(13)}  i32=${(u | 0).toString().padStart(11)}`);
  }
}
decodeAsF32(t1, 'T1E (odd)');
decodeAsF32(t2, 'T2S (even)');

// Try (X, Y) interpretation: alternating pairs of f32 might be tile or pixel coords.
// Map is ~130x69 tiles for Alex (Macedon campaign). Let's see if (val1 / 100, val2 / 100)
// land in plausible map coords.
console.log(`\n=== Coord-pair interpretation ===`);
for (let i = 0; i < 12; i += 2) {
  const f1 = t1.readFloatLE(0xfc0 + i*4);
  const f2 = t1.readFloatLE(0xfc0 + (i+1)*4);
  console.log(`  T1E pair ${i/2}: (${f1.toExponential(2)}, ${f2.toExponential(2)})`);
}
for (let i = 0; i < 12; i += 2) {
  const f1 = t2.readFloatLE(0xfc0 + i*4);
  const f2 = t2.readFloatLE(0xfc0 + (i+1)*4);
  console.log(`  T2S pair ${i/2}: (${f1.toExponential(2)}, ${f2.toExponential(2)})`);
}

// Note the bytes at 0xfd0+ that are also alternating, with 0xfd4-0xfd7 stable.
// Show 0xfd0..0xff0 as f32:
console.log(`\n=== 0xfd0..0xff0 sub-block at f32 offsets ===`);
for (let off = 0xfd0; off < 0x1000; off += 4) {
  console.log(`  0x${off.toString(16)}: T1E=0x${t1.readUInt32LE(off).toString(16).padStart(8,'0')} (f32=${t1.readFloatLE(off).toExponential(2)})  T2S=0x${t2.readUInt32LE(off).toString(16).padStart(8,'0')} (f32=${t2.readFloatLE(off).toExponential(2)})  ${t1.readUInt32LE(off) === t2.readUInt32LE(off) ? 'SAME' : 'DIFF'}`);
}
