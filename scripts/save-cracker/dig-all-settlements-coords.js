// Final pass: scan ALL settlements in the save (not just within 0x90000)
// and dump every name + tile coord + building count.

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
    if (c < 0x20 || c > 0x7e) return null;
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
console.log('Total default_set markers in full save: ' + defSets.length);

const settlements = [];
let unnamed = 0;
for (const ds of defSets) {
  let nameOff = -1;
  for (let step = -20; step <= 0; step++) {
    const c = ds - 18 + step;
    if (c < 0) continue;
    const r = readPstr16Utf16(buf, c);
    if (r && r.totalLen === ds - c - 18) { nameOff = c; break; }
  }
  const headerStart = ds + 14;
  const tileX = buf.readUInt32LE(headerStart + 12);
  const tileY = buf.readUInt32LE(headerStart + 16);
  if (nameOff !== -1) {
    settlements.push({ name: readPstr16Utf16(buf, nameOff).str, defSet: ds, tileX, tileY });
  } else {
    unnamed++;
  }
}

console.log('\nNamed settlements: ' + settlements.length);
console.log('Unnamed (couldn\'t parse): ' + unnamed);
console.log('Total: ' + (settlements.length + unnamed));

console.log('\n=== All named settlements with tile coords (sorted by X) ===');
settlements.sort((a, b) => a.tileX - b.tileX);
for (const s of settlements) {
  console.log('  (' + String(s.tileX).padStart(3) + ', ' + String(s.tileY).padStart(3) + ')  ' + s.name);
}

// Per-X bins
console.log('\n=== Settlement geographic distribution ===');
console.log('X range: ' + Math.min(...settlements.map(s => s.tileX)) + '..' + Math.max(...settlements.map(s => s.tileX)));
console.log('Y range: ' + Math.min(...settlements.map(s => s.tileY)) + '..' + Math.max(...settlements.map(s => s.tileY)));
