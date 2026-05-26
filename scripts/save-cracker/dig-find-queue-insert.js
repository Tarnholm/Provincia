// Find where the 66-byte construction queue item was inserted in Pella's record.

const fs = require('fs');
const path = require('path');

const BASE_A = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const base = fs.readFileSync(path.join(BASE_A, 'save_17-05-2026   Macedon   Turn 1.sav'));
const queue = fs.readFileSync(path.join(BASE_A, 'save_17-05-2026   Macedon   Turn 1 building queued in Sparta, pella.sav'));

function findUtf16(buf, str) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(str.length, 0);
  const strBytes = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) strBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  return buf.indexOf(Buffer.concat([lenBuf, strBytes]));
}

function findPstr16(buf, str, fromOff) {
  const lenP1 = str.length + 1;
  const target = Buffer.concat([
    Buffer.from([lenP1 & 0xff, (lenP1 >> 8) & 0xff]),
    Buffer.from(str, 'latin1'),
    Buffer.from([0])
  ]);
  return buf.indexOf(target, fromOff || 0);
}

const pella1 = findUtf16(base, 'Pella');
const pella2 = findUtf16(queue, 'Pella');

// Find first core_building AFTER each Pella's name
const core1 = findPstr16(base, 'core_building', pella1);
const core2 = findPstr16(queue, 'core_building', pella2);

console.log('Pella base @ 0x' + pella1.toString(16));
console.log('Pella queue @ 0x' + pella2.toString(16));
console.log('core_building base @ 0x' + core1.toString(16) + ' (Pella+' + (core1 - pella1) + ')');
console.log('core_building queue @ 0x' + core2.toString(16) + ' (Pella+' + (core2 - pella2) + ')');
console.log('core_building shifted by ' + (core2 - core1) + ' bytes');

// The insertion is BEFORE core_building. Bytes between (Pella_name+22) and core_building
// contain the inserted queue item.
const insertStart1 = pella1 + 22;  // after Pella UTF-16 name
const insertEnd1 = core1;
const insertStart2 = pella2 + 22;
const insertEnd2 = core2;

console.log('\n=== Bytes from Pella+22 to core_building in BASE (' + (insertEnd1 - insertStart1) + ' bytes) ===');
for (let i = 0; i < insertEnd1 - insertStart1; i += 16) {
  const hex = Array.from(base.slice(insertStart1 + i, insertStart1 + i + 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const ascii = Array.from(base.slice(insertStart1 + i, insertStart1 + i + 16)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  console.log('  +' + i.toString().padStart(3) + ': ' + hex + '  |' + ascii + '|');
}

console.log('\n=== Bytes from Pella+22 to core_building in QUEUE (' + (insertEnd2 - insertStart2) + ' bytes) ===');
for (let i = 0; i < insertEnd2 - insertStart2; i += 16) {
  const hex = Array.from(queue.slice(insertStart2 + i, insertStart2 + i + 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const ascii = Array.from(queue.slice(insertStart2 + i, insertStart2 + i + 16)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  console.log('  +' + i.toString().padStart(3) + ': ' + hex + '  |' + ascii + '|');
}
