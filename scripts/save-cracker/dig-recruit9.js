// The −18 byte offset accumulates BEFORE Roma's first hit at 0x1514174.
// Walk both files from the start and find where they desync by an 18-byte delta.

const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVE_DIR, 'save_2.2.sav'));
const B = fs.readFileSync(path.join(SAVE_DIR, 'save_3.2.sav'));

// We know common prefix is 0x3c2a, common suffix 0x9. The −18 delta is
// somewhere in [0x3c2a..0x1514174].
// Strategy: walk forward, and at sparse points (every 4 KB) test whether
//   A[off] == B[off]            (no shift)
//   A[off] == B[off-18]         (negative shift, i.e. B is shorter by 18)
// to find the transition.

const SAMPLE = 4096;
const W = 64;

function eq(a, ai, b, bi, n) {
  for (let i = 0; i < n; i++) if (a[ai+i] !== b[bi+i]) return false;
  return true;
}

// Test 0-shift / -18-shift / +1..-32 shifts at each sample point
const states = [];
for (let off = 0x4000; off < 0x1514174; off += SAMPLE) {
  let bestShift = null, bestMatch = 0;
  for (let s = -32; s <= 32; s++) {
    const bi = off + s;
    if (bi < 0 || bi + W >= B.length) continue;
    let m = 0;
    for (let k = 0; k < W; k++) if (A[off+k] === B[bi+k]) m++;
    if (m > bestMatch) { bestMatch = m; bestShift = s; }
  }
  states.push({ off, shift: bestShift, match: bestMatch });
}

// Print where the shift changes
let prev = states[0].shift;
console.log(`Initial shift at off=0x${states[0].off.toString(16)}: ${prev}`);
for (let i = 1; i < states.length; i++) {
  if (states[i].shift !== prev) {
    console.log(`  Δ at off=0x${states[i].off.toString(16)}: ${prev} -> ${states[i].shift} (match=${states[i].match}/64)`);
    prev = states[i].shift;
  }
}
console.log(`Final shift at end: ${prev}`);
