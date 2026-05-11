// Field +212 (relative to Macedon record start, abs offset +208 + 4 = +212 from start
// of player record) shows monotone counter. Dump surrounding bytes to understand
// the local data structure.

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

const turns = [];
for (let t = 1; t <= 20; t++) {
  const buf = load(`Autosave   Macedon   Turn ${t} Start`);
  if (!buf) continue;
  const recs = findMajorFactionRecords(buf);
  if (recs.length !== 5) continue;
  turns.push({ t, recs, buf });
}

// Print bytes +192..+256 for Macedon record per turn
console.log(`Macedon record bytes +192..+256 by turn:`);
for (const turn of turns) {
  const p = turn.recs[0];
  const slice = turn.buf.subarray(p.offset + 192, p.offset + 256);
  console.log(`  T${turn.t.toString().padStart(2)}: ${slice.toString('hex').match(/.{1,8}/g).join(' ')}`);
}

// Also check the SAME relative position in non-player faction records
console.log(`\nT13: All 5 faction records' bytes around +(92+4N)..+(92+4N+64):`);
const t13 = turns.find(t => t.t === 13);
for (let i = 0; i < 5; i++) {
  const r = t13.recs[i];
  const start = r.offset + 92 + r.N * 4;
  const slice = t13.buf.subarray(start, start + 64);
  console.log(`  faction[${i}] N=${r.N}: ${slice.toString('hex').match(/.{1,8}/g).join(' ')}`);
}

// Trace +212-equivalent across factions through T1-T20
console.log(`\nField at +(92+4N+20) per turn per faction (Macedon player only — does it tick when player recruits?):`);
for (const turn of turns) {
  const vals = turn.recs.map(r => turn.buf.readUInt32LE(r.offset + 92 + r.N * 4 + 20));
  console.log(`  T${turn.t.toString().padStart(2)}: [${vals.join(', ')}]`);
}
