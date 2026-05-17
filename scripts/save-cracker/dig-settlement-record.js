// Investigate the full settlement record format. Format observed:
//   pstr16_utf16(settlement_name)
//   [gap: 5 zero bytes + 4×0xfc + u32=4 + u16=0 + u16=X (varies)]
//   pstr16_asciiz("default_set")
//   u32 selfPtr
//   u32 someHash
//   4 bytes 0xfc
//   u32 ?
//   u32 ?
//   u32 =1
//   8 zero bytes
//   01 + 7 zeros + 01 + 7 zeros + 01
//   u32 buildingCount
//   u32 ptr
//   N × (pstr16_name + 78 bytes building-data)

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

// For each default_set marker, scan BACKWARDS to find the preceding name pstr16
// (UTF-16 with the pattern: u16 len + len*2 bytes + 5 zeros + fc fc fc fc + 04 00 00 00 + 4 bytes)
console.log('=== All settlement names ===');
const defSets = findPstr16Asciiz(peace, 'default_set');
const settlementList = [];
for (const ds of defSets) {
  // Look back ~20-40 bytes for the name pstr16
  // The pattern before "0c 00 64 65 ..." (default_set) is:
  //   <name UTF-16>  00 00 00 00 00 fc fc fc fc 04 00 00 00 00 XX XX 00 00
  // That's 18 bytes between end of name and "0c 00 64..."
  let nameOff = ds - 18;  // approximate
  // Walk backwards 5 bytes to find a valid name pstr16 starting position
  for (let step = -20; step <= 0; step++) {
    const candidate = ds - 18 + step;
    if (candidate < 0) continue;
    const r = readPstr16Utf16(peace, candidate);
    if (r && r.totalLen === ds - candidate - 18) {
      nameOff = candidate;
      break;
    }
  }
  const nameRec = readPstr16Utf16(peace, nameOff);
  if (nameRec) {
    settlementList.push({ name: nameRec.str, nameOff, defSet: ds });
  }
}
console.log('Found ' + settlementList.length + ' settlements with names:');
for (const s of settlementList) {
  console.log('  0x' + s.nameOff.toString(16).padStart(6, '0') + '  ' + s.name);
}

// Look at what comes BEFORE the name. Maybe there's an owner-faction pointer
// or settlement-level marker.
console.log('\n=== 32 bytes BEFORE first 8 settlement names ===');
function hex(buf, off, len) {
  return Array.from(buf.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}
for (const s of settlementList.slice(0, 8)) {
  console.log('\n' + s.name + ' name @ 0x' + s.nameOff.toString(16) + ':');
  console.log('  -32..-16: ' + hex(peace, s.nameOff - 32, 16));
  console.log('  -16..-0:  ' + hex(peace, s.nameOff - 16, 16));
}
