// Dump Aulus's full character record (UTF-16 "Aulus" at 0x214A961 in t1adoption)
// and find the persistent character UUID assigned by the save engine.

const fs = require('fs');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const B = fs.readFileSync(BASE + 'save_t1adoption.sav');
const A = fs.readFileSync(BASE + 'save_t1.sav');

const AULUS_NAME_OFFSET = 0x214A961;

console.log('=== Bytes around "Aulus" UTF-16 in t1adoption (-200 / +200) ===');
function dump(label, buf, off, len) {
  for (let o = off; o < off + len; o += 16) {
    const slice = buf.subarray(o, Math.min(o + 16, off + len));
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    const mark = (o <= AULUS_NAME_OFFSET && AULUS_NAME_OFFSET < o + 16) ? ' <-- Aulus' : '';
    console.log('  ' + label + ' 0x' + o.toString(16) + ': ' + hex.padEnd(48) + '  ' + asc + mark);
  }
}
dump('B', B, AULUS_NAME_OFFSET - 200, 400);

// Now does this same region exist in save_t1 (pre-adoption)?
console.log('\n=== Same region in save_t1 (pre-adoption) ===');
// Account for the +248 byte shift — but we don't know exactly where the
// shift was applied. Just look at the same absolute offset first.
dump('A', A, AULUS_NAME_OFFSET - 200, 400);

// Look for Aulus's persistent UUID — the message_log said the runtime
// pointer was 0x21f9eab92c0 but its low 32 bits (0x9eab92c0) don't appear
// in the save. So the save uses a different ID. Let me scan a window around
// the Aulus name for non-trivial u32 values that ALSO appear in
// save_t1's pre-adoption character pool (Biggus Dickus's UUID).

console.log('\n=== Unique u32 values within 100 bytes BEFORE "Aulus" in t1adoption ===');
const candidates = [];
for (let i = AULUS_NAME_OFFSET - 100; i < AULUS_NAME_OFFSET; i += 4) {
  const v = B.readUInt32LE(i);
  if (v > 0x01000000 && v < 0xff000000) {
    candidates.push({ off: i, val: v });
  }
}
for (const c of candidates) {
  console.log('  +' + (c.off - AULUS_NAME_OFFSET) + ' (0x' + c.off.toString(16) + '): 0x' + c.val.toString(16).padStart(8, '0'));
}

// For each candidate, check how often it appears in save_t1 and save_t1adoption
console.log('\n=== Occurrence counts of each candidate UUID in both saves ===');
function countU32(buf, val) {
  let c = 0;
  for (let i = 0; i + 4 <= buf.length; i++) if (buf.readUInt32LE(i) === val) c++;
  return c;
}
for (const c of candidates) {
  console.log('  0x' + c.val.toString(16).padStart(8, '0') + '  t1: ' + countU32(A, c.val) + '  t1adoption: ' + countU32(B, c.val));
}
