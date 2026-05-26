// dig-queue-recruit-fields.js
// Map every field of the recruit queue entry against known EDU values.
// Unit: "aor etruscan spearmen", stat_cost = 2(turns),1303(cost),477(upkeep)...

'use strict';
const fs = require('fs');
const path = require('path');

const ROME = path.join(
  'C:', 'Users', 'vtarn', 'AppData', 'Local', 'Feral Interactive',
  'Total War ROME REMASTERED', 'VFS', 'Local', 'Rome', 'saves'
);

const A = fs.readFileSync(path.join(ROME, 'save_arretium retrained turn 2.sav'));     // before
const B = fs.readFileSync(path.join(ROME, 'save_arretium turn 2 new unit queued.sav')); // after

// AFTER: default_set chain header at 0xf86151 (after the leading 00).
// Header byte layout (matching queueParser bodyStart = defaultSetOff+12):
//  default_set\0 begins at 0xf86141 (len 12) -> bodyStart = 0xf8614d
const DS = B.indexOf(Buffer.from('default_set\0', 'latin1'), 0xf86100);
const bodyStart = DS + 12;
console.log('default_set @ 0x' + DS.toString(16) + '  bodyStart=0x' + bodyStart.toString(16));

function u32(buf, o) { return buf.readUInt32LE(o); }
function u16(buf, o) { return buf.readUInt16LE(o); }

console.log('\n=== AFTER header u32 from bodyStart ===');
for (let k = 0; k < 64; k += 4) {
  console.log('  +' + k.toString().padStart(2) + ': ' + u32(B, bodyStart + k) + '  (0x' + u32(B, bodyStart + k).toString(16) + ')');
}

// Locate recruit entry: UUID e4 3d 21 89 that is NOT the header's (header's
// uuid is at bodyStart+4). The recruit entry UUID is the second occurrence.
const uuid = u32(B, bodyStart + 4);
console.log('\nchain uuid = 0x' + uuid.toString(16));

// Find recruit entry start: scan for nameLen-prefixed "aor etruscan spearmen"
const nameBuf = Buffer.from('aor etruscan spearmen\0', 'latin1');
const nameOff = B.indexOf(nameBuf, bodyStart);
console.log('unit name string @ 0x' + nameOff.toString(16));
// entry = uuid(4) + nameLen(2) + name; so entry starts 6 bytes before name string
const entryOff = nameOff - 6;
console.log('recruit entry start @ 0x' + entryOff.toString(16) + '  (Δ from bodyStart = ' + (entryOff - bodyStart) + ')');

console.log('\n=== Recruit entry decode ===');
let o = entryOff;
console.log('+0  uuid     = 0x' + u32(B, o).toString(16)); o += 4;
const nl = u16(B, o); console.log('+4  nameLen  = ' + nl); o += 2;
const nm = B.slice(o, o + nl - 1).toString('latin1'); console.log('+6  name     = "' + nm + '"'); o += nl;
const tailStart = o;
console.log('--- trailer starts at entry+' + (tailStart - entryOff) + ' (0x' + tailStart.toString(16) + ') ---');
const tail = B.slice(tailStart, tailStart + 24);
console.log('trailer hex: ' + Array.from(tail).map(x => x.toString(16).padStart(2, '0')).join(' '));
for (let k = 0; k + 4 <= 24; k += 4) {
  const v = u32(B, tailStart + k);
  console.log('  trailer+' + k + ': u32=' + v + ' (0x' + v.toString(16) + ')  u16lo=' + u16(B, tailStart + k) + ' u16hi=' + u16(B, tailStart + k + 2));
}

console.log('\nEDU stat_cost = 2(turns), 1303(cost), 477(upkeep), 1, 72, 495');
console.log('Look for 2, 1303(0x517), 477(0x1dd), or 1317(0x525) in the bytes above.');

// Also dump BEFORE header for the same field positions to see what header
// fields changed when the recruit was added.
const DSa = A.indexOf(Buffer.from('default_set\0', 'latin1'), 0xf86100);
const bodyStartA = DSa + 12;
console.log('\n=== BEFORE header u32 from bodyStart (0x' + bodyStartA.toString(16) + ') ===');
for (let k = 0; k < 64; k += 4) {
  const va = u32(A, bodyStartA + k), vb = u32(B, bodyStart + k);
  const flag = (va !== vb) ? '  <-- CHANGED (after=' + vb + ')' : '';
  console.log('  +' + k.toString().padStart(2) + ': ' + va + flag);
}
