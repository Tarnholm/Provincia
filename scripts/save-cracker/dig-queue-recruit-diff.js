// dig-queue-recruit-diff.js
// Controlled SAME-TURN before/after diff of the RECRUITMENT queue.
// "save_arretium retrained turn 2.sav" (no new unit) ->
// "save_arretium turn 2 new unit queued.sav" (one new unit queued).
// Goal: isolate the inserted recruit queue bytes; read unit id/name, count, turns, cost.

'use strict';
const fs = require('fs');
const path = require('path');

const ROME = path.join(
  'C:', 'Users', 'vtarn', 'AppData', 'Local', 'Feral Interactive',
  'Total War ROME REMASTERED', 'VFS', 'Local', 'Rome', 'saves'
);

const A = fs.readFileSync(path.join(ROME, 'save_arretium retrained turn 2.sav'));     // before queue
const B = fs.readFileSync(path.join(ROME, 'save_arretium turn 2 new unit queued.sav')); // after queue

console.log('BEFORE (no queue) len=' + A.length);
console.log('AFTER  (queued)   len=' + B.length + '  (Δ=' + (B.length - A.length) + ')');

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
const dels = edits.filter(e => e.kind === 'DEL');
console.log('\nINS=' + inserts.length + ' DEL=' + dels.length + '\n');

for (const e of inserts) {
  console.log('INSERT len=' + e.len + ' @ B 0x' + e.bOff.toString(16) + ' (aOff 0x' + e.aOff.toString(16) + ')');
}

const big = inserts.slice().sort((a, b) => b.len - a.len).slice(0, 6);
for (const e of big) {
  console.log('\n--- INSERT len=' + e.len + ' @ B 0x' + e.bOff.toString(16) + ' (ctx 24 before .. 24 after) ---');
  const start = e.bOff - 24;
  const end = e.bOff + e.len + 24;
  for (let o = start; o < end; o += 16) {
    const slice = B.slice(o, Math.min(o + 16, end));
    const hex = Array.from(slice).map(x => x.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(slice).map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('');
    let marker = 'INS';
    if (o + 16 <= e.bOff) marker = 'pre';
    else if (o >= e.bOff + e.len) marker = 'post';
    console.log('  ' + marker + ' 0x' + o.toString(16).padStart(8, '0') + ': ' + hex.padEnd(48) + ' |' + ascii + '|');
  }
  // Interpret the insertion bytes as u32 array
  const arr = [];
  for (let o = e.bOff; o + 4 <= e.bOff + e.len; o += 4) arr.push((o - e.bOff) + ':' + B.readUInt32LE(o));
  console.log('  u32: ' + arr.join('  '));
}
