// Compare ALL 78 bytes of EACH Pella building between T1 and T7

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const T1 = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 1.sav'));
const T7 = fs.readFileSync(path.join(BASE, 'save_Autosave   Macedon   Turn 7 New Governour in Sparta.sav'));

function findPstr16Utf16(buf, str) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(str.length, 0);
  const strBytes = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) strBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  const target = Buffer.concat([lenBuf, strBytes]);
  return buf.indexOf(target);
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

function getBuildings(buf, settlementName) {
  const nameOff = findPstr16Utf16(buf, settlementName);
  const dsTarget = Buffer.from([0x0c, 0x00, 0x64, 0x65, 0x66, 0x61, 0x75, 0x6c, 0x74, 0x5f, 0x73, 0x65, 0x74, 0x00]);
  const ds = buf.indexOf(dsTarget, nameOff);
  if (ds === -1 || ds - nameOff > 50) return null;
  let p = ds + 14 + 61;
  const buildings = [];
  while (true) {
    const r = readPstr16Asciiz(buf, p);
    if (!r) break;
    if (!/^[a-z_][a-z_0-9]*$/.test(r.str)) break;
    if (r.str === 'default_set') break;
    const data = buf.slice(p + r.totalLen, p + r.totalLen + 78);
    buildings.push({ name: r.str, data });
    p += r.totalLen + 78;
  }
  return buildings;
}

const t1 = getBuildings(T1, 'Pella');
const t7 = getBuildings(T7, 'Pella');

console.log('=== ALL byte differences in Pella buildings T1 vs T7 ===\n');
for (let i = 0; i < t1.length && i < t7.length; i++) {
  const b1 = t1[i];
  const b7 = t7[i];
  if (b1.name !== b7.name) {
    console.log(b1.name + ' / ' + b7.name + ' [NAME MISMATCH]');
    continue;
  }
  const diffs = [];
  for (let j = 0; j < 78; j++) {
    if (b1.data[j] !== b7.data[j]) {
      diffs.push({ offset: j, t1: b1.data[j], t7: b7.data[j] });
    }
  }
  if (diffs.length > 0) {
    console.log(b1.name + ': ' + diffs.length + ' byte diffs');
    for (const d of diffs) {
      console.log('  byte+' + d.offset + ': T1=0x' + d.t1.toString(16) + ' (' + d.t1 + ') → T7=0x' + d.t7.toString(16) + ' (' + d.t7 + ')');
    }
  } else {
    console.log(b1.name + ': NO CHANGES');
  }
}
