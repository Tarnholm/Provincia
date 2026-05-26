// Dump a large region around Spain's treasury 0x2c5e1 in T1 and T2
// to identify the structure of the player faction record.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T1 = fs.readFileSync(path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav'));
const T2 = fs.readFileSync(path.join(BASE_R, 'save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav'));

console.log('=== T1 vs T2 around Spain treasury at 0x2c5e1 ===');
console.log('Showing only CHANGING positions (T1 != T2):');
console.log();
for (let p = 0x2c000; p < 0x2cc00; p += 4) {
  const v1 = T1.readUInt32LE(p);
  const v2 = T2.readUInt32LE(p);
  if (v1 !== v2) {
    // Skip if both look like garbage (0xFFFFFFFF, etc.)
    const isMarker = v1 === 0xFFFFFFFF || v2 === 0xFFFFFFFF;
    const tag = (p === 0x2c5e1) ? '   <-- TREASURY' : '';
    console.log('  0x' + p.toString(16) + ': T1=' + v1.toString().padStart(12) + '  T2=' + v2.toString().padStart(12) +
      '  Δ=' + (v2 - v1).toString().padStart(12) + tag);
  }
}

// Also check: is the treasury at 0x2c5e1 at byte-aligned offset?
// 0x2c5e1 % 4 = 1, so it's BYTE-aligned, not u32-aligned.
console.log('\n0x2c5e1 % 4 = ' + (0x2c5e1 % 4) + ' (byte-aligned, NOT u32-aligned)');
console.log('Trying neighboring u32-aligned offsets:');
for (let off = 0x2c5dc; off <= 0x2c5ec; off++) {
  if (off + 4 > T1.length) continue;
  const v1 = T1.readUInt32LE(off);
  const v2 = T2.readUInt32LE(off);
  console.log('  0x' + off.toString(16) + ' (mod4=' + (off % 4) + '): T1=' + v1 + '  T2=' + v2);
}
