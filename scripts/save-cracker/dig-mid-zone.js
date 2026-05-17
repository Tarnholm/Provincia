// Explore the 120 KB unmapped zone 0x1943f..0x37000

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

function hex(off, len) {
  return Array.from(buf.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

// 1. ASCII strings
console.log('=== ASCII strings in 0x1943f..0x37000 (6+ chars) ===');
let p = 0x1943f;
let hits = 0;
while (p < 0x37000 && hits < 80) {
  const c = buf[p];
  if (c < 0x20 || c > 0x7e) { p++; continue; }
  let q = p;
  while (q < buf.length && buf[q] >= 0x20 && buf[q] <= 0x7e) q++;
  const len = q - p;
  if (len >= 6) {
    const s = buf.slice(p, q).toString('latin1');
    if (/^[a-zA-Z][a-zA-Z_0-9 ]+$/.test(s)) {
      console.log('  0x' + p.toString(16) + ' (' + len + '): "' + s + '"');
      hits++;
    }
  }
  p = q + 1;
}

// 2. UTF-16 strings
console.log('\n=== UTF-16 pstr16 strings in 0x1943f..0x37000 (4+ chars) ===');
p = 0x1943f;
hits = 0;
while (p < 0x37000 && hits < 60) {
  if (p + 2 > buf.length) break;
  const slen = buf.readUInt16LE(p);
  if (slen < 4 || slen > 30) { p++; continue; }
  if (p + 2 + slen * 2 > buf.length) { p++; continue; }
  let allPrintable = true;
  const chars = [];
  for (let i = 0; i < slen; i++) {
    const c = buf.readUInt16LE(p + 2 + i * 2);
    if (c < 0x20 || c > 0x7e) { allPrintable = false; break; }
    chars.push(String.fromCharCode(c));
  }
  if (allPrintable) {
    const s = chars.join('');
    if (/^[a-zA-Z]/.test(s) && /[a-zA-Z]{2,}/.test(s)) {
      console.log('  0x' + p.toString(16) + ' pstr16(' + slen + '): "' + s + '"');
      hits++;
      p += 2 + slen * 2;
      continue;
    }
  }
  p++;
}

// 3. Section tags 0x15
console.log('\n=== 0x15 00 00 00 section tags in 0x1943f..0x37000 ===');
const sectionTag = Buffer.from([0x15, 0x00, 0x00, 0x00]);
hits = 0;
let pos = 0x1943f;
while ((pos = buf.indexOf(sectionTag, pos)) !== -1 && pos < 0x37000 && hits < 40) {
  console.log('  0x' + pos.toString(16));
  hits++;
  pos += 4;
}

// 4. Look at structural patterns — first 256 bytes
console.log('\n=== First 256 bytes of zone ===');
for (let p = 0x1943f; p < 0x1953f; p += 16) {
  console.log('  0x' + p.toString(16) + ': ' + hex(p, 16));
}
