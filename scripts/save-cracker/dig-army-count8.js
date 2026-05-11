// Different approach: each faction's record contains a region-id list in its
// header. Maybe the trailing data has a u16 or u8 count of generals/agents.
//
// Strategy: for each faction in each turn, find the start of trailing data
// (which is +52 + 4*N after the record start, then continues until the next
// faction record's offset). Look at the first 200 bytes of trailing data for
// small ints that could be "number of generals" or "number of armies".

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

// For T1-T13 single contiguous game, check various counter offsets immediately
// after the region list (+52 + 4*N) in Macedon record only.
const turns = [];
for (let t = 1; t <= 13; t++) {
  const buf = load(`Autosave   Macedon   Turn ${t} Start`);
  if (!buf) continue;
  const recs = findMajorFactionRecords(buf);
  if (recs.length !== 5) continue;
  turns.push({ t, recs, buf });
}
console.log(`Loaded ${turns.length} Macedon T1-T13 saves`);

// For each turn, print Macedon record bytes immediately AFTER region-list end:
// region-list ends at offset +52 + 4*N. The dossier says treasury-dup is at +(92+4N).
// So inter-data is +52+4N to +(92+4N) = 40 bytes.
// Print +52+4N..+92+4N for player record across turns.
console.log(`\nMacedon (player) region-list-end area:`);
for (const turn of turns) {
  const player = turn.recs[0];
  const N = player.N;
  const regionEnd = player.offset + 52 + N * 4;  // after N region IDs
  const treasureDup = player.offset + 92 + N * 4;
  // Bytes between
  const slice = turn.buf.subarray(regionEnd, treasureDup);
  console.log(`  T${turn.t}: regions=${N}  bytes(${regionEnd.toString(16)}..${treasureDup.toString(16)}): ${slice.toString('hex')}`);
}

// Now: look at the 24 bytes immediately after treasury-dup (+96+4N to +116+4N)
console.log(`\nMacedon post-treasury-dup 24 bytes (likely first sub-record header):`);
for (const turn of turns) {
  const player = turn.recs[0];
  const N = player.N;
  const off = player.offset + 96 + N * 4;
  const slice = turn.buf.subarray(off, off + 24);
  console.log(`  T${turn.t}: bytes(+${(96+N*4)}): ${slice.toString('hex')}`);
}
