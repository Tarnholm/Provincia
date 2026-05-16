// Diff save_t3 vs "save_t3a adoption.sav" — second adoption event.
// File grew by 583 bytes (vs 248 for the first adoption). Test if it's
// the same record format scaled to a longer message, or a different shape.

const fs = require('fs');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const A = fs.readFileSync(BASE + 'save_t3.sav');
const B = fs.readFileSync(BASE + 'save_t3a adoption.sav');

console.log('A (t3):           ', A.length);
console.log('B (t3a_adoption): ', B.length);
console.log('Δ:                ', B.length - A.length);

// Search for known characters
const NAMES = ['Aulus', 'Biggus', 'Adbugissa', 'Quintus', 'Marcus', 'Lucius', 'Gaius', 'Publius', 'Decimus', 'Titus', 'Sextus', 'Spurius', 'Numerius'];
console.log('\n=== Names in t3 vs t3a_adoption (looking for the new adoptee) ===');
for (const name of NAMES) {
  const needle = Buffer.from(name.split('').flatMap(c => [c.charCodeAt(0), 0]));
  let pA = 0, pB = 0;
  const inA = [], inB = [];
  while ((pA = A.indexOf(needle, pA)) !== -1) { inA.push(pA); pA++; }
  while ((pB = B.indexOf(needle, pB)) !== -1) { inB.push(pB); pB++; }
  if (inA.length !== inB.length) {
    console.log('  "' + name + '" — A:' + inA.length + '  B:' + inB.length + '  ← DIFFERS');
    if (inB.length > inA.length) {
      // Show new occurrences in B
      const aSet = new Set(inA);
      // Position can shift; can't exact-match. Instead show last B positions
      console.log('    B last positions: ' + inB.slice(-3).map(o => '0x' + o.toString(16)).join(', '));
    }
  }
}

// Find the new journal record in B by walking known-record signature
// The format from session 113: u32 selfPtr, u32=3, i32 year, u32, u32,
// u16 strlen, pstr16 name. Find new records in B not in A by counting.
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
console.log('\n=== Journal record counts ===');
console.log('A journal records:', countJournals(A));
console.log('B journal records:', countJournals(B));

// Find a journal record present in B but not in A by checking the first names
function findAllJournalNames(buf, label) {
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
    // Read event type
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

const journalsA = findAllJournalNames(A, 'A');
const journalsB = findAllJournalNames(B, 'B');
console.log('\nA parseable journal records:', journalsA.length);
console.log('B parseable journal records:', journalsB.length);

// Compute set difference by (year, str1, str2)
const keyOf = j => j.year + '|' + j.str1 + '|' + j.str2;
const setA = new Set(journalsA.map(keyOf));
const setB = new Set(journalsB.map(keyOf));
const onlyInB = journalsB.filter(j => !setA.has(keyOf(j)));
const onlyInA = journalsA.filter(j => !setB.has(keyOf(j)));
console.log('\nJournal entries in B but NOT in A (new in adoption save):', onlyInB.length);
for (const j of onlyInB.slice(0, 10)) {
  console.log('  0x' + j.off.toString(16) + '  yr=' + j.year + '  "' + j.str1 + '" event="' + j.str2 + '"');
}
console.log('\nJournal entries in A but NOT in B:', onlyInA.length);
for (const j of onlyInA.slice(0, 5)) {
  console.log('  0x' + j.off.toString(16) + '  yr=' + j.year + '  "' + j.str1 + '" event="' + j.str2 + '"');
}

// Counters
function counters(buf, label) {
  console.log(label.padEnd(24) + '  turn=' + (buf.readUInt32LE(0x44e3) + 1) +
              '  year=' + buf.readInt32LE(0x44e7) +
              '  evtCtr@0x43f8=' + buf.readUInt32LE(0x43f8));
}
console.log('\n=== Counters ===');
counters(A, 'A (t3)');
counters(B, 'B (t3a_adoption)');
