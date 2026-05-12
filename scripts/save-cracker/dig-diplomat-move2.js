// Pin the exact +89 byte insertion location and content.

const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVE_DIR, 'save_3.2.sav'));
const B = fs.readFileSync(path.join(SAVE_DIR, 'save_4.2.sav'));

// Sample-track shows shift transitioning to +89 around 0x1f48600.
// So the insertion is just before that — likely in [0x1f47000..0x1f48600]
// Find exact pivot.

// Sweep precisely: at each offset, check whether A matches B with shift=0 vs shift=+89.
function eq(a, ai, b, bi, n) {
  for (let i = 0; i < n; i++) if (a[ai+i] !== b[bi+i]) return false;
  return true;
}

// Find the transition: largest off where A[off..+64] == B[off..+64] (shift 0)
//                     smallest off where A[off..+64] == B[off+89..+64] (shift 89)

let lastZero = -1;
for (let off = 0x1f40000; off < 0x1f49000; off++) {
  if (eq(A, off, B, off, 64)) lastZero = off;
}
console.log(`Last off where shift=0 still holds: 0x${lastZero.toString(16)}`);

let first89 = -1;
for (let off = 0x1f40000; off < 0x1f4a000; off++) {
  if (eq(A, off, B, off + 89, 64)) { first89 = off; break; }
}
console.log(`First off where shift=89 holds: 0x${first89.toString(16)}`);

// So the insertion is in [lastZero+64..first89] of A — i.e. bytes between the
// last 64-byte clean match and the first 64-byte +89 match.
// In B, the inserted region is [lastZero+64..first89+89].

const aStart = lastZero;
const aEnd = first89 + 64;
const bStart = lastZero;
const bEnd = first89 + 89 + 64;

console.log(`\nA window: 0x${aStart.toString(16)} .. 0x${aEnd.toString(16)} (${aEnd-aStart} B)`);
console.log(`B window: 0x${bStart.toString(16)} .. 0x${bEnd.toString(16)} (${bEnd-bStart} B)`);

// Dump both windows
function dump(buf, start, end) {
  const lines = [];
  for (let p = start; p < end; p += 16) {
    const slice = buf.slice(p, Math.min(end, p+16));
    const hex = Array.from(slice).map(x => x.toString(16).padStart(2,'0')).join(' ');
    const asc = Array.from(slice).map(x => (x>=0x20 && x<0x7f) ? String.fromCharCode(x) : '.').join('');
    lines.push(`    0x${p.toString(16).padStart(8,'0')}: ${hex.padEnd(48)} | ${asc}`);
  }
  return lines.join('\n');
}

console.log('\n--- save_3.2 (before diplomat move) ---');
console.log(dump(A, aStart, aEnd));
console.log('\n--- save_4.2 (after diplomat move) ---');
console.log(dump(B, bStart, bEnd));
