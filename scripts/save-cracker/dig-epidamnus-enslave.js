// Compare Epidamnus before/after enslavement to find ownership-transfer bytes
// This is a CONTROLLED EXPERIMENT — only ownership-related changes should differ.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const BEFORE = fs.readFileSync(path.join(BASE, 'save_Autosave   Macedon   Turn 8 average defeat.sav'));
const SIEGE = fs.readFileSync(path.join(BASE, 'save_Autosave   Macedon   Turn 4 besige epidamnus.sav'));
const ENSLAVED = fs.readFileSync(path.join(BASE, 'save_Autosave   Macedon   Turn 11 Epidamnus enslaved.sav'));

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

// Find Epidamnus in each save by UTF-16 name search
function findUtf16(buf, str) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(str.length, 0);
  const strBytes = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) strBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  const target = Buffer.concat([lenBuf, strBytes]);
  return buf.indexOf(target);
}

console.log('=== Epidamnus locations in each save ===');
console.log('  Siege T4:    0x' + findUtf16(SIEGE, 'Epidamnus').toString(16));
console.log('  Defeat T8:   0x' + findUtf16(BEFORE, 'Epidamnus').toString(16));
console.log('  Enslaved T11: 0x' + findUtf16(ENSLAVED, 'Epidamnus').toString(16));

// Find building list around each Epidamnus
function getEpidamnus(buf) {
  const nameOff = findUtf16(buf, 'Epidamnus');
  if (nameOff === -1) return null;
  // Find default_set after name
  const dsTarget = Buffer.from([0x0c, 0x00, 0x64, 0x65, 0x66, 0x61, 0x75, 0x6c, 0x74, 0x5f, 0x73, 0x65, 0x74, 0x00]);
  const ds = buf.indexOf(dsTarget, nameOff);
  if (ds === -1 || ds - nameOff > 50) return null;
  // Read X, Y from default_set header
  const tileX = buf.readUInt32LE(ds + 14 + 12);
  const tileY = buf.readUInt32LE(ds + 14 + 16);
  // Read owner from stats block (nameOff - 583)
  let owner = null;
  let pop = null;
  if (nameOff >= 583) {
    owner = buf.readUInt32LE(nameOff - 583);
    pop = buf.readUInt32LE(nameOff - 583 + 548);
  }
  // Walk buildings
  let p = ds + 14 + 61;
  const buildings = [];
  while (true) {
    const r = readPstr16Asciiz(buf, p);
    if (!r) break;
    if (!/^[a-z_][a-z_0-9]*$/.test(r.str)) break;
    if (r.str === 'default_set') break;
    const data = buf.slice(p + r.totalLen, p + r.totalLen + 78);
    buildings.push({ name: r.str, tier: data[4], culture: data[76] });
    p += r.totalLen + 78;
  }
  return { nameOff, ds, tileX, tileY, owner, pop, buildings };
}

const siege = getEpidamnus(SIEGE);
const before = getEpidamnus(BEFORE);
const enslaved = getEpidamnus(ENSLAVED);

console.log('\n=== Epidamnus state comparison ===');
console.log('             Siege T4    Defeat T8    Enslaved T11');
console.log('  owner    : ' + String(siege?.owner ?? 'NA').padStart(8) + '    ' + String(before?.owner ?? 'NA').padStart(8) + '    ' + String(enslaved?.owner ?? 'NA').padStart(8));
console.log('  pop      : ' + String(siege?.pop ?? 'NA').padStart(8) + '    ' + String(before?.pop ?? 'NA').padStart(8) + '    ' + String(enslaved?.pop ?? 'NA').padStart(8));
console.log('  tile X,Y : (' + siege?.tileX + ',' + siege?.tileY + ')  (' + before?.tileX + ',' + before?.tileY + ')  (' + enslaved?.tileX + ',' + enslaved?.tileY + ')');

if (siege && before && enslaved) {
  console.log('\n=== Building list changes ===');
  for (let i = 0; i < Math.max(siege.buildings.length, enslaved.buildings.length); i++) {
    const s = siege.buildings[i];
    const b = before.buildings[i];
    const e = enslaved.buildings[i];
    const sName = s ? s.name + '/t' + s.tier + '/c' + s.culture : '-';
    const bName = b ? b.name + '/t' + b.tier + '/c' + b.culture : '-';
    const eName = e ? e.name + '/t' + e.tier + '/c' + e.culture : '-';
    console.log('  ' + i + ': siege=' + sName.padEnd(30) + ' defeat=' + bName.padEnd(30) + ' enslaved=' + eName);
  }
}
