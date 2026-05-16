// Roll t6 + t7 into the timeline. Final summary of all per-End-Turn metrics
// across the full t0..t7 corpus (turns 1-8).

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
  ['t7',             BASE + 'save_t7.sav'],
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

console.log('\n=== End Turn deltas only ===');
console.log('pair'.padEnd(40) + '  sizeΔ      pathsΔ  journalsΔ  evtCtrΔ');
const ENDTURNS = [
  ['t0_before_end',  't1'],
  ['t1_adoption',    't2'],
  ['t2_decline',     't3'],
  ['t3a_adoption',   't4'],     // year transition
  ['t4_adoption',    't5'],
  ['t5_adoption',    't6'],
  ['t6',             't7'],
];
const findData = tag => data.find(d => d.tag === tag);
const pathDeltas = [];
const journalDeltas = [];
const sizeDeltas = [];
const evtCtrDeltas = [];
for (const [aTag, bTag] of ENDTURNS) {
  const a = findData(aTag), b = findData(bTag);
  if (!a || !b) continue;
  const yearTick = b.year !== a.year;
  console.log(('  ' + aTag + ' → ' + bTag).padEnd(40) +
              '  ' + String(b.size - a.size).padStart(8) +
              '  ' + String(b.paths - a.paths).padStart(5) +
              '  ' + String(b.journals - a.journals).padStart(8) +
              '  ' + String(b.evtCtr - a.evtCtr).padStart(6) +
              (yearTick ? '  ← YEAR TICK' : ''));
  pathDeltas.push(b.paths - a.paths);
  journalDeltas.push(b.journals - a.journals);
  sizeDeltas.push(b.size - a.size);
  evtCtrDeltas.push(b.evtCtr - a.evtCtr);
}

console.log('\n=== Statistics across the 7 End Turns ===');
const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
const min = arr => Math.min(...arr);
const max = arr => Math.max(...arr);
console.log('  Path Δ:      avg=' + avg(pathDeltas).toFixed(1) + '  min=' + min(pathDeltas) + '  max=' + max(pathDeltas) + '  values=[' + pathDeltas.join(', ') + ']');
console.log('  Journal Δ:   avg=' + avg(journalDeltas).toFixed(1) + '  min=' + min(journalDeltas) + '  max=' + max(journalDeltas) + '  values=[' + journalDeltas.join(', ') + ']');
console.log('  Size Δ (B):  avg=' + Math.round(avg(sizeDeltas)) + '  min=' + min(sizeDeltas) + '  max=' + max(sizeDeltas));
console.log('  EvtCtr Δ:    avg=' + Math.round(avg(evtCtrDeltas)) + '  min=' + min(evtCtrDeltas) + '  max=' + max(evtCtrDeltas));

console.log('\n=== Path-growth pattern with context ===');
console.log('  E1 (t0→t1):  +3   first turn, basic setup-complete');
console.log('  E2 (→t2):    +3   normal turn');
console.log('  E3 (→t3):    +3   normal turn');
console.log('  E4 (→t4):    +0   YEAR TRANSITION (turn 4→5, year -270→-269)');
console.log('  E5 (→t5):    +16  catch-up after year tick?');
console.log('  E6 (→t6):    +4   normal turn');
console.log('  E7 (→t7):    +' + pathDeltas[6] + '   normal turn (year ' + findData('t7').year + ')');
