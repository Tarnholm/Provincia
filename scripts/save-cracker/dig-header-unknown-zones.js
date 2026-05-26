// Decode the unknown header zones 0x60-0x500 and 0xde0-0x43f8.
// Find ALL pstr16 strings, identify u32 patterns, look for difficulty/settings.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const BASE_A = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const saves = [
  { name: 'PRE',       path: path.join(BASE_R, 'save_arretium pre retrained..sav') },
  { name: 'Spain-T1',  path: path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav') },
  { name: 'Alex-T1',   path: path.join(BASE_A, 'save_17-05-2026   Macedon   Turn 1.sav') },
];

const bufs = saves.map(s => ({ name: s.name, buf: fs.readFileSync(s.path) }));

// Just dump bytes 0x60..0x100 row-by-row for each save
console.log('=== 0x60..0x200 by 16-byte rows for each save ===');
for (const b of bufs) {
  console.log('\n--- ' + b.name + ' ---');
  for (let off = 0x60; off < 0x200; off += 16) {
    const hex = Array.from(b.buf.slice(off, off + 16)).map(x => x.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(b.buf.slice(off, off + 16)).map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('');
    console.log('0x' + off.toString(16) + ': ' + hex + '  |' + ascii + '|');
  }
}

// Find ALL pstr16 ASCII strings in 0x60..0x500 (might be settings keys, faction names, etc.)
function readPstr16Asciiz(buf, off) {
  if (off + 2 > buf.length) return null;
  const lenP1 = buf.readUInt16LE(off);
  if (lenP1 < 2 || lenP1 > 200) return null;
  if (off + 2 + lenP1 > buf.length) return null;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = buf[off + 2 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (buf[off + 2 + lenP1 - 1] !== 0) return null;
  return { str: buf.slice(off + 2, off + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
}

function readPstr16UTF16(buf, off) {
  if (off + 2 > buf.length) return null;
  const chars = buf.readUInt16LE(off);
  if (chars < 1 || chars > 200) return null;
  if (off + 2 + chars * 2 > buf.length) return null;
  let s = '';
  for (let i = 0; i < chars; i++) {
    const lo = buf[off + 2 + i * 2], hi = buf[off + 2 + i * 2 + 1];
    if (hi !== 0 || lo < 0x20 || lo > 0x7e) return null;
    s += String.fromCharCode(lo);
  }
  return { str: s, totalLen: 2 + chars * 2 };
}

console.log('\n\n=== All pstr16 strings in 0x60..0x500 ===');
for (const b of bufs) {
  console.log('\n--- ' + b.name + ' ---');
  let p = 0x60;
  while (p < 0x500 && p < b.buf.length - 4) {
    const a = readPstr16Asciiz(b.buf, p);
    const u = readPstr16UTF16(b.buf, p);
    if (a && a.str.length >= 4 && /^[a-zA-Z][a-zA-Z0-9_]+$/.test(a.str)) {
      console.log('  0x' + p.toString(16) + ' ASCIIZ "' + a.str + '"');
      p += a.totalLen;
      continue;
    }
    if (u && u.str.length >= 4 && /^[a-zA-Z][a-zA-Z0-9_ /.\\-]+$/.test(u.str)) {
      console.log('  0x' + p.toString(16) + ' UTF-16 "' + u.str + '"');
      p += u.totalLen;
      continue;
    }
    p++;
  }
}

// Find ALL strings in 0xde0..0x44e0 (between section registry and mod path region)
console.log('\n\n=== All pstr16 strings in 0xde0..0x4500 ===');
for (const b of bufs) {
  console.log('\n--- ' + b.name + ' ---');
  let p = 0xde0;
  let found = 0;
  while (p < 0x4500 && p < b.buf.length - 4 && found < 30) {
    const a = readPstr16Asciiz(b.buf, p);
    const u = readPstr16UTF16(b.buf, p);
    if (a && a.str.length >= 4 && /^[a-zA-Z][a-zA-Z0-9_]+$/.test(a.str)) {
      console.log('  0x' + p.toString(16) + ' ASCIIZ "' + a.str + '"');
      p += a.totalLen;
      found++;
      continue;
    }
    if (u && u.str.length >= 4 && /^[a-zA-Z][a-zA-Z0-9_ /.\\-]+$/.test(u.str)) {
      console.log('  0x' + p.toString(16) + ' UTF-16 "' + u.str + '"');
      p += u.totalLen;
      found++;
      continue;
    }
    p++;
  }
}
