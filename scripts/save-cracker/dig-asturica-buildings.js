// Debug: inspect exact bytes at Asturica's building list start in T1 save

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T1 = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Spain   Turn 1.sav'));

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

const defSets = findPstr16Asciiz(T1, 'default_set');

// Find Asturica
let asturicaDS = -1;
for (const ds of defSets) {
  // Look 18 bytes after ds for what's there
  // Or scan back for name
  for (let step = -50; step <= 0; step++) {
    const c = ds - 18 + step;
    if (c < 0) continue;
    const r = readPstr16Utf16(T1, c);
    if (r && r.totalLen === ds - c - 18 && r.str === 'Asturica') {
      asturicaDS = ds;
      break;
    }
  }
  if (asturicaDS !== -1) break;
}
console.log('Asturica default_set at 0x' + asturicaDS.toString(16));

function hex(off, len) {
  return Array.from(T1.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

// Dump bytes starting from default_set
console.log('\nBytes from default_set (0x' + asturicaDS.toString(16) + ') for 300 bytes:');
for (let p = asturicaDS; p < asturicaDS + 300; p += 16) {
  console.log('  0x' + p.toString(16) + ' (+' + (p - asturicaDS) + '): ' + hex(p, 16));
}

// Now walk buildings byte-by-byte, printing every pstr16-like string found
console.log('\nAll pstr16_asciiz strings found in 300 bytes after default_set:');
for (let p = asturicaDS + 14; p < asturicaDS + 1000; p++) {
  const r = readPstr16Asciiz(T1, p);
  if (r && r.str.length >= 4 && /^[a-z_]/.test(r.str)) {
    console.log('  0x' + p.toString(16) + ' (+' + (p - asturicaDS) + '): "' + r.str + '" (len=' + r.totalLen + ')');
  }
}
