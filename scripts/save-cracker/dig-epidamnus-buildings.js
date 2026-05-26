// Walk Epidamnus's COMPLETE building list including dual-list / extra buildings

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const T11 = fs.readFileSync(path.join(BASE, 'save_Autosave   Macedon   Turn 11 Epidamnus enslaved.sav'));
const T12 = fs.readFileSync(path.join(BASE, 'save_Autosave   Macedon   Turn 12 retrained and upgraded units.sav'));

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

function findUtf16(buf, str) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(str.length, 0);
  const strBytes = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) strBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  const target = Buffer.concat([lenBuf, strBytes]);
  return buf.indexOf(target);
}

// LOOSE walker — collect ALL pstr16 strings between Epidamnus and the next settlement
function walkAllBuildings(buf, label) {
  const epi = findUtf16(buf, 'Epidamnus');
  console.log('\n=== ' + label + ' (Epidamnus at 0x' + epi.toString(16) + ') ===');
  // Find default_set after Epidamnus name
  const dsTarget = Buffer.from([0x0c, 0x00, 0x64, 0x65, 0x66, 0x61, 0x75, 0x6c, 0x74, 0x5f, 0x73, 0x65, 0x74, 0x00]);
  const firstDS = buf.indexOf(dsTarget, epi);
  console.log('First default_set: 0x' + firstDS.toString(16));

  // Find the NEXT default_set after first (might be a dual-list)
  const secondDS = buf.indexOf(dsTarget, firstDS + 14);
  if (secondDS !== -1 && secondDS < firstDS + 5000) {
    console.log('Second default_set within 5000 bytes: 0x' + secondDS.toString(16));
  }

  // Walk ALL pstr16 ASCII strings between firstDS and the next settlement
  // Don't stop at default_set markers — keep going.
  let p = firstDS + 14 + 61;
  const end = (secondDS !== -1) ? secondDS + 2000 : firstDS + 5000;
  const buildings = [];
  while (p < end && p < buf.length - 4) {
    const r = readPstr16Asciiz(buf, p);
    if (!r) { p++; continue; }
    if (r.str === 'default_set') {
      console.log('  --- default_set marker at 0x' + p.toString(16) + ' (new sub-list?) ---');
      p += r.totalLen + 61;  // skip its header too
      continue;
    }
    if (!/^[a-z_][a-z_0-9]*$/.test(r.str)) { p++; continue; }
    if (r.str.length < 4) { p++; continue; }
    const tier = buf[p + r.totalLen + 4];
    const culture = buf[p + r.totalLen + 76];
    buildings.push({ off: p, name: r.str, tier, culture });
    console.log('  0x' + p.toString(16) + '  ' + r.str.padEnd(28) + ' tier=' + tier + ' culture=' + culture);
    p += r.totalLen + 78;
  }
  return buildings;
}

const b11 = walkAllBuildings(T11, 'T11 enslaved');
const b12 = walkAllBuildings(T12, 'T12 retrained');

// Diff:
console.log('\n=== Diff between T11 and T12 building lists ===');
const t11Map = {};
for (const b of b11) t11Map[b.name + '_' + b.tier] = b;
const t12Map = {};
for (const b of b12) t12Map[b.name + '_' + b.tier] = b;
const allKeys = new Set([...Object.keys(t11Map), ...Object.keys(t12Map)]);
for (const k of allKeys) {
  const inT11 = k in t11Map;
  const inT12 = k in t12Map;
  if (!inT11) console.log('  ADDED in T12:   ' + k);
  if (!inT12) console.log('  REMOVED in T12: ' + k);
}
