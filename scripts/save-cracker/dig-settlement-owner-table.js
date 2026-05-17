// The pointer XX 43 01 00 before each settlement name points into a table
// around 0x143XX. This table might contain settlement-to-owner mapping.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

function hex(buf, off, len) {
  return Array.from(buf.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

function readPstr16Utf16(buf, off) {
  const len = buf.readUInt16LE(off);
  if (len < 1 || len > 50) return null;
  if (off + 2 + len * 2 > buf.length) return null;
  const chars = [];
  for (let i = 0; i < len; i++) {
    const c = buf.readUInt16LE(off + 2 + i * 2);
    if (c < 0x20 || c > 0x7e) return null;
    chars.push(String.fromCharCode(c));
  }
  return { str: chars.join(''), totalLen: 2 + len * 2 };
}

function findPstr16Asciiz(buf, str) {
  const len = str.length + 1;
  const prefix = Buffer.alloc(2);
  prefix.writeUInt16LE(len, 0);
  const target = Buffer.concat([prefix, Buffer.from(str + '\0')]);
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(target, p)) !== -1) {
    hits.push(p);
    p++;
  }
  return hits;
}

// Collect settlements (name pstr16 -> pointer before)
const defSets = findPstr16Asciiz(peace, 'default_set');
const settlements = [];
for (const ds of defSets) {
  let nameOff = -1;
  for (let step = -20; step <= 0; step++) {
    const candidate = ds - 18 + step;
    if (candidate < 0) continue;
    const r = readPstr16Utf16(peace, candidate);
    if (r && r.totalLen === ds - candidate - 18) {
      nameOff = candidate;
      break;
    }
  }
  if (nameOff === -1) continue;
  const nameRec = readPstr16Utf16(peace, nameOff);
  // ptr at nameOff - 29 (4 bytes)
  const ptr1 = peace.readUInt32LE(nameOff - 29);
  // ptr at nameOff - 16 (4 bytes, self-pointer)
  const selfPtr1 = peace.readUInt32LE(nameOff - 15);
  const selfPtr2 = peace.readUInt32LE(nameOff - 11);
  settlements.push({ name: nameRec.str, nameOff, ptr: ptr1, selfPtr1, selfPtr2 });
}

console.log('Settlements with their back-pointers:');
for (const s of settlements.slice(0, 15)) {
  console.log('  0x' + s.nameOff.toString(16).padStart(6, '0') + '  ' + s.name.padEnd(20) +
    '  ptr=0x' + s.ptr.toString(16) + '  selfPtr1=0x' + s.selfPtr1.toString(16) + '  selfPtr2=0x' + s.selfPtr2.toString(16));
}

// Check what's at the ptr address (should all be in 0x14300 region)
console.log('\nMin ptr: 0x' + Math.min(...settlements.map(s => s.ptr)).toString(16));
console.log('Max ptr: 0x' + Math.max(...settlements.map(s => s.ptr)).toString(16));

// Print 16 bytes at each unique pointer
const uniquePtrs = [...new Set(settlements.map(s => s.ptr))].sort((a, b) => a - b);
console.log('\n=== Unique ptr count: ' + uniquePtrs.length + ' ===');
console.log('First 12 ptrs and their target bytes:');
for (const p of uniquePtrs.slice(0, 12)) {
  if (p < peace.length - 32) {
    console.log('  0x' + p.toString(16) + ': ' + hex(peace, p, 32));
  }
}

// Maybe these pointers are to records in a different section. Let me check
// the 0x14000-0x18000 region for what kind of structure lives there.
console.log('\n=== Bytes 0x14000-0x14100 ===');
for (let p = 0x14000; p < 0x14100; p += 16) {
  console.log('  0x' + p.toString(16) + ': ' + hex(peace, p, 16));
}
