// Pure resave noise diff: save_t0 vs save_t0justbeforeturnend.
// Same size (34,531,348 bytes), no player action between them.
// Goal: identify the byte ranges that change just from re-saving (the
// noise floor that every future diff must filter out).

const fs = require('fs');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const A = fs.readFileSync(BASE + 'save_t0.sav');
const B = fs.readFileSync(BASE + 'save_t0justbeforeturnend.sav');

console.log('A:', A.length, 'B:', B.length, 'Δ:', B.length - A.length);
if (A.length !== B.length) {
  console.log('UNEXPECTED size mismatch');
}

// Simple in-place diff (same length so no resync needed)
const diffPositions = [];
for (let i = 0; i < A.length; i++) {
  if (A[i] !== B[i]) diffPositions.push(i);
}
console.log('Differing byte count:', diffPositions.length);

// Cluster the differences (gap ≤ 16)
const clusters = [];
let cur = null;
for (const p of diffPositions) {
  if (!cur || p - cur.end > 16) {
    if (cur) clusters.push(cur);
    cur = { start: p, end: p + 1, bytes: 1 };
  } else {
    cur.end = p + 1;
    cur.bytes++;
  }
}
if (cur) clusters.push(cur);

console.log('Clusters (gap≤16):', clusters.length);
console.log('\nAll resave-noise clusters:');
for (const c of clusters) {
  console.log('  0x' + c.start.toString(16).padStart(8, '0') +
              '..0x' + c.end.toString(16).padStart(8, '0') +
              '  (' + (c.end - c.start) + ' bytes, ' + c.bytes + ' differing)');
  // Dump A and B side-by-side
  const aBytes = Array.from(A.subarray(c.start, c.end)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const bBytes = Array.from(B.subarray(c.start, c.end)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  console.log('    A: ' + aBytes);
  console.log('    B: ' + bBytes);
  // Try reading as u32
  if (c.end - c.start <= 8) {
    for (let o = c.start; o + 4 <= c.end; o++) {
      const va = A.readUInt32LE(o);
      const vb = B.readUInt32LE(o);
      console.log('    u32@0x' + o.toString(16) + ': A=' + va + '  B=' + vb + '  Δ=' + (vb - va));
    }
  }
}
