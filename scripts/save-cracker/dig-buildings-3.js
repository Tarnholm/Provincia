// Walk per-settlement building lists. Format:
//   pstr16("default_set\0")
//   +0   u32 selfPtr
//   +4   u32 someHash/uuid
//   +8   4 bytes 0xfc canary
//   +12  u32 ?
//   +16  u32 ?
//   +20  u32 =1
//   +24-32 zeros
//   +33  byte 0x01
//   +41  byte 0x01
//   +49  byte 0x01
//   +53  u32 buildingCount
//   +57  u32 pointer
//   +61  building list starts (pstr16 ASCIIZ each, each followed by some data)

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

function readPstr16Asciiz(buf, off) {
  if (off + 2 > buf.length) return null;
  const lenP1 = buf.readUInt16LE(off);
  if (lenP1 < 2 || lenP1 > 100) return null;
  if (off + 2 + lenP1 > buf.length) return null;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = buf[off + 2 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (buf[off + 2 + lenP1 - 1] !== 0) return null;
  return { str: buf.slice(off + 2, off + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
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

const defSets = findPstr16Asciiz(peace, 'default_set');
console.log('Total settlements: ' + defSets.length);

let totalBldgs = 0;
let firstSamples = [];
for (let i = 0; i < defSets.length; i++) {
  const ds = defSets[i];
  const headerStart = ds + 14;  // bytes after "default_set" pstr16
  const buildingCount = peace.readUInt32LE(headerStart + 53);
  // u32@+57 is a forward pointer to right before the first building
  const ptr57 = peace.readUInt32LE(headerStart + 57);
  // First building pstr16 is at +61
  const buildings = [];
  let p = headerStart + 61;
  for (let b = 0; b < buildingCount && b < 50; b++) {
    const r = readPstr16Asciiz(peace, p);
    if (!r) {
      buildings.push('<<NULL@0x' + p.toString(16) + '>>');
      break;
    }
    buildings.push(r.str);
    // Skip the string + some trailing data — need to find the stride
    // Walk forward looking for the next ASCIIZ pstr16 of a known building type
    p += r.totalLen;
    let nextP = p;
    let foundNext = false;
    for (let skip = 0; skip < 200; skip++) {
      const r2 = readPstr16Asciiz(peace, p + skip);
      if (r2 && r2.str.length > 4 && /^[a-z][a-z_0-9]*$/.test(r2.str)) {
        // valid candidate — should look like a building name (no number prefix etc)
        nextP = p + skip;
        foundNext = true;
        break;
      }
    }
    if (foundNext) p = nextP;
  }
  totalBldgs += buildings.length;
  if (i < 10) {
    firstSamples.push({ idx: i, addr: '0x' + ds.toString(16), cnt: buildingCount, blds: buildings });
  }
}

console.log('Total buildings across all settlements: ' + totalBldgs);
console.log('\n=== First 10 settlements ===');
for (const s of firstSamples) {
  console.log('\n' + s.addr + ' (count=' + s.cnt + '):');
  for (const b of s.blds) console.log('  - ' + b);
}
