// Population is likely AFTER the building list, not at a fixed offset.
// For each settlement: walk past the buildings to the trailing data,
// then look for population values there.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const t1 = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Spain   Turn 1.sav'));

function readPstr16Utf16(buf, off) {
  if (off + 2 > buf.length) return null;
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

const defSets = findPstr16Asciiz(t1, 'default_set');
const settlements = [];
for (const ds of defSets) {
  let nameOff = -1;
  for (let step = -20; step <= 0; step++) {
    const c = ds - 18 + step;
    if (c < 0) continue;
    const r = readPstr16Utf16(t1, c);
    if (r && r.totalLen === ds - c - 18) { nameOff = c; break; }
  }
  settlements.push({
    name: nameOff !== -1 ? readPstr16Utf16(t1, nameOff).str : '???',
    defSet: ds,
    headerStart: ds + 14,
  });
}

// For each settlement, walk past the building list to find the tail
function findBuildingsEnd(s) {
  const buildingCount = t1.readUInt32LE(s.headerStart + 84);
  let p = s.headerStart + 92;  // start of building list
  for (let i = 0; i < buildingCount && i < 30; i++) {
    const r = readPstr16Asciiz(t1, p);
    if (!r) return -1;
    p += r.totalLen + 78;  // stride: pstr16 + 78 bytes
  }
  return p;
}

const TARGETS = ['Rome', 'Memphis', 'Carthage', 'Capua', 'Athens', 'Arretium',
  'Carthago_Nova', 'Corduba', 'Numantia', 'Asturica', 'Lilybaeum', 'Bylazora'];

console.log('=== Per-settlement: bytes immediately AFTER building list ===');
for (const t of TARGETS) {
  const s = settlements.find(x => x.name === t);
  if (!s) continue;
  const buildingCount = t1.readUInt32LE(s.headerStart + 84);
  const endP = findBuildingsEnd(s);
  if (endP === -1) {
    console.log('  ' + t + ': could not walk to end');
    continue;
  }
  console.log('\n--- ' + t + ' (defSet=0x' + s.defSet.toString(16) + ', buildings=' + buildingCount + ', tail at 0x' + endP.toString(16) + ') ---');
  // Dump 64 bytes after building list end
  const bytes = [];
  for (let i = 0; i < 64; i++) bytes.push(t1[endP + i].toString(16).padStart(2, '0'));
  console.log('  bytes: ' + bytes.slice(0, 32).join(' '));
  console.log('         ' + bytes.slice(32, 64).join(' '));
  // Try reading u32 fields
  console.log('  u32 fields:');
  for (let i = 0; i < 16; i++) {
    const v = t1.readUInt32LE(endP + i * 4);
    if (v < 100000 && v > 0) {
      console.log('    +' + (i*4) + ': ' + v);
    }
  }
}
