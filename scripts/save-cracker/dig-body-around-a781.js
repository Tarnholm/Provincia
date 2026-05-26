// Investigate the FACTION_ECONOMICS region near 0xa781 in Spain T1

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T1 = fs.readFileSync(path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav'));

// Dump 0xa600 to 0xb200 as (u32, u32) pairs to see the section index pattern
console.log('=== Bytes 0xa600..0xb000 as u32 pairs ===');
for (let p = 0xa600; p < 0xb000; p += 8) {
  const a = T1.readUInt32LE(p);
  const b = T1.readUInt32LE(p + 4);
  let hint = '';
  if (a < 106 && a > 0) hint = '(might be type_id ' + a + ')';
  console.log('  0x' + p.toString(16) + ': u32a=' + a.toString().padStart(10) + '  u32b=' + b.toString().padStart(10) + '  ' + hint);
}
