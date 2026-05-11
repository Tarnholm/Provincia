// Session 21: per-faction army count probe.
//
// Step 1: locate the 23 major-faction records in Macedon T1S, T3S, T5S, ..., T13S
// using the session-5 signature: u32(i+8)=100, u32(i+12)=1, u32(i+24)=i+24, etc.
// Step 2: for each turn's Macedon record (index 0 = player), enumerate the trailing
// data and look for u32 fields that monotonically increase (army count ticks
// when a general is recruited).

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
    // +8=100, +12=1, +24=i+24, +40=i+40, +44=6
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

// Use just T1S, T7S, T13S, T20S, T50S to span recruitment + battle activity.
const turns = [1, 5, 10, 13, 20, 30, 40, 50, 60, 70, 80, 90, 97].map(t => ({
  t,
  buf: load(`Autosave   Macedon   Turn ${t} Start`)
})).filter(x => x.buf);

console.log(`Loaded ${turns.length} Macedon snapshots`);
for (const turn of turns) {
  const recs = findMajorFactionRecords(turn.buf);
  console.log(`T${turn.t.toString().padStart(2)}S: ${recs.length} major-faction records found`);
  // Identify player slot (index 0)
  if (recs.length === 23) {
    const player = recs[0];
    console.log(`   player slot: 0x${player.offset.toString(16)} treasury=${player.treasury} N=${player.N}`);
  }
}
