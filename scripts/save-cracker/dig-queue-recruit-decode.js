// dig-queue-recruit-decode.js
// Precisely decode the recruit queue entry by comparing BEFORE/AFTER in the
// same alignment window. Show both buffers side-by-side around the insertion.

'use strict';
const fs = require('fs');
const path = require('path');

const ROME = path.join(
  'C:', 'Users', 'vtarn', 'AppData', 'Local', 'Feral Interactive',
  'Total War ROME REMASTERED', 'VFS', 'Local', 'Rome', 'saves'
);

const A = fs.readFileSync(path.join(ROME, 'save_arretium retrained turn 2.sav'));     // before
const B = fs.readFileSync(path.join(ROME, 'save_arretium turn 2 new unit queued.sav')); // after

function hexdump(buf, start, len, label) {
  console.log(label + '  (from 0x' + start.toString(16) + ')');
  for (let o = start; o < start + len; o += 16) {
    const slice = buf.slice(o, Math.min(o + 16, start + len));
    const hex = Array.from(slice).map(x => x.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(slice).map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('');
    console.log('  0x' + o.toString(16).padStart(8, '0') + ': ' + hex.padEnd(48) + ' |' + ascii + '|');
  }
}

// The recruit slot lives in Arretium's settlement record. In BEFORE the slot
// is absent (insertion in AFTER at 0xf86187, 45 bytes). Show 80 bytes before
// the insertion in BOTH and 120 bytes after in AFTER.
console.log('===== BEFORE save: 0xf86130..0xf861d0 =====');
hexdump(A, 0xf86130, 0xa0, 'BEFORE');

console.log('\n===== AFTER save: 0xf86130..0xf86200 =====');
hexdump(B, 0xf86130, 0xd0, 'AFTER');

// Now decode the recruit entry. The structure begins with the chain UUID
// e4 3d 21 89. Find it precisely in AFTER near the insertion.
const uuid = Buffer.from([0xe4, 0x3d, 0x21, 0x89]);
let p = B.indexOf(uuid, 0xf86150);
console.log('\nUUID e4 3d 21 89 first at 0x' + p.toString(16));

// Decode forward from the UUID:
function decodeRecruit(buf, off) {
  let o = off;
  const uuidVal = buf.readUInt32LE(o); o += 4;
  const nameLen = buf.readUInt16LE(o); o += 2;
  const name = buf.slice(o, o + nameLen - 1).toString('latin1'); o += nameLen;
  console.log('\n  uuid       = 0x' + uuidVal.toString(16));
  console.log('  nameLen    = ' + nameLen + ' (incl NUL)');
  console.log('  unit name  = "' + name + '"');
  console.log('  trailing bytes after name (40):');
  const tail = buf.slice(o, o + 40);
  const hex = Array.from(tail).map(x => x.toString(16).padStart(2, '0')).join(' ');
  console.log('    ' + hex);
  // Interpret as u32s
  const u = [];
  for (let k = 0; k + 4 <= 40; k += 4) u.push(k + ':' + buf.readUInt32LE(o + k));
  console.log('    u32: ' + u.join('  '));
  const u16 = [];
  for (let k = 0; k + 2 <= 40; k += 2) u16.push(k + ':' + buf.readUInt16LE(o + k));
  console.log('    u16: ' + u16.join('  '));
  return o;
}
decodeRecruit(B, p);
