// Focus on the high-signal clusters from the adoption diff:
//   - Cluster #0 (0x0150a454, A=25B B=15B, Δ=-10)
//   - Cluster #86 (0x0150bb6f, A=15B B=3B, Δ=-12)
//   - Cluster #122 (0x0150a3f7, A=0B B=8B, Δ=+8) — NEW BYTES INSERTED
//   - Cluster #121 (0x0000455c, A=4B B=4B) — early file change
//   - Cluster #2496 (0x1509fe7, A=0B B=0B with apparent change) — maybe a real insertion
//
// Also: search the saves for "Aulus" and "Biggus Dickus" UTF-16 / ASCII strings.

const fs = require('fs');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const A = fs.readFileSync(BASE + 'save_t1.sav');
const B = fs.readFileSync(BASE + 'save_t1adoption.sav');

function dump(label, buf, off, len) {
  console.log(label + ' @ 0x' + off.toString(16) + ' (' + len + ' bytes):');
  for (let o = off; o < off + len; o += 16) {
    const slice = buf.subarray(o, Math.min(o + 16, off + len));
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  +' + (o - off).toString(16).padStart(3, '0') + ': ' + hex.padEnd(48) + '  ' + asc);
  }
}

// Dump wide context around the key clusters
console.log('=== Cluster #122 @ A=0x0150a3f7 (B=0x0150a3f7) — 0 bytes in A, 8 NEW bytes in B ===');
dump('A', A, 0x0150a3e0, 64);
dump('B', B, 0x0150a3e0, 64);

console.log('\n=== Cluster #0 @ A=0x0150a454 (lenA=25, lenB=15) ===');
dump('A', A, 0x0150a420, 100);
dump('B', B, 0x0150a420, 100);

console.log('\n=== Cluster #86 @ A=0x0150bb6f (lenA=15, lenB=3) ===');
dump('A', A, 0x0150bb40, 100);
dump('B', B, 0x0150bb40, 100);

console.log('\n=== Cluster #121 @ A=0x0000455c (lenA=4, lenB=4) — early file change ===');
dump('A', A, 0x4540, 64);
dump('B', B, 0x4540, 64);

// Search for ASCII "Aulus" and "Biggus" + UTF-16 forms
function findAscii(buf, str) {
  const needle = Buffer.from(str, 'ascii');
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(needle, p)) !== -1) {
    hits.push(p);
    p++;
  }
  return hits;
}
function findUtf16LE(buf, str) {
  const u16 = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) u16.writeUInt16LE(str.charCodeAt(i), i * 2);
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(u16, p)) !== -1) {
    hits.push(p);
    p++;
  }
  return hits;
}

console.log('\n=== Search for Aulus/Biggus strings in save_t1adoption ===');
console.log('Aulus (ASCII):', findAscii(B, 'Aulus'));
console.log('Aulus (UTF-16):', findUtf16LE(B, 'Aulus'));
console.log('Biggus (ASCII):', findAscii(B, 'Biggus'));
console.log('Biggus (UTF-16):', findUtf16LE(B, 'Biggus'));
console.log('Dickus (ASCII):', findAscii(B, 'Dickus'));

console.log('\n=== Same in save_t1 (pre-adoption) ===');
console.log('Aulus (ASCII):', findAscii(A, 'Aulus'));
console.log('Aulus (UTF-16):', findUtf16LE(A, 'Aulus'));
console.log('Biggus (ASCII):', findAscii(A, 'Biggus'));
console.log('Biggus (UTF-16):', findUtf16LE(A, 'Biggus'));

// Also check for the engine-pointer high bytes (0x21f9 etc) — they may be in save
// as part of a wider 8-byte field.
console.log('\n=== Search for engine-pointer prefix (Aulus = 0x21f0_0000_0000 + 0x9eab92c0) ===');
function findU64LE(buf, low, high) {
  const hits = [];
  for (let i = 0; i + 8 <= buf.length; i++) {
    if (buf.readUInt32LE(i) === low && buf.readUInt32LE(i + 4) === high) {
      hits.push(i);
    }
  }
  return hits;
}
console.log('Aulus full pointer (low=0x9eab92c0 high=0x21f):',
            findU64LE(B, 0x9eab92c0, 0x21f).slice(0, 5));
console.log('Biggus low=0xa4dac540 high=0x?:',
            findU64LE(B, 0xa4dac540, 0x21f).slice(0, 5));
console.log('Aulus alt high=0x021f:', findU64LE(B, 0x9eab92c0, 0x021f).slice(0, 5));
console.log('Aulus alt high=0x0:', findU64LE(B, 0x9eab92c0, 0x0).slice(0, 5));

// Search 0x9eab92c0 in the file as a u32 (already done in dig-adoption-1; 0 hits).
// Try inverting / scaling — maybe the UUID is shifted left by something.
console.log('\n=== Search variants of Aulus UUID 0x9eab92c0 ===');
function findU32(buf, val) {
  const hits = [];
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf.readUInt32LE(i) === val) hits.push(i);
  }
  return hits;
}
// Try the value with different masks/shifts
console.log('0x9eab92c0 (orig):', findU32(B, 0x9eab92c0).length, 'hits');
console.log('0x9eab92c (shifted >>4):', findU32(B, 0x09eab92c).length, 'hits');
console.log('0xab92c000 (rotated):', findU32(B, 0xab92c000).length, 'hits');
console.log('byte-reversed 0xc092ab9e:', findU32(B, 0xc092ab9e).length, 'hits');
// Bigger search: any 8-byte aligned UUID-like value near the new content?
console.log('\n=== Unique u32 values near 0x0150a3f7 in B (50 bytes window) ===');
const seen = new Set();
for (let i = 0x0150a3f0; i < 0x0150a440; i++) {
  const v = B.readUInt32LE(i);
  if (v > 0x10000000 && v < 0xf0000000) seen.add(v);
}
for (const v of seen) console.log('  0x' + v.toString(16));
