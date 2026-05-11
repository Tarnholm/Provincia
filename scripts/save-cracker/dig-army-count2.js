// Inspect the 5 Alex faction records: positions, treasuries, region-list IDs.
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

const turns = [1, 5, 10, 13, 20, 50, 90, 97].map(t => ({
  t, buf: load(`Autosave   Macedon   Turn ${t} Start`)
})).filter(x => x.buf);

for (const tt of turns) {
  const recs = findMajorFactionRecords(tt.buf);
  console.log(`\n=== T${tt.t}S — ${recs.length} faction records ===`);
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    const ids = [];
    for (let k = 0; k < r.N; k++) ids.push(tt.buf.readUInt32LE(r.offset + 52 + k*4));
    const next = recs[i+1] ? recs[i+1].offset : tt.buf.length;
    const trailingLen = next - r.offset;
    console.log(`  [${i}] 0x${r.offset.toString(16).padStart(8,'0')} tr=${r.treasury.toString().padStart(7)} N=${r.N.toString().padStart(2)} trailing=${trailingLen.toString().padStart(7)} regions=[${ids.slice(0,8).join(',')}]`);
  }
}
