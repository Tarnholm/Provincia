// Decode the settlement record format around the UTF-16 name.
// Each settlement has: ... fields ... pstr16 UTF-16 name ... building list ...
// Find the SETTLEMENT-ID encoding.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

// Known settlement positions (UTF-16 name string starts at these offsets)
const SETTLEMENTS = [
  ['Carthago_Nova',  0x3261a, 'spain', 13],
  ['Numantia',       0x27797, 'spain', 8],
  ['Corduba',        0x242cf, 'spain', 7],
  ['Asturica',       0x31c3c, 'spain', 8],
  ['Carthage',       0x22809, 'carthage', 8],
  ['Lilybaeum',      0x22d52, 'carthage', 9],
  ['Caralis',        0x237f7, 'carthage', 7],
  ['Palma',          0x23cea, 'carthage', 5],
  ['Thapsus',        0x232fc, 'carthage', 7],
  ['Cirta',          0x2f196, 'numidia', 5],
  ['Arretium',       0x19b18, 'romans_julii', 8],
  ['Ariminum',       0x1a12d, 'romans_julii', 8],
  ['Alexandria',     0x1e066, 'egypt', 10],
];

// For each settlement, look at the bytes immediately BEFORE the pstr16 strlen prefix
console.log('settlement'.padEnd(18) + ' faction'.padEnd(14) + ' addr     pre-bytes');
for (const [name, namePos, faction, len] of SETTLEMENTS) {
  // strlen prefix is at namePos - 2
  const strlenOff = namePos - 2;
  const u16AtMinus4 = peace.readUInt16LE(strlenOff - 2);  // 2 bytes before strlen
  const u32AtMinus8 = peace.readUInt32LE(strlenOff - 8);
  const u32AtMinus12 = peace.readUInt32LE(strlenOff - 12);
  const u32AtMinus16 = peace.readUInt32LE(strlenOff - 16);
  const u32AtMinus20 = peace.readUInt32LE(strlenOff - 20);
  console.log(name.padEnd(18) + faction.padEnd(14) +
              ' 0x' + namePos.toString(16) +
              '  u16@-4: ' + u16AtMinus4.toString().padStart(4) +
              '  u32@-8: ' + u32AtMinus8.toString().padStart(7) +
              '  u32@-12: ' + u32AtMinus12.toString().padStart(10));
}

// Settlement-ID might be in the u32 just before the strlen prefix, OR encoded
// in nearby fields. The pattern should be: each settlement has a UNIQUE id.

// Now check what the u32 just BEFORE the prefix is
console.log('\n=== u32@(strlenOff-4) for each settlement ===');
for (const [name, namePos, faction] of SETTLEMENTS) {
  const strlenOff = namePos - 2;
  const v = peace.readUInt32LE(strlenOff - 4);
  console.log('  ' + name.padEnd(18) + ' = ' + v + ' (0x' + v.toString(16) + ')');
}

// Each Spanish settlement should have a unique settlement-ID
// And the IDs across factions should be DIFFERENT (no two settlements have same ID)

// Also dump 64 bytes before Carthago_Nova to find the record start
console.log('\n=== 80 bytes before Carthago_Nova ===');
for (let o = 0x3261a - 80; o < 0x3261a; o += 16) {
  const slice = peace.subarray(o, o + 16);
  const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  console.log('  0x' + o.toString(16) + ': ' + hex + '  ' + asc);
}
