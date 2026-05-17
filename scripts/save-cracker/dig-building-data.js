// Decode the 78-byte data block after each building pstr16.
// Likely contains: building upgrade level, construction status, hash, etc.

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

// Walk all settlements and collect (building_name, 78-byte data)
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
  // Walk building list at defSet + 14 + 61
  let p = ds + 14 + 61;
  for (let i = 0; i < 30; i++) {
    const r = readPstr16Asciiz(buf, p);
    if (!r || !/^[a-z_]/.test(r.str) || r.str.length < 4) break;
    // The next 78 bytes are the building data
    const dataStart = p + r.totalLen;
    const data = buf.slice(dataStart, dataStart + 78);
    buildings.push({ settlement: settlementName, type: r.str, data, dataOff: dataStart });
    p = dataStart + 78;
  }
}

console.log('Total buildings collected: ' + buildings.length);

// Group by building type
const byType = {};
for (const b of buildings) {
  if (!byType[b.type]) byType[b.type] = [];
  byType[b.type].push(b);
}

// For each building type with 5+ instances, check if there's variation in the data
console.log('\n=== Building types with 5+ instances ===');
const types = Object.entries(byType).filter(([t, list]) => list.length >= 5).sort((a, b) => b[1].length - a[1].length);
for (const [type, list] of types) {
  console.log('  ' + type + ': ' + list.length + ' instances');
}

// For "core_building" (most common), analyze the 78 bytes
const core = byType['core_building'] || [];
console.log('\n=== core_building 78-byte data analysis (' + core.length + ' instances) ===');
// Find which byte offsets vary
const varying = [];
for (let bytePos = 0; bytePos < 78; bytePos++) {
  const vals = new Set(core.map(b => b.data[bytePos]));
  if (vals.size > 1 && vals.size < 20) {
    varying.push({ bytePos, distinct: vals.size, sample: Array.from(vals).slice(0, 5) });
  }
}
console.log('Varying byte positions (2-19 distinct values):');
for (const v of varying) {
  console.log('  byte+' + v.bytePos + ': ' + v.distinct + ' distinct, samples: ' + v.sample.join(', '));
}

// Print core_building data for 10 sample settlements
console.log('\n=== core_building data sample (first 10 settlements) ===');
for (const b of core.slice(0, 10)) {
  const hexStr = Array.from(b.data).map(x => x.toString(16).padStart(2, '0')).join(' ');
  console.log('  ' + b.settlement.padEnd(20) + ': ' + hexStr);
}
