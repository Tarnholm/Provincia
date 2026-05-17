// Decode the dense u32 cluster at 0x11a0+ as a settlement-owner table.
// Each entry might be a 12-byte record: settlement-id (u32), faction-id (u32),
// some other field (u32).

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

// Dump 0x1190..0x14a0 with u32-stride-12 interpretation
console.log('=== Settlement-owner table candidate (0x1190..0x14a0, stride 12) ===');
console.log('offset       u32@+0   u32@+4   u32@+8   "asciiz interp"');
for (let off = 0x1190; off < 0x14a0; off += 12) {
  if (off + 12 > peace.length) break;
  const a = peace.readUInt32LE(off);
  const b = peace.readUInt32LE(off + 4);
  const c = peace.readUInt32LE(off + 8);
  // Try to interpret +0 as ASCII bytes if low enough
  const bytes = peace.subarray(off, off + 4);
  const asc = Array.from(bytes).map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('');
  console.log('  0x' + off.toString(16) + ': ' +
              String(a).padStart(7) + '  ' +
              String(b).padStart(7) + '  ' +
              String(c).padStart(7) + '  ' + asc);
}

// Hypothesis: count entries with each faction-id (the u32@+0 of each 12-byte record)
// to identify which faction has how many settlements
console.log('\n=== Faction-id occurrence counts in this region (treating u32@+0 as faction-id) ===');
const counts = new Map();
for (let off = 0x1190; off < 0x14a0; off += 12) {
  if (off + 4 > peace.length) break;
  const v = peace.readUInt32LE(off);
  if (v < 0 || v > 30) continue;  // Filter to plausible faction IDs
  counts.set(v, (counts.get(v) || 0) + 1);
}
const sortedCounts = Array.from(counts.entries()).sort((a, b) => a[0] - b[0]);
for (const [id, n] of sortedCounts) {
  console.log('  faction-id=' + String(id).padStart(2) + ': ' + n + ' entries');
}

// In vanilla RTW campaign start:
//   Romans Julii: 4 (Arretium, Ariminum, Croton, Patavium) plus army deployment
//   Romans Brutii: 3 (Capua, Tarentum, Croton actually)
//   Romans Scipii: 3 (Messana, Capua, Lilybaeum actually)
//   Romans Senate: 1 (Rome)
//   Carthage: 5-6 (Carthage, Caralis, Palma, Thapsus, Lilybaeum, Caralis)
//   Egypt: 6+
//   Seleucid: 8+
//   Macedon: 4-5
//   Greek Cities: 5+
//   Numidia: 3
//   Spain: 4 (Carthago Nova, Asturica, Corduba, Numantia)
//   Gauls: 4
//   Germans: 3
//   Britons: 2
//   Pontus: 4
//   Parthia: 3
//   Armenia: 2
//   Dacia: 3
//   Scythia: 3
//   Thrace: 3
// Total: ~80 settlements

// So Spain ~4 settlements, Carthage ~5-6. The faction-id with 4 entries
// might be Spain. The one with 5-6 might be Carthage.
