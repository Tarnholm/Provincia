// Direct verification of the Aulus UTF-16 match position.

const fs = require('fs');
const B = fs.readFileSync('C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_t1adoption.sav');
const A = fs.readFileSync('C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_t1.sav');

// Build needle directly as Buffer
const needle = Buffer.from([0x41, 0x00, 0x75, 0x00, 0x6c, 0x00, 0x75, 0x00, 0x73, 0x00]);
console.log('Needle:', Array.from(needle).map(b => b.toString(16).padStart(2,'0')).join(' '), '(=', needle.toString('utf16le') + ')');

const hits = [];
let p = 0;
while ((p = B.indexOf(needle, p)) !== -1) { hits.push(p); p++; }
console.log('Total hits in B (save_t1adoption):', hits.length, 'positions:', hits.map(h => '0x' + h.toString(16)));

const hitsA = [];
p = 0;
while ((p = A.indexOf(needle, p)) !== -1) { hitsA.push(p); p++; }
console.log('Total hits in A (save_t1):', hitsA.length, 'positions:', hitsA.map(h => '0x' + h.toString(16)));

for (const o of hits.slice(0, 3)) {
  console.log('\nHit at 0x' + o.toString(16) + ' (decimal ' + o + '):');
  console.log('  Bytes at hit:', Array.from(B.subarray(o, o + 20)).map(b => b.toString(16).padStart(2, '0')).join(' '));
  console.log('  As UTF-16LE:', '"' + B.toString('utf16le', o, o + 30).replace(/[\x00-\x1f]/g, '?') + '"');
  console.log('  30 bytes before:', Array.from(B.subarray(o - 30, o)).map(b => b.toString(16).padStart(2, '0')).join(' '));
  console.log('  30 bytes after:', Array.from(B.subarray(o + 10, o + 40)).map(b => b.toString(16).padStart(2, '0')).join(' '));

  // Look back 16 bytes for a u16 strlen prefix
  for (let k = 2; k <= 16; k += 2) {
    const lenChars = B.readUInt16LE(o - 2 - 0);  // u16 right before the chars
    if (lenChars === 5) {
      console.log('  Length prefix (u16 at -2) = 5 ✓ valid pstr16 UTF-16');
      break;
    }
  }
  // Check u16 strlen immediately before
  console.log('  u16 at hit-2 =', B.readUInt16LE(o - 2), '(should be 5 for "Aulus")');
}
