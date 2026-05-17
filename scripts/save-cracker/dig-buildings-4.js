// Decode buildings for Spain's specific settlements and also figure out the
// per-building level (data between building name pstr16s).

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

function hex(buf, off, len) {
  return Array.from(buf.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

// Locate each settlement: scan for "default_set" markers and walk backwards
// to find the name pstr16 UTF-16. The name is just before the marker, after
// the gap bytes "00 00 00 00 00 fc fc fc fc 04 00 00 00 00 <2 bytes>".
const SETTLEMENTS = [
  ['Carthago_Nova', 'spain'],
  ['Corduba', 'spain'],
  ['Numantia', 'spain'],
  ['Asturica', 'spain'],
  ['Carthage', 'carthage'],
  ['Lilybaeum', 'carthage'],
  ['Cirta', 'numidia'],
  ['Thapsus', 'numidia'],
  ['Arretium', 'romans_julii'],
  ['Patavium', 'romans_julii'],
];

console.log('=== Settlement buildings by name ===');
for (const [name, faction] of SETTLEMENTS) {
  // Find name in UTF-16 in the file
  const nameUtf16 = Buffer.alloc(name.length * 2);
  for (let i = 0; i < name.length; i++) nameUtf16.writeUInt16LE(name.charCodeAt(i), i * 2);
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(name.length, 0);
  const target = Buffer.concat([lenBuf, nameUtf16]);
  let off = peace.indexOf(target);
  if (off === -1) {
    console.log('\n=== ' + name + ' (' + faction + '): NOT FOUND ===');
    continue;
  }
  // Find the FIRST occurrence followed by the gap pattern then "default_set"
  let found = false;
  while (off !== -1) {
    const after = off + target.length;
    // gap is ~18 bytes, then "default_set\0" pstr16 (14 bytes: [0c 00] + "default_set\0")
    const peek = peace.slice(after, after + 32);
    const idx = peek.indexOf(Buffer.from([0x0c, 0x00, 0x64, 0x65, 0x66, 0x61, 0x75, 0x6c, 0x74, 0x5f, 0x73, 0x65, 0x74, 0x00]));
    if (idx !== -1 && idx <= 24) {
      const defSetOff = after + idx;
      const headerStart = defSetOff + 14;
      const buildingCount = peace.readUInt32LE(headerStart + 53);
      console.log('\n=== ' + name + ' (' + faction + ') @ 0x' + off.toString(16) + ' buildings=' + buildingCount + ' ===');
      // Walk buildings — show each name and the bytes after it
      let p = headerStart + 61;
      for (let b = 0; b < buildingCount && b < 30; b++) {
        const r = readPstr16Asciiz(peace, p);
        if (!r) { console.log('  <<NULL at 0x' + p.toString(16) + '>>'); break; }
        // Find next building string
        let nextP = -1;
        for (let skip = r.totalLen; skip < 200; skip++) {
          const r2 = readPstr16Asciiz(peace, p + skip);
          if (r2 && r2.str.length > 4 && /^[a-z][a-z_0-9]*$/.test(r2.str)) {
            nextP = p + skip;
            break;
          }
        }
        const stride = nextP === -1 ? (peace.length - p) : (nextP - p);
        // Dump trailing bytes (the level/data)
        const trailLen = Math.min(stride - r.totalLen, 60);
        console.log('  0x' + p.toString(16) + '  ' + r.str.padEnd(28) +
          ' stride=' + stride + ' trail: ' + hex(peace, p + r.totalLen, trailLen));
        p = nextP === -1 ? p + r.totalLen : nextP;
      }
      found = true;
      break;
    }
    off = peace.indexOf(target, off + 1);
  }
  if (!found) console.log('\n=== ' + name + ' (' + faction + '): name found but no default_set after ===');
}
