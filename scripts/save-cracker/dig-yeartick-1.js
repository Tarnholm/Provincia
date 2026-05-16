// Test the 4-turns-per-year hypothesis for RIS imperial. Compare
// t3 (turn 4) → t4 (turn 5) — year should tick from -270 to -269.
// Also process the t4 adoption pair.

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

console.log('save'.padEnd(18) + '  size       turn  year   evtCtr  paths  journals');
const data = [];
for (const [tag, p] of SAVES) {
  if (!fs.existsSync(p)) { console.log(tag, 'MISSING'); continue; }
  const buf = fs.readFileSync(p);
  const c = readCounters(buf);
  data.push({ tag, size: buf.length, ...c, paths: countPaths(buf), journals: countJournals(buf) });
  console.log(tag.padEnd(18) + '  ' + buf.length.toString().padStart(9) +
              '  ' + c.turn.toString().padStart(4) +
              '  ' + c.year.toString().padStart(5) +
              '  ' + c.evtCtr.toString().padStart(6) +
              '  ' + countPaths(buf).toString().padStart(5) +
              '  ' + countJournals(buf).toString().padStart(8));
}

console.log('\n=== Year transition test ===');
const t3 = data.find(d => d.tag === 't3');
const t4 = data.find(d => d.tag === 't4');
if (t3 && t4) {
  console.log('  t3 (turn ' + t3.turn + '): year=' + t3.year);
  console.log('  t4 (turn ' + t4.turn + '): year=' + t4.year);
  console.log('  Year ticked: ' + (t4.year !== t3.year ? 'YES (' + t3.year + ' → ' + t4.year + ')' : 'no'));
  console.log('  4-turns-per-year hypothesis: ' + (t4.turn === 5 && t4.year === t3.year + 1 ? 'CONFIRMED' : 'check'));
}

console.log('\n=== Pairwise deltas (full timeline) ===');
for (let i = 1; i < data.length; i++) {
  const a = data[i-1], b = data[i];
  console.log('  ' + a.tag.padEnd(16) + ' → ' + b.tag.padEnd(16) +
              '  sizeΔ=' + (b.size - a.size).toString().padStart(8) +
              '  turnΔ=' + (b.turn - a.turn).toString().padStart(2) +
              '  yearΔ=' + (b.year - a.year).toString().padStart(2) +
              '  evtCtrΔ=' + (b.evtCtr - a.evtCtr).toString().padStart(6) +
              '  pathsΔ=' + (b.paths - a.paths).toString().padStart(3) +
              '  journalsΔ=' + (b.journals - a.journals).toString().padStart(3));
}

// t4 adoption diff — confirm same +144/+145 fingerprint pattern
const tA = data.find(d => d.tag === 't4');
const tB = data.find(d => d.tag === 't4_adoption');
if (tA && tB) {
  console.log('\n=== t4 → t4_adoption (third adoption event in the campaign) ===');
  console.log('  size Δ:    ' + (tB.size - tA.size));
  console.log('  evtCtr Δ:  ' + (tB.evtCtr - tA.evtCtr) + '  (compare to +144/+145 for first two adoptions)');
  console.log('  paths Δ:   ' + (tB.paths - tA.paths));
  console.log('  journals Δ:' + (tB.journals - tA.journals));
}

// Find new journal record in t4_adoption (the adoptee name)
const A = fs.readFileSync(BASE + 'save_t4.sav');
const B = fs.readFileSync(BASE + 'save_t4 adoption.sav');
function findAllJournalNames(buf) {
  const out = [];
  for (let p = 0x2000000; p + 30 < buf.length && p < 0x2300000; p++) {
    if (buf.readUInt32LE(p) !== p) continue;
    if (buf.readUInt32LE(p + 4) !== 3) continue;
    const year = buf.readInt32LE(p + 8);
    if (year < -3000 || year > 3000) continue;
    const strlen1 = buf.readUInt16LE(p + 20);
    if (strlen1 < 2 || strlen1 > 50) continue;
    const chars = [];
    let ok = true;
    for (let k = 0; k < strlen1; k++) {
      const c = buf.readUInt16LE(p + 22 + k * 2);
      if (c < 0x20 || c > 0x7e) { ok = false; break; }
      chars.push(String.fromCharCode(c));
    }
    if (!ok) continue;
    const str1 = chars.join('');
    let q = p + 22 + strlen1 * 2;
    const strlen2 = buf.readUInt16LE(q);
    if (strlen2 < 2 || strlen2 > 80) continue;
    q += 2;
    const c2 = [];
    let ok2 = true;
    for (let k = 0; k < strlen2; k++) {
      const c = buf.readUInt16LE(q + k * 2);
      if (c < 0x20 || c > 0x7e) { ok2 = false; break; }
      c2.push(String.fromCharCode(c));
    }
    if (!ok2) continue;
    out.push({ off: p, year, str1, str2: c2.join('') });
  }
  return out;
}
const jA = findAllJournalNames(A);
const jB = findAllJournalNames(B);
const setA = new Set(jA.map(j => j.year + '|' + j.str1 + '|' + j.str2));
const onlyInB = jB.filter(j => !setA.has(j.year + '|' + j.str1 + '|' + j.str2));
console.log('\nNew journal entry in t4_adoption (not in t4):');
for (const j of onlyInB) {
  console.log('  0x' + j.off.toString(16) + '  yr=' + j.year + '  "' + j.str1 + '" event="' + j.str2 + '"');
}
