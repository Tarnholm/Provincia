// Trace the +(92+4N+16) and +(92+4N+20) and +(92+4N+24) fields across T1-T50,
// for all 5 factions.

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
for (let t = 1; t <= 99; t++) {
  const buf = load(`Autosave   Macedon   Turn ${t} Start`);
  if (!buf) continue;
  const recs = findMajorFactionRecords(buf);
  if (recs.length !== 5) continue;
  turns.push({ t, recs, buf });
}

// For each turn, extract A, B, C from all 5 factions
console.log(`Per-faction A/B/C fields at +(92+4N+16), +20, +24 (A=cumul, B=intra-turn, C=cumul):`);
console.log(`turn  Macedon_ABC | F1_ABC | F2_ABC | F3_ABC | F4_ABC | treasury`);
for (const turn of turns) {
  const data = turn.recs.map(r => {
    const base = r.offset + 92 + r.N * 4;
    return {
      A: turn.buf.readUInt32LE(base + 16),
      B: turn.buf.readUInt32LE(base + 20),
      C: turn.buf.readUInt32LE(base + 24),
      tr: r.treasury
    };
  });
  const m = data[0];
  const others = data.slice(1).map(d => `${d.A}/${d.B}/${d.C}`).join(' | ');
  console.log(`T${turn.t.toString().padStart(2)}: ${m.A}/${m.B}/${m.C}  | ${others}  | ${m.tr}`);
}
