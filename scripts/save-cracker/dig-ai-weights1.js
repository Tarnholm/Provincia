// Session 21 stretch: decode the 0xfc0..0xfef AI weight vector and 0xffc counter
// across the 19-turn Macedon corpus.
//
// Each save is a "Turn N Start" file; we read u32/f32 at fixed offsets and
// look for patterns:
//   - monotone trends → cumulative
//   - turn-flicker → "current target"
//   - correlation with turn N or total armies → strategic measure
//
// Cross-validation: also try Alexander pre-RIS saves (saveturn1start ↔
// saveturn2start) to see if the same fields exist with similar structure.

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
for (let t = 1; t <= 99; t++) {
  const s = load(`Autosave   Macedon   Turn ${t} Start`);
  if (s) turns.push({ t, label: `T${t}S`, buf: s });
  const e = load(`Autosave   Macedon   Turn ${t} End`);
  if (e) turns.push({ t, label: `T${t}E`, buf: e });
}
console.log(`Loaded ${turns.length} Macedon turn snapshots`);

// Decode 0xfc0..0xfef as 12 u32 + 12 f32. Print per turn.
console.log(`\n=== 0xfc0..0xfef (12 u32 / 12 f32) over time ===`);
console.log(`turn       w0_u32    w1_u32    w2_u32    w3_u32   w4_u32   w5_u32   w0_f32     w1_f32     w2_f32     w3_f32`);
for (const t of turns) {
  const b = t.buf;
  if (b.length < 0x1000) continue;
  const u = [];
  const f = [];
  for (let i = 0; i < 12; i++) {
    u.push(b.readUInt32LE(0xfc0 + i*4));
    f.push(b.readFloatLE(0xfc0 + i*4));
  }
  console.log(`${t.label.padStart(6)}  ${u.slice(0,6).map(v => '0x' + v.toString(16).padStart(8,'0')).join(' ')}  ${f.slice(0,4).map(v => v.toExponential(2).padStart(10)).join(' ')}`);
}

// 0xffc u32
console.log(`\n=== 0xffc u32 over time ===`);
console.log(`turn    val_dec     val_hex   delta`);
let prev = null;
for (const t of turns) {
  const b = t.buf;
  if (b.length < 0x1000) continue;
  const v = b.readUInt32LE(0xffc);
  const delta = prev === null ? '' : (v - prev);
  console.log(`${t.label.padStart(6)}  ${v.toString().padStart(8)}  0x${v.toString(16).padStart(8,'0')}  ${delta}`);
  prev = v;
}
