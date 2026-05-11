// Drill into the best candidate: Macedon record +350 (range=19, dd=2).
// Also check other interesting candidates. Print full per-turn series.

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

const candidates = [350, 293, 388, 422, 554, 1436, 1440, 294, 1129];

const turns = [];
for (let t = 1; t <= 99; t++) {
  const buf = load(`Autosave   Macedon   Turn ${t} Start`);
  if (!buf) continue;
  const recs = findMajorFactionRecords(buf);
  if (recs.length !== 5) continue;
  const trailing = buf.subarray(recs[0].offset, recs[1].offset);
  turns.push({ t, trailing });
}

console.log(`turn  ${candidates.map(c => '+'+c.toString().padStart(4)).join(' ')}`);
for (const t of turns.slice(0, 100)) {
  const vals = candidates.map(c => t.trailing.readUInt32LE(c));
  console.log(`T${t.t.toString().padStart(3)}  ${vals.map(v => v.toString().padStart(5)).join(' ')}`);
}
