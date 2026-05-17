// Discover what settlements exist in Alexander saves

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 1.sav'));

console.log('Save size: ' + buf.length);

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
console.log('First 5 offsets: ' + defSets.slice(0, 5).map(o => '0x' + o.toString(16)).join(', '));

// Walk back from each default_set to find settlement name
console.log('\n=== Discovered settlements ===');
let found = 0;
for (const ds of defSets.slice(0, 30)) {
  let nameOff = -1;
  for (let step = -50; step <= 0; step++) {
    const c = ds - 18 + step;
    if (c < 0) continue;
    const r = readPstr16Utf16(buf, c);
    if (r && r.totalLen === ds - c - 18) {
      nameOff = c;
      break;
    }
  }
  if (nameOff !== -1) {
    const name = readPstr16Utf16(buf, nameOff);
    console.log('  0x' + ds.toString(16) + ' settlement: "' + name.str + '"');
    found++;
  } else {
    console.log('  0x' + ds.toString(16) + ' NO NAME FOUND');
  }
}
console.log('\nNamed/Total: ' + found + '/' + defSets.slice(0, 30).length);

// Also try looking for UTF-16 "Pella" string directly
console.log('\n=== Direct UTF-16 search for "Pella" ===');
function findPstr16Utf16Str(buf, str) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(str.length, 0);
  const strBytes = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) strBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  const target = Buffer.concat([lenBuf, strBytes]);
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(target, p)) !== -1) {
    hits.push(p);
    p++;
  }
  return hits;
}
const pellaHits = findPstr16Utf16Str(buf, 'Pella');
console.log('Pella UTF-16 pstr16 hits: ' + pellaHits.length);
for (const p of pellaHits.slice(0, 5)) {
  console.log('  0x' + p.toString(16));
}
const spartaHits = findPstr16Utf16Str(buf, 'Sparta');
console.log('Sparta UTF-16 pstr16 hits: ' + spartaHits.length);
for (const p of spartaHits.slice(0, 5)) {
  console.log('  0x' + p.toString(16));
}
