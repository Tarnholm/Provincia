// Compare what's around "Aulus" in t2 (accept) vs t2decline.
// In both saves Aulus appears once. The surrounding journal record
// should differ in event type / message.

const fs = require('fs');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const A = fs.readFileSync(BASE + 'save_t2declineadoption.sav');
const B = fs.readFileSync(BASE + 'save_t2.sav');

const AULUS_A = 0x218b421;
const AULUS_B = 0x218b697;

function dump(label, buf, off, len) {
  for (let o = off; o < off + len; o += 16) {
    const slice = buf.subarray(o, Math.min(o + 16, off + len));
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  ' + label + ' 0x' + o.toString(16) + ': ' + hex.padEnd(48) + '  ' + asc);
  }
}

console.log('=== Aulus journal record in t2_declineadoption ===');
dump('A', A, AULUS_A - 40, 300);

console.log('\n=== Aulus journal record in t2 (adoption accepted) ===');
dump('B', B, AULUS_B - 40, 300);

// Parse the journal record by walking 3 pstr16 strings forward from
// a self-pointer position.
function parseJournalAt(buf, hint) {
  // Find the journal record header: self-pointer at hint-some-offset
  // The structure is: u32 selfPtr, u32 ver=3, i32 year, u32 ..., u32 ...,
  // u16 strlen N1, pstr16 N1, u16 strlen N2, pstr16 N2, u16 strlen N3, pstr16 N3
  // Aulus is the 5-char first string, so the record's "u16 N1" is 2 bytes before
  // hint, and the record self-pointer is at hint - 22.
  const recStart = hint - 22;
  if (recStart < 0) return null;
  const selfPtr = buf.readUInt32LE(recStart);
  const ver = buf.readUInt32LE(recStart + 4);
  const year = buf.readInt32LE(recStart + 8);
  const v12 = buf.readUInt32LE(recStart + 12);
  const v16 = buf.readUInt32LE(recStart + 16);
  const len1 = buf.readUInt16LE(recStart + 20);
  if (selfPtr !== recStart) return null;
  let p = recStart + 22;
  const str1Chars = [];
  for (let i = 0; i < len1; i++) str1Chars.push(String.fromCharCode(buf.readUInt16LE(p + i * 2)));
  p += len1 * 2;
  const len2 = buf.readUInt16LE(p);
  p += 2;
  const str2Chars = [];
  for (let i = 0; i < len2; i++) str2Chars.push(String.fromCharCode(buf.readUInt16LE(p + i * 2)));
  p += len2 * 2;
  const len3 = buf.readUInt16LE(p);
  p += 2;
  const str3Chars = [];
  if (len3 > 0 && len3 < 500) {
    for (let i = 0; i < len3; i++) str3Chars.push(String.fromCharCode(buf.readUInt16LE(p + i * 2)));
  }
  return { recStart, selfPtr, ver, year, v12, v16, str1: str1Chars.join(''), str2: str2Chars.join(''), str3: str3Chars.join('') };
}

console.log('\n=== Parsed journal records ===');
const recA = parseJournalAt(A, AULUS_A);
const recB = parseJournalAt(B, AULUS_B);
console.log('\nA (t2_declineadoption):');
console.log(JSON.stringify(recA, null, 2));
console.log('\nB (t2 accept):');
console.log(JSON.stringify(recB, null, 2));

// Also look for Biggus / portrait-path / etc to see what other diffs exist
console.log('\n=== Other journal records (any with str1 matching common names) — search both ===');
const knownNames = ['Aulus', 'Biggus', 'Adbugissa'];
for (const name of knownNames) {
  const needle = Buffer.from(name.split('').flatMap(c => [c.charCodeAt(0), 0]));
  const inA = [];
  let p = 0;
  while ((p = A.indexOf(needle, p)) !== -1) { inA.push(p); p++; }
  const inB = [];
  p = 0;
  while ((p = B.indexOf(needle, p)) !== -1) { inB.push(p); p++; }
  console.log('  "' + name + '" in A:', inA.length, 'in B:', inB.length);
}

// Total journal record count in each save
console.log('\n=== Count of journal-like records (selfPtr at pos, ver=3, year in -3000..3000) ===');
function countJournals(buf) {
  let n = 0;
  for (let p = 0x2100000; p + 30 < buf.length && p < 0x2300000; p++) {
    if (buf.readUInt32LE(p) !== p) continue;
    if (buf.readUInt32LE(p + 4) !== 3) continue;
    const year = buf.readInt32LE(p + 8);
    if (year < -3000 || year > 3000) continue;
    n++;
  }
  return n;
}
console.log('  A journal records:', countJournals(A));
console.log('  B journal records:', countJournals(B));
