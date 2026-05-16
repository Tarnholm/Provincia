// Quick fact-check on T0→T1: year advance, turn advance, event-log
// counter advance, CHARACTER_PATHS growth.

const fs = require('fs');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const t0 = fs.readFileSync(BASE + 'save_t0.sav');
const t0e = fs.readFileSync(BASE + 'save_t0justbeforeturnend.sav');
const t1 = fs.readFileSync(BASE + 'save_t1.sav');
const t1a = fs.readFileSync(BASE + 'save_t1adoption.sav');

function readSave(buf, label) {
  const turnRaw = buf.readUInt32LE(0x44e3);  // session 104
  const year = buf.readInt32LE(0x44e7);
  const evtCtr = buf.readUInt32LE(0x43f8);  // session 110
  console.log(label.padEnd(34) + '  size=' + buf.length +
              '  turn=' + (turnRaw + 1).toString().padStart(3) + ' (raw=' + turnRaw + ')' +
              '  year=' + year +
              '  evtCtr@0x43f8=' + evtCtr + ' (=0x' + evtCtr.toString(16) + ')');
}
readSave(t0,  'save_t0');
readSave(t0e, 'save_t0justbeforeturnend');
readSave(t1,  'save_t1');
readSave(t1a, 'save_t1adoption');

console.log('\n=== Event counter deltas ===');
console.log('  t0 → t0_before_end:', t0e.readUInt32LE(0x43f8) - t0.readUInt32LE(0x43f8), '(noise floor from pure resave)');
console.log('  t0_before_end → t1:', t1.readUInt32LE(0x43f8) - t0e.readUInt32LE(0x43f8), '(End Turn advance)');
console.log('  t1 → t1adoption:   ', t1a.readUInt32LE(0x43f8) - t1.readUInt32LE(0x43f8), '(adoption event)');

// CHARACTER_PATHS path count in each save
function countPaths(buf) {
  let n = 0;
  for (let p = 0xa9000; p + 12 < 0x800000 && p + 12 < buf.length; p++) {
    if (buf.readUInt32LE(p) !== p) continue;
    if (buf.readUInt32LE(p + 8) !== p + 8) continue;
    n++;
  }
  return n;
}
console.log('\n=== CHARACTER_PATHS record count ===');
const p0 = countPaths(t0);
const p0e = countPaths(t0e);
const p1 = countPaths(t1);
const p1a = countPaths(t1a);
console.log('  t0:             ', p0, 'paths');
console.log('  t0_before_end:  ', p0e, 'paths  (Δ ' + (p0e - p0) + ')');
console.log('  t1:             ', p1, 'paths  (Δ ' + (p1 - p0e) + ' from end of turn)');
console.log('  t1adoption:     ', p1a, 'paths  (Δ ' + (p1a - p1) + ' from adoption)');

// What's the LAST byte that's still in the CHARACTER_PATHS area for each save?
// (where does the 320 KB section end / does it expand?)
function findPathSectionEnd(buf) {
  // Walk path records forward until we stop finding self-pointers
  let p = 0xa9000;
  let last = p;
  while (p + 12 < buf.length) {
    if (buf.readUInt32LE(p) === p && buf.readUInt32LE(p + 8) === p + 8) {
      last = p;
      // Skip to next likely path start (heuristic — find next self-ptr)
      let q = p + 16;
      while (q + 4 <= buf.length && buf.readUInt32LE(q) !== q) q++;
      if (q > buf.length - 12) break;
      p = q;
    } else {
      break;
    }
  }
  return last;
}
console.log('\n=== Last self-pointing record in path section ===');
console.log('  t0: 0x' + findPathSectionEnd(t0).toString(16));
console.log('  t1: 0x' + findPathSectionEnd(t1).toString(16));
console.log('  t1a: 0x' + findPathSectionEnd(t1a).toString(16));
