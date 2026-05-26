// dig-queue-armor-diff.js
// Controlled before/after diff of the ARMOR UPGRADE construction queue.
// "save_before armor upgrade queue.sav" -> "save_after amour upgrade queue.sav"
// Goal: isolate the inserted queue bytes and read building id / cost / turns.

'use strict';
const fs = require('fs');
const path = require('path');

const ROME = path.join(
  'C:', 'Users', 'vtarn', 'AppData', 'Local', 'Feral Interactive',
  'Total War ROME REMASTERED', 'VFS', 'Local', 'Rome', 'saves'
);

const A = fs.readFileSync(path.join(ROME, 'save_before armor upgrade queue.sav')); // before
const B = fs.readFileSync(path.join(ROME, 'save_after amour upgrade queue.sav'));  // after

console.log('BEFORE len=' + A.length);
console.log('AFTER  len=' + B.length + '  (Δ=' + (B.length - A.length) + ')');

// LCS-ish insertion walk over the whole file: find regions where B has
// inserted bytes relative to A.
function findInsertions(A, B, maxScan) {
  const out = [];
  let ap = 0, bp = 0;
  const N = Math.min(A.length, B.length);
  while (ap < A.length && bp < B.length) {
    if (A[ap] === B[bp]) { ap++; bp++; continue; }
    // mismatch: try to find a re-sync. Test pure insertion in B first.
    let resync = -1, kind = null;
    for (let s = 1; s <= maxScan; s++) {
      // insertion in B of length s
      let ok = true;
      for (let k = 0; k < 24; k++) { if (A[ap + k] !== B[bp + s + k]) { ok = false; break; } }
      if (ok) { resync = s; kind = 'INS'; break; }
      // deletion from A of length s (insertion-from-A perspective)
      ok = true;
      for (let k = 0; k < 24; k++) { if (A[ap + s + k] !== B[bp + k]) { ok = false; break; } }
      if (ok) { resync = s; kind = 'DEL'; break; }
    }
    if (resync < 0) {
      // single-byte substitution
      out.push({ kind: 'SUB', aOff: ap, bOff: bp, len: 1, aByte: A[ap], bByte: B[bp] });
      ap++; bp++;
      continue;
    }
    if (kind === 'INS') {
      out.push({ kind: 'INS', aOff: ap, bOff: bp, len: resync });
      bp += resync;
    } else {
      out.push({ kind: 'DEL', aOff: ap, bOff: bp, len: resync });
      ap += resync;
    }
  }
  return out;
}

const edits = findInsertions(A, B, 400);
const inserts = edits.filter(e => e.kind === 'INS');
const dels = edits.filter(e => e.kind === 'DEL');
const subs = edits.filter(e => e.kind === 'SUB');
console.log('\nedits: INS=' + inserts.length + ' DEL=' + dels.length + ' SUB=' + subs.length);

console.log('\n=== INSERTIONS (B has new bytes) ===');
for (const e of inserts) {
  console.log('  bOff=0x' + e.bOff.toString(16) + '  aOff=0x' + e.aOff.toString(16) + '  len=' + e.len);
}

// Dump the largest few insertions as hex+ascii, with 16 bytes of context before.
const big = inserts.slice().sort((a, b) => b.len - a.len).slice(0, 6);
for (const e of big) {
  console.log('\n--- INSERT len=' + e.len + ' @ B 0x' + e.bOff.toString(16) + ' (ctx 16 before) ---');
  const start = e.bOff - 16;
  for (let j = 0; j < e.len + 16; j += 16) {
    const o = start + j;
    const slice = B.slice(o, Math.min(o + 16, e.bOff + e.len));
    const hex = Array.from(slice).map(x => x.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(slice).map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('');
    const marker = (o < e.bOff) ? 'ctx' : 'INS';
    console.log('  ' + marker + ' 0x' + o.toString(16).padStart(8, '0') + ': ' + hex.padEnd(48) + ' |' + ascii + '|');
  }
}
