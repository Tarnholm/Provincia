// Detailed walk of the divergence region. Show much more context.

const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVE_DIR, 'save_2.2.sav'));
const B = fs.readFileSync(path.join(SAVE_DIR, 'save_3.2.sav'));

function hexLines(buf, start, end) {
  let out = [];
  for (let p = start; p < end; p += 16) {
    const slice = buf.slice(p, Math.min(end, p+16));
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2,'0')).join(' ');
    const ascii = Array.from(slice).map(b => (b>=0x20 && b<0x7f) ? String.fromCharCode(b) : '.').join('');
    out.push(`  0x${p.toString(16).padStart(8,'0')}: ${hex.padEnd(48)} | ${ascii}`);
  }
  return out.join('\n');
}

console.log('=== save_2.2 (wall queued) bytes 0xf8465e..0xf846de ===');
console.log(hexLines(A, 0xf8465e, 0xf846de));

console.log('\n=== save_3.2 (levies queued) bytes 0xf8465e..0xf846de ===');
console.log(hexLines(B, 0xf8465e, 0xf846de));

// Re-align at the post-divergence common run
// Find where A and B match again with -18 shift
let p;
for (p = 0xf8465e; p < 0xf84800; p++) {
  // try B at p-18 = p+(-18)
  if (A[p] === B[p - 18]) {
    let m = 0;
    for (let k = 0; k < 32; k++) if (A[p+k] === B[p+k-18]) m++;
    if (m >= 30) {
      console.log(`\nRe-aligned at A=0x${p.toString(16)} -> B=0x${(p-18).toString(16)} (match=${m}/32)`);
      break;
    }
  }
}

// So in save_2.2 the recruitment record extends from divergence (0xf8465e)
// to p, which is the start of the next common region. Let's also find
// the recruitment record in save_3.2 — it starts at the same A_offset but
// extends to (p - 18).

if (p < 0xf84800) {
  console.log('\n=== save_2.2 "wall" record (A side) ===');
  console.log(`  range 0xf8465e .. 0x${p.toString(16)} = ${p - 0xf8465e} bytes`);
  console.log(hexLines(A, 0xf8465e, p));

  console.log('\n=== save_3.2 "levies" record (B side) ===');
  console.log(`  range 0xf8465e .. 0x${(p-18).toString(16)} = ${(p-18) - 0xf8465e} bytes`);
  console.log(hexLines(B, 0xf8465e, p - 18));
}
