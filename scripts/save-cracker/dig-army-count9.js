// Focus on the changing field: bytes at +208..+216 from player record start.
// Decode as u32 and i32.

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

// All Macedon T1-T20 from continuous game
const turns = [];
for (let t = 1; t <= 20; t++) {
  const buf = load(`Autosave   Macedon   Turn ${t} Start`);
  if (!buf) continue;
  const recs = findMajorFactionRecords(buf);
  if (recs.length !== 5) continue;
  turns.push({ t, recs, buf });
}

// Look at offsets +192, +200, +204, +208, +212, +216 from player record start.
// For Macedon T2 with N=25: post-region-list is at +52+100 = +152.
// Treasury-dup is at +92+100 = +192. So +192 is treasury-dup, +196.. = trailing.
console.log(`Macedon player record fields near treasury-dup:`);
console.log(`turn  +0(treas) | +192(tdup) | +196 | +200 | +204 | +208 | +212 | +216`);
for (const turn of turns) {
  const p = turn.recs[0];
  const f = (off) => turn.buf.readUInt32LE(p.offset + off);
  const fi = (off) => turn.buf.readInt32LE(p.offset + off);
  console.log(`T${turn.t.toString().padStart(2)}: ${fi(0).toString().padStart(7)} | ${fi(192).toString().padStart(7)} | ${f(196).toString().padStart(6)} | ${f(200).toString().padStart(6)} | ${f(204).toString().padStart(6)} | ${f(208).toString().padStart(6)} | ${f(212).toString().padStart(6)} | ${f(216).toString().padStart(6)}`);
}

// Now look at offsets across all 5 records — see if a similar field exists in non-player records.
console.log(`\nAll 5 factions T13 — field at +208:`);
const t13 = turns.find(t => t.t === 13);
if (t13) {
  for (let i = 0; i < 5; i++) {
    const r = t13.recs[i];
    const N = r.N;
    // The "+208" only makes sense at +(92+4N+16). Let's compute that for each record.
    const off = 92 + N * 4 + 16; // = +208 when N=25
    const val = t13.buf.readUInt32LE(r.offset + off);
    const treas = t13.buf.readInt32LE(r.offset);
    const tdup = t13.buf.readInt32LE(r.offset + 92 + N * 4);
    console.log(`  faction[${i}] N=${N}  treasury=${treas}  treasury-dup=${tdup}  field@+(96+4N+12)=${val}`);
  }
}
