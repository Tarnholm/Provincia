// dig-queue-build-small.js
// Dump the small/medium insertions from the construction-queue diff and search
// for nearby building-chain ASCII strings (the queued building id).

'use strict';
const fs = require('fs');
const path = require('path');

const ALEX = path.join(
  'C:', 'Users', 'vtarn', 'AppData', 'Local', 'Feral Interactive',
  'Total War ROME REMASTERED', 'VFS', 'Local', 'Alexander', 'saves'
);
const A = fs.readFileSync(path.join(ALEX, 'save_17-05-2026   Macedon   Turn 1.sav'));
const B = fs.readFileSync(path.join(ALEX, 'save_17-05-2026   Macedon   Turn 1 building queued in Sparta, pella.sav'));

function findInsertions(A, B, maxScan) {
  const out = []; let ap = 0, bp = 0;
  while (ap < A.length && bp < B.length) {
    if (A[ap] === B[bp]) { ap++; bp++; continue; }
    let resync = -1, kind = null;
    for (let s = 1; s <= maxScan; s++) {
      let ok = true; for (let k = 0; k < 24; k++) if (A[ap + k] !== B[bp + s + k]) { ok = false; break; }
      if (ok) { resync = s; kind = 'INS'; break; }
      ok = true; for (let k = 0; k < 24; k++) if (A[ap + s + k] !== B[bp + k]) { ok = false; break; }
      if (ok) { resync = s; kind = 'DEL'; break; }
    }
    if (resync < 0) { out.push({ kind: 'SUB', aOff: ap, bOff: bp, len: 1 }); ap++; bp++; continue; }
    if (kind === 'INS') { out.push({ kind: 'INS', aOff: ap, bOff: bp, len: resync }); bp += resync; }
    else { out.push({ kind: 'DEL', aOff: ap, bOff: bp, len: resync }); ap += resync; }
  }
  return out;
}
const inserts = findInsertions(A, B, 400).filter(e => e.kind === 'INS');

// Focus on insertions in the settlement/queue zone (< 0x1c000 are tile data;
// dump those between 0x10000 and 0x40000 that are queue-entry-sized 30..200).
const cand = inserts.filter(e => e.len >= 24 && e.len <= 200 && e.bOff > 0x10000 && e.bOff < 0x40000);
console.log('candidate insertions: ' + cand.length);

for (const e of cand) {
  console.log('\n========== INSERT len=' + e.len + ' @ B 0x' + e.bOff.toString(16) + ' ==========');
  const start = e.bOff - 32, end = e.bOff + e.len + 16;
  for (let o = start; o < end; o += 16) {
    const slice = B.slice(o, Math.min(o + 16, end));
    const hex = Array.from(slice).map(x => x.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(slice).map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('');
    let m = (o + 16 <= e.bOff) ? 'pre' : (o >= e.bOff + e.len ? 'pst' : 'INS');
    console.log('  ' + m + ' 0x' + o.toString(16) + ': ' + hex.padEnd(48) + ' |' + ascii + '|');
  }
  // u32 view of the inserted bytes
  const u = [];
  for (let o = e.bOff; o + 4 <= e.bOff + e.len; o += 4) u.push((o - e.bOff) + ':' + B.readUInt32LE(o));
  console.log('  u32: ' + u.join('  '));
  // Search ±256 bytes for ascii building-like strings (pstr16 ASCIIZ)
  for (let p = e.bOff - 256; p < e.bOff + e.len + 256; p++) {
    if (p < 0 || p + 2 > B.length) continue;
    const len = B.readUInt16LE(p);
    if (len < 4 || len > 60) continue;
    if (p + 2 + len > B.length) continue;
    let ok = true;
    for (let j = 0; j < len - 1; j++) { const c = B[p + 2 + j]; if (c < 0x20 || c > 0x7e) { ok = false; break; } }
    if (!ok || B[p + 2 + len - 1] !== 0) continue;
    const str = B.slice(p + 2, p + 2 + len - 1).toString('latin1');
    if (/^[a-z][a-z_0-9 ]{3,}$/.test(str)) console.log('    nearby pstr16 @0x' + p.toString(16) + ' (Δ' + (p - e.bOff) + '): "' + str + '"');
  }
}
