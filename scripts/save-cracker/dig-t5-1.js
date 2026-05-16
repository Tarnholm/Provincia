// Roll t5 saves into the full timeline + capture the adoption #4 event.

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
  for (let p = 0x2000000; p + 30 < buf.length && p < 0x2400000; p++) {
    if (buf.readUInt32LE(p) !== p) continue;
    if (buf.readUInt32LE(p + 4) !== 3) continue;
    const year = buf.readInt32LE(p + 8);
    if (year < -3000 || year > 3000) continue;
    n++;
  }
  return n;
}
function findAllJournalNames(buf) {
  const out = [];
  for (let p = 0x2000000; p + 30 < buf.length && p < 0x2400000; p++) {
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

console.log('\n=== Pairwise deltas ===');
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

// Identify new journal entries between t5 and t5_adoption
const A = fs.readFileSync(BASE + 'save_t5.sav');
const B = fs.readFileSync(BASE + 'save_t5 adoption.sav');
const jA = findAllJournalNames(A);
const jB = findAllJournalNames(B);
const setA = new Set(jA.map(j => j.year + '|' + j.str1 + '|' + j.str2));
const onlyInB = jB.filter(j => !setA.has(j.year + '|' + j.str1 + '|' + j.str2));
console.log('\nNew journal entries in t5_adoption (not in t5):');
for (const j of onlyInB) {
  console.log('  0x' + j.off.toString(16) + '  yr=' + j.year + '  "' + j.str1 + '" event="' + j.str2 + '"');
}

// Also: tabulate ALL adoption event-counter deltas to see if they're really
// inconsistent or if there's a pattern
const adoptions = [];
for (let i = 1; i < data.length; i++) {
  const a = data[i-1], b = data[i];
  if (b.tag.includes('adoption')) {
    adoptions.push({ from: a.tag, to: b.tag, evtCtrΔ: b.evtCtr - a.evtCtr, sizeΔ: b.size - a.size });
  }
}
console.log('\n=== All adoption events (sorted by counter Δ) ===');
adoptions.sort((a, b) => a.evtCtrΔ - b.evtCtrΔ);
for (const a of adoptions) {
  console.log('  ' + a.from.padEnd(16) + ' → ' + a.to.padEnd(16) + '  evtCtrΔ=' + String(a.evtCtrΔ).padStart(4) + '  sizeΔ=' + String(a.sizeΔ).padStart(5));
}
