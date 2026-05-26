// Decode the section-index/header structure at ~0xa6a8 in Spain T1.
// It looks like a sequence of (u32, u32) pairs with type IDs in low range.
// Goal: identify what this structure indexes, and find FACTION_ECONOMICS records.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T1 = fs.readFileSync(path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav'));
const T2 = fs.readFileSync(path.join(BASE_R, 'save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav'));

function readRegistry(buf) {
  let p = 0x500;
  while (p < 0xf00) {
    const count = buf.readUInt32LE(p);
    if (count > 0 && count < 100000) {
      const nameStart = p + 4;
      if (buf[nameStart] >= 0x41 && buf[nameStart] <= 0x5a) {
        const end = buf.indexOf(0x00, nameStart);
        if (end !== -1 && /^[A-Z][A-Z_0-9]*$/.test(buf.slice(nameStart, end).toString('latin1'))) break;
      }
    }
    p++;
  }
  const types = [];
  while (p < buf.length - 5) {
    const count = buf.readUInt32LE(p);
    if (count > 100000) break;
    const nameStart = p + 4;
    const end = buf.indexOf(0x00, nameStart);
    if (end === -1 || end > nameStart + 60) break;
    const name = buf.slice(nameStart, end).toString('latin1');
    if (!/^[A-Z][A-Z_0-9]*$/.test(name)) break;
    types.push({ id: types.length, name, count });
    p = end + 1;
  }
  return types;
}

const types = readRegistry(T1);

// Dump 0xa6a8..0xa760 with both u32 columns and their type-name interpretation
console.log('=== Decoded section index 0xa6a8..0xa760 (Spain T1) ===');
for (let p = 0xa6a8; p < 0xa760; p += 8) {
  const a = T1.readUInt32LE(p);
  const b = T1.readUInt32LE(p + 4);
  const aName = (a < types.length) ? types[a].name : '?';
  const bName = (b < types.length) ? types[b].name : '?';
  console.log('  0x' + p.toString(16) + ': (' + a.toString().padStart(3) + ',' + b.toString().padStart(3) + ')  ' + aName.padEnd(30) + ' <-> ' + bName);
}

// Check if same pattern exists in T2 at slightly different offset
console.log('\n=== Same area in T2 (look for shifted pattern) ===');
// Find pattern (48, 36) in T2 — that was the first entry in T1
for (let p = 0xa000; p < 0xb000; p += 4) {
  if (T2.readUInt32LE(p) === 48 && T2.readUInt32LE(p + 4) === 36) {
    console.log('  Found in T2 at 0x' + p.toString(16));
    for (let q = p; q < p + 0xb8; q += 8) {
      const a = T2.readUInt32LE(q);
      const b = T2.readUInt32LE(q + 4);
      const aName = (a < types.length) ? types[a].name : '?';
      const bName = (b < types.length) ? types[b].name : '?';
      console.log('    0x' + q.toString(16) + ': (' + a.toString().padStart(3) + ',' + b.toString().padStart(3) + ')  ' + aName.padEnd(30) + ' <-> ' + bName);
    }
    break;
  }
}

// What's BEFORE the index? Could be a section header.
console.log('\n=== 0xa600..0xa6a8 in T1 (might be section header) ===');
for (let p = 0xa600; p < 0xa6a8; p += 4) {
  const a = T1.readUInt32LE(p);
  console.log('  0x' + p.toString(16) + ': u32=' + a + (a < 106 && a > 0 ? '  [type?]' : ''));
}

// What's after the index?
console.log('\n=== 0xa760..0xa800 in T1 (what follows the index?) ===');
for (let p = 0xa760; p < 0xa800; p += 8) {
  const a = T1.readUInt32LE(p);
  const b = T1.readUInt32LE(p + 4);
  console.log('  0x' + p.toString(16) + ': u32a=' + a.toString().padStart(12) + '  u32b=' + b.toString().padStart(12));
}
