// Improved settlement name parser — allow extended Latin chars for accented names

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

function readPstr16Utf16Extended(buf, off) {
  if (off + 2 > buf.length) return null;
  const len = buf.readUInt16LE(off);
  if (len < 1 || len > 50) return null;
  if (off + 2 + len * 2 > buf.length) return null;
  const chars = [];
  for (let i = 0; i < len; i++) {
    const c = buf.readUInt16LE(off + 2 + i * 2);
    // Allow basic Latin + Latin Extended (0x20-0x024F) + some other ranges
    if (c < 0x20 || c > 0x024F) return null;
    chars.push(String.fromCharCode(c));
  }
  return { str: chars.join(''), totalLen: 2 + len * 2 };
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

const defSets = findPstr16Asciiz(buf, 'default_set');
console.log('Total default_set markers: ' + defSets.length);

let parsed = 0;
const settlements = [];
for (const ds of defSets) {
  let nameOff = -1;
  for (let step = -50; step <= 0; step++) {
    const c = ds - 18 + step;
    if (c < 0) continue;
    const r = readPstr16Utf16Extended(buf, c);
    if (r && r.totalLen === ds - c - 18) { nameOff = c; break; }
  }
  const headerStart = ds + 14;
  const tileX = buf.readUInt32LE(headerStart + 12);
  const tileY = buf.readUInt32LE(headerStart + 16);
  if (nameOff !== -1) {
    parsed++;
    settlements.push({ name: readPstr16Utf16Extended(buf, nameOff).str, defSet: ds, tileX, tileY });
  } else {
    settlements.push({ name: '<<UNPARSED 0x' + ds.toString(16) + '>>', defSet: ds, tileX, tileY });
  }
}
console.log('Parsed names: ' + parsed + ' / ' + defSets.length);

console.log('\n=== All settlements (sorted by file offset) ===');
for (const s of settlements) {
  console.log('  0x' + s.defSet.toString(16).padStart(6, '0') + '  (' + String(s.tileX).padStart(3) + ', ' + String(s.tileY).padStart(3) + ')  ' + s.name);
}

// Spain's 4 settlements verification
console.log('\n=== Spain expected vanilla settlements ===');
const SPAIN_EXPECTED = ['Carthago_Nova', 'Corduba', 'Numantia', 'Asturica'];
for (const name of SPAIN_EXPECTED) {
  const s = settlements.find(x => x.name === name);
  console.log('  ' + name + ': ' + (s ? '(' + s.tileX + ', ' + s.tileY + ') at 0x' + s.defSet.toString(16) : 'NOT FOUND'));
}

// Tile-X=253 settlements
console.log('\n=== Settlements at edge X=253 ===');
for (const s of settlements.filter(x => x.tileX === 253)) {
  console.log('  ' + s.name + ' (' + s.tileX + ', ' + s.tileY + ')');
}
