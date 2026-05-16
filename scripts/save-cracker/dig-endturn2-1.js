// Quick fact-sheet across the full timeline t0..t3.
// Tracks: turn, year, event counter, path count, journal record count,
// file size, and the size of each known section.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const SAVES = [
  ['t0',             BASE + 'save_t0.sav'],
  ['t0_before_end',  BASE + 'save_t0justbeforeturnend.sav'],
  ['t1',             BASE + 'save_t1.sav'],
  ['t1_adoption',    BASE + 'save_t1adoption.sav'],
  ['t2',             BASE + 'save_t2.sav'],
  ['t2_decline',     BASE + 'save_t2declineadoption.sav'],
  ['t3',             BASE + 'save_t3.sav'],
  ['t3a_adoption',   BASE + 'save_t3a adoption.sav'],
];

function readCounters(buf) {
  const turn = buf.readUInt32LE(0x44e3) + 1;
  const year = buf.readInt32LE(0x44e7);
  const evtCtr = buf.readUInt32LE(0x43f8);
  return { turn, year, evtCtr };
}
function countPaths(buf) {
  let n = 0;
  for (let p = 0xa9000; p + 12 < 0x800000 && p + 12 < buf.length; p++) {
    if (buf.readUInt32LE(p) !== p) continue;
    if (buf.readUInt32LE(p + 8) !== p + 8) continue;
    n++;
  }
  return n;
}
function countJournals(buf) {
  let n = 0;
  for (let p = 0x2000000; p + 30 < buf.length && p < 0x2300000; p++) {
    if (buf.readUInt32LE(p) !== p) continue;
    if (buf.readUInt32LE(p + 4) !== 3) continue;
    const year = buf.readInt32LE(p + 8);
    if (year < -3000 || year > 3000) continue;
    n++;
  }
  return n;
}

console.log('save'.padEnd(16) + '  size       turn  year   evtCtr  paths  journals');
const data = [];
for (const [tag, p] of SAVES) {
  if (!fs.existsSync(p)) { console.log(tag, 'MISSING'); continue; }
  const buf = fs.readFileSync(p);
  const c = readCounters(buf);
  const paths = countPaths(buf);
  const journals = countJournals(buf);
  data.push({ tag, size: buf.length, ...c, paths, journals });
  console.log(tag.padEnd(16) + '  ' + buf.length.toString().padStart(9) +
              '  ' + c.turn.toString().padStart(4) +
              '  ' + c.year.toString().padStart(5) +
              '  ' + c.evtCtr.toString().padStart(6) +
              '  ' + paths.toString().padStart(5) +
              '  ' + journals.toString().padStart(8));
}

console.log('\n=== Pairwise deltas ===');
for (let i = 1; i < data.length; i++) {
  const a = data[i-1], b = data[i];
  console.log('  ' + a.tag.padEnd(14) + ' → ' + b.tag.padEnd(14) +
              '  sizeΔ=' + (b.size - a.size).toString().padStart(8) +
              '  turnΔ=' + (b.turn - a.turn).toString().padStart(2) +
              '  yearΔ=' + (b.year - a.year).toString().padStart(2) +
              '  evtCtrΔ=' + (b.evtCtr - a.evtCtr).toString().padStart(6) +
              '  pathsΔ=' + (b.paths - a.paths).toString().padStart(3) +
              '  journalsΔ=' + (b.journals - a.journals).toString().padStart(3));
}
