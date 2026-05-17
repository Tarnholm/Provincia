// Deep investigation: why did my cracker show Pella core_building tier change?
// Check every byte field, look for multiple Pella records.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const T1 = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 1.sav'));
const T7 = fs.readFileSync(path.join(BASE, 'save_Autosave   Macedon   Turn 7 New Governour in Sparta.sav'));

function findAllPella(buf) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(5, 0);
  const strBytes = Buffer.alloc(10);
  for (let i = 0; i < 5; i++) strBytes.writeUInt16LE('Pella'.charCodeAt(i), i * 2);
  const target = Buffer.concat([lenBuf, strBytes]);
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(target, p)) !== -1) {
    hits.push(p);
    p++;
  }
  return hits;
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

console.log('=== Pella occurrences in T1 ===');
const t1Pella = findAllPella(T1);
console.log('Found ' + t1Pella.length + ' Pella pstr16: ' + t1Pella.map(o => '0x' + o.toString(16)).join(', '));

console.log('\n=== Pella occurrences in T7 ===');
const t7Pella = findAllPella(T7);
console.log('Found ' + t7Pella.length + ' Pella pstr16: ' + t7Pella.map(o => '0x' + o.toString(16)).join(', '));

// For each Pella, find the closest default_set and walk buildings
function getBuildingsForPella(buf, nameOff) {
  // Find default_set after the name
  const dsTarget = Buffer.from([0x0c, 0x00, 0x64, 0x65, 0x66, 0x61, 0x75, 0x6c, 0x74, 0x5f, 0x73, 0x65, 0x74, 0x00]);
  const ds = buf.indexOf(dsTarget, nameOff);
  if (ds === -1 || ds - nameOff > 50) return null;
  // Walk buildings
  let p = ds + 14 + 61;
  const buildings = [];
  while (true) {
    const r = readPstr16Asciiz(buf, p);
    if (!r) break;
    if (!/^[a-z_][a-z_0-9]*$/.test(r.str)) break;
    if (r.str === 'default_set') break;
    // Read all 78 bytes of data
    const data = buf.slice(p + r.totalLen, p + r.totalLen + 78);
    buildings.push({ name: r.str, off: p, allBytes: data });
    p += r.totalLen + 78;
  }
  return { dsOff: ds, buildings };
}

for (const [label, buf, pellas] of [['T1', T1, t1Pella], ['T7', T7, t7Pella]]) {
  console.log('\n=== ' + label + ' Pella detail ===');
  for (const nameOff of pellas) {
    const data = getBuildingsForPella(buf, nameOff);
    if (!data) { console.log('  Pella @ 0x' + nameOff.toString(16) + ': no default_set within 30 bytes'); continue; }
    console.log('\n  Pella @ 0x' + nameOff.toString(16) + ' (defSet @ 0x' + data.dsOff.toString(16) + '):');
    for (const b of data.buildings) {
      const bytes = Array.from(b.allBytes.slice(0, 10)).map(x => x.toString(16).padStart(2, '0')).join(' ');
      console.log('    ' + b.name.padEnd(25) + ' bytes+0..9: ' + bytes);
    }
  }
}

// Specifically for core_building in both saves: compare ALL 78 bytes
console.log('\n=== core_building bytes comparison (T1 vs T7) ===');
function getCoreBuildingBytes(buf, pellas) {
  for (const nameOff of pellas) {
    const data = getBuildingsForPella(buf, nameOff);
    if (!data) continue;
    const core = data.buildings.find(b => b.name === 'core_building');
    if (core) return core.allBytes;
  }
  return null;
}
const t1Core = getCoreBuildingBytes(T1, t1Pella);
const t7Core = getCoreBuildingBytes(T7, t7Pella);
if (t1Core && t7Core) {
  console.log('T1 core_building 78-byte data:');
  console.log('  ' + Array.from(t1Core).map(b => b.toString(16).padStart(2, '0')).join(' '));
  console.log('T7 core_building 78-byte data:');
  console.log('  ' + Array.from(t7Core).map(b => b.toString(16).padStart(2, '0')).join(' '));
  console.log('Diff bytes:');
  for (let i = 0; i < 78; i++) {
    if (t1Core[i] !== t7Core[i]) {
      console.log('  byte+' + i + ': T1=0x' + t1Core[i].toString(16) + ' (' + t1Core[i] + ') vs T7=0x' + t7Core[i].toString(16) + ' (' + t7Core[i] + ')');
    }
  }
}
