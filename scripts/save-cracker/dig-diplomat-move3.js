// More careful pivot finder. The issue: many regions are zeros and match at any shift.
// Use longer match window (256B) and require non-zero content.

const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVE_DIR, 'save_3.2.sav'));
const B = fs.readFileSync(path.join(SAVE_DIR, 'save_4.2.sav'));

function eq(a, ai, b, bi, n) {
  for (let i = 0; i < n; i++) if (a[ai+i] !== b[bi+i]) return false;
  return true;
}

// Walk byte-by-byte. Track current shift. Re-align when mismatch.
// Use 32-byte match minimum.
let ai = 0x1f40000, bi = 0x1f40000;
const insertions = [];
let mismatches = 0;
const MAX_PROBE = 200;

while (ai < A.length && bi < B.length && bi < 0x1f49000 + 200) {
  if (A[ai] === B[bi]) { ai++; bi++; mismatches = 0; continue; }
  mismatches++;
  // Try to re-align by finding A[ai..ai+32] in B[bi..bi+200]
  let found = false;
  for (let d = 1; d < MAX_PROBE; d++) {
    if (bi + d + 32 > B.length) break;
    if (eq(A, ai, B, bi + d, 32)) {
      insertions.push({ ai, bi, len: d, content: B.slice(bi, bi+d).toString('hex'), ascii: B.slice(bi, bi+d).toString('latin1').replace(/[^\x20-\x7e]/g, '.') });
      bi += d;
      found = true;
      break;
    }
  }
  if (!found) {
    // Try removal in A
    for (let d = 1; d < MAX_PROBE; d++) {
      if (ai + d + 32 > A.length) break;
      if (eq(A, ai + d, B, bi, 32)) {
        insertions.push({ ai, bi, len: -d, content: A.slice(ai, ai+d).toString('hex'), removal: true });
        ai += d;
        found = true;
        break;
      }
    }
  }
  if (!found) {
    // try in-place replace
    for (let d = 1; d < 32; d++) {
      if (ai + d + 32 > A.length || bi + d + 32 > B.length) break;
      if (eq(A, ai + d, B, bi + d, 32)) {
        insertions.push({ ai, bi, len: 0, type: 'replace', A_chunk: A.slice(ai, ai+d).toString('hex'), B_chunk: B.slice(bi, bi+d).toString('hex') });
        ai += d; bi += d;
        found = true;
        break;
      }
    }
  }
  if (!found) {
    console.log(`Stuck at A=0x${ai.toString(16)} B=0x${bi.toString(16)}`);
    break;
  }
}

console.log(`Events: ${insertions.length}`);
// Show all non-replace
let totalIns = 0;
for (const e of insertions) {
  if (e.len > 0) {
    totalIns += e.len;
    console.log(`  INS_B at A=0x${e.ai.toString(16)} B=0x${e.bi.toString(16)} len=${e.len}`);
    console.log(`    hex:  ${e.content}`);
    console.log(`    asc:  "${e.ascii}"`);
  } else if (e.len < 0) {
    console.log(`  DEL_A at A=0x${e.ai.toString(16)} B=0x${e.bi.toString(16)} len=${-e.len}`);
    console.log(`    hex:  ${e.content}`);
  } else if (e.type === 'replace') {
    console.log(`  REPL at A=0x${e.ai.toString(16)} B=0x${e.bi.toString(16)}: A=${e.A_chunk} B=${e.B_chunk}`);
  }
}
console.log(`\nTotal inserted: ${totalIns} bytes`);
