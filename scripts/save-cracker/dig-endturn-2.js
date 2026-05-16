// Examine top clusters from the T0→T1 diff. Top is #0 at 0x6f2a3..0x70395
// (B has 718 more bytes here, A has 474 changed). Test: is this a new
// character record being added on End Turn?

const fs = require('fs');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const A = fs.readFileSync(BASE + 'save_t0justbeforeturnend.sav');
const B = fs.readFileSync(BASE + 'save_t1.sav');

const clusters = [
  { aStart: 0x0006f2a3, aEnd: 0x00070395, label: 'top cluster #0' },
  { aStart: 0x00073edf, aEnd: 0x0007488c, label: 'cluster #1' },
  { aStart: 0x000698c5, aEnd: 0x00069c5d, label: 'cluster #2' },
  { aStart: 0x0006d7f3, aEnd: 0x0006dea0, label: 'cluster #6' },
];

function dump(label, buf, off, len) {
  for (let o = off; o < off + len; o += 16) {
    const slice = buf.subarray(o, Math.min(o + 16, off + len));
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  ' + label + ' 0x' + o.toString(16) + ': ' + hex.padEnd(48) + '  ' + asc);
  }
}

for (const c of clusters) {
  console.log('\n=== ' + c.label + ' at 0x' + c.aStart.toString(16) + ' ===');
  console.log('A region (200 bytes):');
  dump('A', A, c.aStart - 16, 200);
  console.log('\nB region (300 bytes — B has more here):');
  dump('B', B, c.aStart - 16, 300);

  // Look for length-prefixed ASCII strings in this cluster region
  console.log('\nASCII strings in this cluster (B side):');
  for (let p = c.aStart; p < c.aEnd + 200; p++) {
    if (p + 2 > B.length) break;
    const lenP1 = B.readUInt16LE(p);
    if (lenP1 < 4 || lenP1 > 60) continue;
    if (p + 2 + lenP1 > B.length) continue;
    let ok = true;
    for (let j = 0; j < lenP1 - 1; j++) {
      const c2 = B[p + 2 + j];
      if (c2 < 0x20 || c2 > 0x7e) { ok = false; break; }
    }
    if (!ok || B[p + 2 + lenP1 - 1] !== 0) continue;
    const s = B.slice(p + 2, p + 2 + lenP1 - 1).toString('latin1');
    if (/^[A-Za-z][A-Za-z0-9 _.()/-]*$/.test(s)) {
      console.log('  +0x' + (p - c.aStart).toString(16) + ' "' + s + '"');
    }
  }
}

// Also check if YEAR or TURN counter values changed
console.log('\n=== Year / Turn counter ===');
console.log('A turn (u32@0x44e3) =', A.readUInt32LE(0x44e3), '+1 →', A.readUInt32LE(0x44e3) + 1);
console.log('B turn (u32@0x44e3) =', B.readUInt32LE(0x44e3), '+1 →', B.readUInt32LE(0x44e3) + 1);
console.log('A year (i32@0x44e7) =', A.readInt32LE(0x44e7));
console.log('B year (i32@0x44e7) =', B.readInt32LE(0x44e7));
