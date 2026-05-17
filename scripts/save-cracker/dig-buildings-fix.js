// 1. Fix walker to find ALL ~453 buildings (avg 4-5 per settlement)
// 2. Investigate the 2 "outside" hits at 0x3c5f4 and 0x3c652

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

function readPstr16Utf16(buf, off) {
  if (off + 2 > buf.length) return null;
  const len = buf.readUInt16LE(off);
  if (len < 1 || len > 50) return null;
  if (off + 2 + len * 2 > buf.length) return null;
  const chars = [];
  for (let i = 0; i < len; i++) {
    const c = buf.readUInt16LE(off + 2 + i * 2);
    if (c < 0x20 || c > 0x024F) return null;
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

// Improved walker: scan forward from each settlement's default_set
// until we hit the next settlement's name
const defSets = findPstr16Asciiz(buf, 'default_set');
const settlements = [];
for (const ds of defSets) {
  let nameOff = -1;
  for (let step = -50; step <= 0; step++) {
    const c = ds - 18 + step;
    if (c < 0) continue;
    const r = readPstr16Utf16(buf, c);
    if (r && r.totalLen === ds - c - 18) { nameOff = c; break; }
  }
  if (nameOff === -1) continue;
  settlements.push({ name: readPstr16Utf16(buf, nameOff).str, defSet: ds, nameOff });
}

function walkBuildingsLoose(s, nextNameOff) {
  // Scan EVERY 4-byte position from default_set+14+61 looking for any
  // building pstr16. Don't rely on strict 78-byte stride.
  let p = s.defSet + 14 + 61;
  const end = nextNameOff - 200;  // leave room for stats block of next settlement
  const buildings = [];
  while (p < end) {
    const r = readPstr16Asciiz(buf, p);
    if (r && r.str.length >= 4 && /^[a-z_][a-z_0-9]*$/.test(r.str)) {
      // Valid building name found
      buildings.push({ name: r.str, off: p });
      p += r.totalLen + 78;  // advance by stride
    } else {
      // No valid building here — skip 1 byte and try again
      p++;
    }
  }
  return buildings;
}

const allBuildings = [];
for (let i = 0; i < settlements.length; i++) {
  const next = i + 1 < settlements.length ? settlements[i+1].nameOff : buf.length;
  const bldgs = walkBuildingsLoose(settlements[i], next);
  allBuildings.push({ settlement: settlements[i].name, buildings: bldgs });
}

console.log('=== Building counts per settlement (improved walker) ===');
let total = 0;
for (const s of allBuildings) {
  total += s.buildings.length;
}
console.log('Total buildings: ' + total + ' (vs 246 in old walker)');

// Show first 20 settlements
console.log('\n=== First 20 settlements with full building list ===');
for (const s of allBuildings.slice(0, 20)) {
  console.log('  ' + s.settlement.padEnd(20) + ' (' + s.buildings.length + '): ' + s.buildings.map(b => b.name).join(', '));
}

// Investigate the outside hits at 0x3c5f4 and 0x3c652
console.log('\n=== Bytes around 0x3c5f4 (core_building outside settlement zone) ===');
function hex(off, len) {
  return Array.from(buf.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}
for (let row = -4; row <= 6; row++) {
  const addr = 0x3c5f4 + row * 16;
  console.log('  0x' + addr.toString(16) + ': ' + hex(addr, 16));
}

console.log('\n=== Bytes around 0x3c652 (temple_of_one_god outside) ===');
for (let row = -4; row <= 6; row++) {
  const addr = 0x3c652 + row * 16;
  console.log('  0x' + addr.toString(16) + ': ' + hex(addr, 16));
}
