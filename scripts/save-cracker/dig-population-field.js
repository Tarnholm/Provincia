// Verify that the 5000-hits are settlement population fields by:
//   1. Locating each 5000 hit's nearest preceding settlement name
//   2. Cross-validating: vanilla 270 BC populations for known settlements

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

// Find all "default_set" markers — these are settlement records
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
console.log('Found ' + defSets.length + ' default_set markers (settlements)');

// Build a list of (offset, settlement_name) pairs
const settlements = [];
for (const ds of defSets) {
  let nameOff = -1;
  for (let step = -20; step <= 0; step++) {
    const candidate = ds - 18 + step;
    if (candidate < 0) continue;
    const r = readPstr16Utf16(t1, candidate);
    if (r && r.totalLen === ds - candidate - 18) {
      nameOff = candidate;
      break;
    }
  }
  if (nameOff === -1) {
    settlements.push({ name: '???', defSet: ds, nameOff: -1 });
  } else {
    const nameRec = readPstr16Utf16(t1, nameOff);
    settlements.push({ name: nameRec.str, defSet: ds, nameOff });
  }
}

// For each settlement, find candidate population fields:
// - u32 values in 1000-50000 range within the settlement record
// - Particularly in the bytes BEFORE the building list (first part of record)
function findU32(buf, value, range) {
  const hits = [];
  const target = Buffer.alloc(4);
  target.writeUInt32LE(value, 0);
  let p = range[0];
  while ((p = buf.indexOf(target, p)) !== -1 && p < range[1]) {
    hits.push(p);
    p++;
  }
  return hits;
}

// Find all 5000 hits in 0x100..0x90000
const hits = findU32(t1, 5000, [0x100, 0x90000]);
console.log('\nAll 5000 hits and their nearest preceding settlement:');
for (const h of hits) {
  if (h % 4 !== 0) continue;
  // Find the settlement record this falls inside
  let inside = null;
  for (let i = 0; i < settlements.length; i++) {
    const s = settlements[i];
    const sStart = s.nameOff !== -1 ? s.nameOff : s.defSet;
    const sEnd = i + 1 < settlements.length ? (settlements[i+1].nameOff !== -1 ? settlements[i+1].nameOff : settlements[i+1].defSet) : 0x90000;
    if (h >= sStart && h < sEnd) {
      inside = { settlement: s.name, sStart, sEnd, offsetWithin: h - sStart };
      break;
    }
  }
  if (inside) {
    console.log('  u32@0x' + h.toString(16) + ' = 5000  → ' + inside.settlement + ' (+' + inside.offsetWithin + ' bytes from name)');
  } else {
    console.log('  u32@0x' + h.toString(16) + ' = 5000  (outside any settlement record)');
  }
}

// Also check the OFFSETS within settlement records — if population is at a
// CONSISTENT offset from the settlement name, that's the population field
console.log('\n=== Per-settlement check: what u32 lives at name+30 (after gap+default_set)? ===');
for (const s of settlements.slice(0, 15)) {
  if (s.nameOff === -1) continue;
  // Population is likely AFTER default_set (which is at name+nameLen+18 typically)
  // Inside the 61-byte header at default_set+14, there's an int field at +44 or +48
  const dsHeaderStart = s.defSet + 14;
  if (dsHeaderStart + 60 > t1.length) continue;
  // Print the u32s at dsHeaderStart, +4, +8, +12, ... +56
  process.stdout.write('  ' + s.name.padEnd(20) + ' default_set header u32s: ');
  for (let i = 0; i < 16; i++) {
    const v = t1.readUInt32LE(dsHeaderStart + i * 4);
    process.stdout.write(v + ' ');
  }
  console.log();
}
