// Roll t6 into the timeline. With 13 saves spanning turns 1-7 we can
// pattern-test the per-turn cadence properly.

const fs = require('fs');

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
  ['t4',             BASE + 'save_t4.sav'],
  ['t4_adoption',    BASE + 'save_t4 adoption.sav'],
  ['t5',             BASE + 'save_t5.sav'],
  ['t5_adoption',    BASE + 'save_t5 adoption.sav'],
  ['t6',             BASE + 'save_t6.sav'],
];

function readCounters(buf) {
  return {
    turn: buf.readUInt32LE(0x44e3) + 1,
    year: buf.readInt32LE(0x44e7),
    evtCtr: buf.readUInt32LE(0x43f8),
  };
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
  for (let p = 0x2000000; p + 30 < buf.length && p < 0x2500000; p++) {
    if (buf.readUInt32LE(p) !== p) continue;
    if (buf.readUInt32LE(p + 4) !== 3) continue;
    const year = buf.readInt32LE(p + 8);
    if (year < -3000 || year > 3000) continue;
    n++;
  }
  return n;
}

console.log('save'.padEnd(18) + '  size       turn  year   evtCtr  paths  journals');
const data = [];
for (const [tag, p] of SAVES) {
  if (!fs.existsSync(p)) { console.log(tag, 'MISSING'); continue; }
  const buf = fs.readFileSync(p);
  const c = readCounters(buf);
  const paths = countPaths(buf);
  const journals = countJournals(buf);
  data.push({ tag, size: buf.length, paths, journals, ...c });
  console.log(tag.padEnd(18) + '  ' + buf.length.toString().padStart(9) +
              '  ' + c.turn.toString().padStart(4) +
              '  ' + c.year.toString().padStart(5) +
              '  ' + c.evtCtr.toString().padStart(6) +
              '  ' + paths.toString().padStart(5) +
              '  ' + journals.toString().padStart(8));
}

console.log('\n=== End Turn deltas only (filtering out adoptions/resaves/declines) ===');
console.log('save-pair'.padEnd(40) + '  sizeΔ      pathsΔ  journalsΔ  evtCtrΔ');
const ENDTURNS = [
  [0, 2],  // t0_before_end → t1
  [3, 4],  // t1_adoption → t2
  [5, 6],  // t2_decline → t3
  [7, 8],  // t3a_adoption → t4 (year transition!)
  [9, 10], // t4_adoption → t5
  [11, 12], // t5_adoption → t6
];
for (const [aIdx, bIdx] of ENDTURNS) {
  const a = data[aIdx], b = data[bIdx];
  if (!a || !b) continue;
  const yearTick = b.year !== a.year;
  console.log(('  ' + a.tag + ' → ' + b.tag).padEnd(40) +
              '  ' + String(b.size - a.size).padStart(8) +
              '  ' + String(b.paths - a.paths).padStart(5) +
              '  ' + String(b.journals - a.journals).padStart(8) +
              '  ' + String(b.evtCtr - a.evtCtr).padStart(6) +
              (yearTick ? '  ← YEAR TRANSITION' : ''));
}

console.log('\n=== Path-Δ summary ===');
console.log('Across 6 End Turns: 3, 3, 3, 0, 16, ?');
console.log('Year-transition (t4) was the +0. Now t6 tells us about a normal mid-campaign turn.');

console.log('\n=== Size growth trend ===');
for (let i = 1; i < ENDTURNS.length; i++) {
  const cur = data[ENDTURNS[i][1]].size - data[ENDTURNS[i][0]].size;
  const prev = data[ENDTURNS[i-1][1]].size - data[ENDTURNS[i-1][0]].size;
  console.log('  End Turn ' + (i + 1) + ': ' + cur + ' bytes (' + ((cur/prev) * 100).toFixed(0) + '% of previous)');
}
