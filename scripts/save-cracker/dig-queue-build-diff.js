// dig-queue-build-diff.js
// Clean SAME-TURN before/after diff of the CONSTRUCTION queue.
// Alexander/Macedon: "Turn 1.sav" (base) -> "Turn 1 building queued in Sparta, pella.sav"
// Isolate inserted construction queue bytes; read building id/name, cost, turns.

'use strict';
const fs = require('fs');
const path = require('path');

const ALEX = path.join(
  'C:', 'Users', 'vtarn', 'AppData', 'Local', 'Feral Interactive',
  'Total War ROME REMASTERED', 'VFS', 'Local', 'Alexander', 'saves'
);

const A = fs.readFileSync(path.join(ALEX, 'save_17-05-2026   Macedon   Turn 1.sav'));
const B = fs.readFileSync(path.join(ALEX, 'save_17-05-2026   Macedon   Turn 1 building queued in Sparta, pella.sav'));

console.log('BASE len=' + A.length);
console.log('BLDG len=' + B.length + ' (Δ=' + (B.length - A.length) + ')');

function findInsertions(A, B, maxScan) {
  const out = [];
  let ap = 0, bp = 0;
  while (ap < A.length && bp < B.length) {
    if (A[ap] === B[bp]) { ap++; bp++; continue; }
    let resync = -1, kind = null;
    for (let s = 1; s <= maxScan; s++) {
      let ok = true;
      for (let k = 0; k < 24; k++) { if (A[ap + k] !== B[bp + s + k]) { ok = false; break; } }
      if (ok) { resync = s; kind = 'INS'; break; }
      ok = true;
      for (let k = 0; k < 24; k++) { if (A[ap + s + k] !== B[bp + k]) { ok = false; break; } }
      if (ok) { resync = s; kind = 'DEL'; break; }
    }
    if (resync < 0) { out.push({ kind: 'SUB', aOff: ap, bOff: bp, len: 1 }); ap++; bp++; continue; }
    if (kind === 'INS') { out.push({ kind: 'INS', aOff: ap, bOff: bp, len: resync }); bp += resync; }
    else { out.push({ kind: 'DEL', aOff: ap, bOff: bp, len: resync }); ap += resync; }
  }
  return out;
}

const edits = findInsertions(A, B, 400);
const inserts = edits.filter(e => e.kind === 'INS');
console.log('\nINS=' + inserts.length + ' (total)');
for (const e of inserts) console.log('  INSERT len=' + e.len + ' @ B 0x' + e.bOff.toString(16));

const big = inserts.slice().sort((a, b) => b.len - a.len).slice(0, 5);
for (const e of big) {
  console.log('\n--- INSERT len=' + e.len + ' @ B 0x' + e.bOff.toString(16) + ' (24 pre .. 24 post) ---');
  const start = e.bOff - 24, end = e.bOff + e.len + 24;
  for (let o = start; o < end; o += 16) {
    const slice = B.slice(o, Math.min(o + 16, end));
    const hex = Array.from(slice).map(x => x.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(slice).map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('');
    let m = (o + 16 <= e.bOff) ? 'pre' : (o >= e.bOff + e.len ? 'post' : 'INS');
    console.log('  ' + m + ' 0x' + o.toString(16) + ': ' + hex.padEnd(48) + ' |' + ascii + '|');
  }
  const u = [];
  for (let o = e.bOff; o + 4 <= e.bOff + e.len; o += 4) u.push((o - e.bOff) + ':' + B.readUInt32LE(o));
  console.log('  u32: ' + u.join('  '));
}
