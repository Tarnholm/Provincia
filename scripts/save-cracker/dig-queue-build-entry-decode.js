// dig-queue-build-entry-decode.js
// Decode the construction queue entry precisely. The 53-byte insertion at
// B 0x10e37 lives just before the "core_building" chain record. Compare BASE
// vs queued in that exact region to see what the engine inserted, and map the
// 4-byte hash + turns + cost fields.

'use strict';
const fs = require('fs');
const path = require('path');

const ALEX = path.join(
  'C:', 'Users', 'vtarn', 'AppData', 'Local', 'Feral Interactive',
  'Total War ROME REMASTERED', 'VFS', 'Local', 'Alexander', 'saves'
);
const A = fs.readFileSync(path.join(ALEX, 'save_17-05-2026   Macedon   Turn 1.sav'));
const B = fs.readFileSync(path.join(ALEX, 'save_17-05-2026   Macedon   Turn 1 building queued in Sparta, pella.sav'));

function hexdump(buf, start, len, label) {
  console.log(label);
  for (let o = start; o < start + len; o += 16) {
    const slice = buf.slice(o, Math.min(o + 16, start + len));
    const hex = Array.from(slice).map(x => x.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(slice).map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('');
    console.log('  0x' + o.toString(16) + ': ' + hex.padEnd(48) + ' |' + ascii + '|');
  }
}

// Region around the 0x10e37 insertion. In BASE the same chain list exists but
// without the queue entry. Align by the "core_building" string which is stable.
const cbBufB = Buffer.from('\x0e\x00core_building\x00', 'latin1'); // len16(0x0e)+name+nul
function findCore(buf, from) {
  // core_building chain record: u16 len=0x0e then "core_building\0"
  let i = from;
  while (true) {
    i = buf.indexOf(Buffer.from('core_building\0', 'latin1'), i);
    if (i < 0) return -1;
    if (buf.readUInt16LE(i - 2) === 0x0e) return i - 2; // start of record (len field)
    i++;
  }
}

// Find the FIRST core_building near the insertion zone in both.
const coreB = findCore(B, 0x10000);
const coreA = findCore(A, 0x10000);
console.log('core_building record: BASE@0x' + coreA.toString(16) + '  QUEUE@0x' + coreB.toString(16));

// Dump 120 bytes BEFORE core_building in both (this is where the queue entry sits).
console.log('\n===== BASE: 120 B before core_building =====');
hexdump(A, coreA - 120, 120 + 16, 'BASE');
console.log('\n===== QUEUE: 120 B before core_building =====');
hexdump(B, coreB - 120, 120 + 16, 'QUEUE');

// Byte diff in [-120, +60] aligned on core_building.
console.log('\n===== Aligned diffs (relative to core_building start) =====');
for (let d = -160; d < 80; d++) {
  const a = A[coreA + d], b = B[coreB + d];
  if (a !== b) console.log('  Δ' + d + ': BASE=' + a + ' (0x' + a.toString(16) + ')  QUEUE=' + b + ' (0x' + b.toString(16) + ')');
}

// Print the core_building record's own 4-byte hash (record+2+name.len+1).
const nameLen = 13; // "core_building"
const hashOffB = coreB + 2 + nameLen + 1;
const hashB = B.slice(hashOffB, hashOffB + 4);
console.log('\ncore_building chain hash (QUEUE) = ' + Array.from(hashB).map(x => x.toString(16).padStart(2, '0')).join(' '));
const hashHex = hashB.toString('hex');
// Find that hash in the 200 bytes before core_building (the queue ref).
for (let p = coreB - 200; p < coreB; p++) {
  if (B.slice(p, p + 4).toString('hex') === hashHex) {
    console.log('  hash also appears at 0x' + p.toString(16) + ' (Δ' + (p - coreB) + ' from core_building) -> QUEUE REF');
    // decode the queue entry from there
    console.log('  queue entry u32 dump from hash position:');
    for (let k = 0; k <= 40; k += 4) {
      console.log('    +' + k + ': ' + B.readUInt32LE(p + k) + ' (0x' + B.readUInt32LE(p + k).toString(16) + ')');
    }
  }
}
