// Investigate byte+4 of building data as building TIER/upgrade level.
// Each building category has multiple tiers; the save must store which one.

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

// Collect all buildings with their settlement context
const defSets = findPstr16Asciiz(buf, 'default_set');
const buildings = [];
for (const ds of defSets) {
  let nameOff = -1;
  for (let step = -50; step <= 0; step++) {
    const c = ds - 18 + step;
    if (c < 0) continue;
    const r = readPstr16Utf16(buf, c);
    if (r && r.totalLen === ds - c - 18) { nameOff = c; break; }
  }
  if (nameOff === -1) continue;
  const settlementName = readPstr16Utf16(buf, nameOff).str;
  let p = ds + 14 + 61;
  for (let i = 0; i < 30; i++) {
    const r = readPstr16Asciiz(buf, p);
    if (!r || !/^[a-z_]/.test(r.str) || r.str.length < 4) break;
    const dataStart = p + r.totalLen;
    const data = buf.slice(dataStart, dataStart + 78);
    buildings.push({ settlement: settlementName, type: r.str, byte4: data[4], byte25: data[25], byte76: data[76] });
    p = dataStart + 78;
  }
}

console.log('Total buildings: ' + buildings.length);

// For each building category, show distribution of byte+4 across settlements
console.log('\n=== byte+4 distribution by building category ===');
const types = ['core_building', 'defenses', 'barracks', 'market', 'hinterland_roads',
  'hinterland_farms', 'missiles', 'equestrian', 'temple_of_justice', 'temple_of_trade',
  'temple_of_governors', 'temple_of_leadership', 'temple_of_hunting', 'temple_of_one_god',
  'temple_of_fertility', 'port_buildings', 'amphitheatres', 'smith', 'hinterland_mines'];

for (const type of types) {
  const list = buildings.filter(b => b.type === type);
  if (list.length === 0) continue;
  const dist = {};
  for (const b of list) dist[b.byte4] = (dist[b.byte4] || 0) + 1;
  const distStr = Object.entries(dist).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).map(([k, v]) => k + ':' + v).join(', ');
  console.log('  ' + type.padEnd(25) + ' (' + list.length + ' instances): ' + distStr);
}

// Sample: show core_building byte+4 for specific settlements with known city size
console.log('\n=== core_building byte+4 by settlement (sorted by byte+25 = settlement size) ===');
const cores = buildings.filter(b => b.type === 'core_building');
cores.sort((a, b) => a.byte25 - b.byte25);
for (const b of cores) {
  console.log('  ' + b.settlement.padEnd(25) + ' byte+25=' + b.byte25 + ' byte+4=' + b.byte4 + ' byte+76=' + b.byte76);
}
