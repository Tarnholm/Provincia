// Properly compute the region-length offset and post-region fields

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T0 = fs.readFileSync(path.join(BASE_R, 'save_macedon t0.sav'));

// Find "greek general" role strings
const target = Buffer.from('greek general\0', 'ascii');
const positions = [];
let p = 0;
while (true) {
  const idx = T0.indexOf(target, p);
  if (idx === -1) break;
  positions.push(idx);
  p = idx + 1;
}
console.log('greek general role strings: ' + positions.length);

// For each, read fields with the corrected layout:
//   +35 u16 region name length (chars)
//   +37 UTF-16 region name (length*2 bytes)
//   +37+len*2  ff ff ff ff sentinel (4 bytes)
//   +37+len*2+4  u32 spouse uuid
//   +37+len*2+8  f32 float
//   +37+len*2+12 u32 age
console.log('\nField extraction (using region_length at +35):');
console.log('role_offset | region | age | spouse_uuid | own_uuid');
let validAges = [];
for (let i = 0; i < Math.min(positions.length, 20); i++) {
  const off = positions[i];
  const regLen = T0.readUInt16LE(off + 35);
  if (regLen < 1 || regLen > 30) {
    console.log('  0x' + off.toString(16) + ' regLen=' + regLen + ' (invalid)');
    continue;
  }
  // Read region as UTF-16
  let region = '';
  for (let j = 0; j < regLen; j++) {
    region += String.fromCharCode(T0.readUInt16LE(off + 37 + j * 2));
  }
  // After region
  const postRegion = off + 37 + regLen * 2;
  const sentinel = T0.readUInt32LE(postRegion);
  const spouseUuid = T0.readUInt32LE(postRegion + 4);
  // skip float at +8
  const age = T0.readUInt32LE(postRegion + 12);
  const ownUuid = T0.readUInt32LE(off + 15);
  const sentOK = (sentinel === 0xffffffff) ? '✓' : '✗(' + sentinel.toString(16) + ')';
  console.log('  0x' + off.toString(16).padStart(7) +
    ' region="' + region + '"' +
    '  age=' + age.toString().padStart(3) +
    '  spouse=0x' + spouseUuid.toString(16).padStart(8, '0') +
    '  uuid=0x' + ownUuid.toString(16).padStart(8, '0') +
    '  sentinel=' + sentOK);
  if (age >= 14 && age <= 80) validAges.push(age);
}

console.log('\nReasonable ages (14-80) seen: [' + validAges.sort((a, b) => a - b).join(', ') + ']');
