// Decode per-settlement building lists. Each settlement record contains
// a list of pstr16 ASCIIZ building names after the settlement name.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

// Carthago_Nova name is at 0x3261a, 13 chars × 2 = 26 bytes UTF-16, so name ends at 0x32634
// Then some struct + building list begins
function readPstr16Asciiz(buf, off) {
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

// For each Spanish settlement, walk forward from the name pstr16 and decode
// the building list.
const SETTLEMENTS = [
  ['Carthago_Nova', 0x32618],  // strlen prefix at 0x32618 (name starts at 0x3261a)
  ['Corduba', 0x242cd],
  ['Numantia', 0x27795],
  ['Asturica', 0x31c3a],
  ['Carthage', 0x22807],
  ['Lilybaeum', 0x22d50],
  ['Arretium', 0x19b16],
  ['Alexandria', 0x1e064],
];

for (const [name, strlenOff] of SETTLEMENTS) {
  console.log('\n=== ' + name + ' settlement record (starting at 0x' + strlenOff.toString(16) + ') ===');
  // Read the name first
  const nameRec = readPstr16Utf16(peace, strlenOff);
  if (!nameRec) {
    console.log('  Failed to read name pstr16');
    continue;
  }
  console.log('Name: "' + nameRec.str + '" (' + nameRec.totalLen + ' bytes)');
  // Walk forward from after the name and look for ASCIIZ building names
  let p = strlenOff + nameRec.totalLen;
  let buildingCount = 0;
  // Skip up to 50 bytes for any struct, then scan
  for (let skipBytes = 0; skipBytes < 80 && buildingCount === 0; skipBytes++) {
    const tryP = p + skipBytes;
    const r = readPstr16Asciiz(peace, tryP);
    if (r && /^[a-z][a-z_0-9]*$/.test(r.str) && r.str.length > 3 && r.str.length < 40) {
      p = tryP;
      console.log('  First building string at +' + skipBytes + ': "' + r.str + '"');
      break;
    }
  }
  // Now walk forward reading building strings
  console.log('Buildings:');
  let q = p;
  for (let i = 0; i < 30; i++) {
    if (q + 2 > peace.length) break;
    const r = readPstr16Asciiz(peace, q);
    if (!r || !/^[a-z_][a-z_0-9]*$/.test(r.str)) {
      // Try to skip 4 bytes (might be a separator/count) and try again
      const r2 = readPstr16Asciiz(peace, q + 4);
      if (r2 && /^[a-z_][a-z_0-9]*$/.test(r2.str)) {
        console.log('  +4 separator at 0x' + q.toString(16) + ', next: "' + r2.str + '"');
        q += 4 + r2.totalLen;
        continue;
      }
      // Stop after a few failures
      break;
    }
    console.log('  0x' + q.toString(16) + '  "' + r.str + '"');
    q += r.totalLen;
  }
}
