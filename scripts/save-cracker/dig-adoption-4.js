// Decode the adoption journal record at 0x2144b4b in save_t1adoption.
// Check if save_t1 has the same region (different content) or completely lacks the record.

const fs = require('fs');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const B = fs.readFileSync(BASE + 'save_t1adoption.sav');
const A = fs.readFileSync(BASE + 'save_t1.sav');

console.log('=== Adoption journal record at 0x2144b4b in t1adoption (full dump) ===');
const START = 0x2144b4b;
function dump(label, buf, off, len) {
  for (let o = off; o < off + len; o += 16) {
    const slice = buf.subarray(o, Math.min(o + 16, off + len));
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  ' + label + ' 0x' + o.toString(16) + ': ' + hex.padEnd(48) + '  ' + asc);
  }
}

// 300 bytes of journal record
dump('B', B, START, 300);

// Read decoded fields
console.log('\nDecoded fields:');
console.log('  +0  u32 selfPtr  = 0x' + B.readUInt32LE(START + 0).toString(16) + ' (expect 0x' + START.toString(16) + ')  match=' + (B.readUInt32LE(START + 0) === START));
console.log('  +4  u32         = ' + B.readUInt32LE(START + 4));
console.log('  +8  i32         = ' + B.readInt32LE(START + 8) + ' (expect -270 year)');
console.log('  +12 u32         = ' + B.readUInt32LE(START + 12));
console.log('  +16 u32         = ' + B.readUInt32LE(START + 16));
console.log('  +20 u16 strlen  = ' + B.readUInt16LE(START + 20));
// Walk strings
let p = START + 22;
const reads = 5;
for (let i = 0; i < reads; i++) {
  const lenChars = B.readUInt16LE(p - 2);  // assume strlen is just-before
  const chars = [];
  for (let j = 0; j < lenChars && p + j * 2 + 2 <= B.length; j++) {
    chars.push(String.fromCharCode(B.readUInt16LE(p + j * 2)));
  }
  console.log('  +' + (p - START) + ' UTF-16 string (' + lenChars + ' chars): "' + chars.join('') + '"');
  p += lenChars * 2;
  if (i < reads - 1) {
    // Read next strlen
    if (p + 2 > B.length) break;
    const nextLen = B.readUInt16LE(p);
    console.log('  +' + (p - START) + ' u16 next strlen = ' + nextLen);
    p += 2;
    if (nextLen === 0 || nextLen > 200) break;
  }
}
console.log('  (string-walk stopped at +' + (p - START) + ')');

// Continue dumping after the strings
console.log('\nBytes after the strings (+' + (p - START) + '..+' + (p - START + 80) + '):');
dump('B', B, p, 80);

// Look for the same byte sequence "5 0 41 0 75 0 6c 0 75 0 73 0" (pstr16 Aulus) in t1
console.log('\n=== Same offset region in save_t1 (pre-adoption) ===');
dump('A', A, START - 16, 300);

// Test: is the file CONTENT-identical from A and B at positions before START?
let firstDiff = -1;
for (let i = 0; i < START && i < A.length; i++) {
  if (A[i] !== B[i]) { firstDiff = i; break; }
}
console.log('\nFirst byte difference between A and B (forward scan): 0x' + firstDiff.toString(16));

// And from the END going backward
let lastDiffFromEnd = -1;
let bi = B.length - 1, ai = A.length - 1;
while (bi >= 0 && ai >= 0) {
  if (A[ai] !== B[bi]) { lastDiffFromEnd = bi; break; }
  bi--; ai--;
}
console.log('Last diff (B-relative) when aligning from end: 0x' + lastDiffFromEnd.toString(16));
console.log('  (everything after 0x' + lastDiffFromEnd.toString(16) + ' is identical from the END perspective)');

// Search for "Adoption" UTF-16 in A
const adoptionNeedle = Buffer.from([0x41, 0x00, 0x64, 0x00, 0x6f, 0x00, 0x70, 0x00, 0x74, 0x00, 0x69, 0x00, 0x6f, 0x00, 0x6e, 0x00]);
const adopA = [];
let q = 0;
while ((q = A.indexOf(adoptionNeedle, q)) !== -1) { adopA.push(q); q++; }
const adopB = [];
q = 0;
while ((q = B.indexOf(adoptionNeedle, q)) !== -1) { adopB.push(q); q++; }
console.log('\n"Adoption" UTF-16 occurrences in A:', adopA.length, 'in B:', adopB.length);
console.log('  A:', adopA.slice(0, 5).map(o => '0x' + o.toString(16)));
console.log('  B:', adopB.slice(0, 5).map(o => '0x' + o.toString(16)));
