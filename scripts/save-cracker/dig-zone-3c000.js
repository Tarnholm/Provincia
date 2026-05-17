// Examine the 2 KB zone 0x3c000..0x3e000 between settlements end and merc pools

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

function hex(off, len) {
  return Array.from(buf.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

// 1. ASCII strings
console.log('=== ASCII strings in 0x3c000..0x3e000 ===');
let p = 0x3c000;
let hits = 0;
while (p < 0x3e000 && hits < 40) {
  const c = buf[p];
  if (c < 0x20 || c > 0x7e) { p++; continue; }
  let q = p;
  while (q < buf.length && buf[q] >= 0x20 && buf[q] <= 0x7e) q++;
  const len = q - p;
  if (len >= 4) {
    const s = buf.slice(p, q).toString('latin1');
    if (/^[a-zA-Z]/.test(s)) {
      console.log('  0x' + p.toString(16) + ' (' + len + '): "' + s + '"');
      hits++;
    }
  }
  p = q + 1;
}

// 2. UTF-16 pstr16
console.log('\n=== UTF-16 pstr16 in 0x3c000..0x3e000 ===');
p = 0x3c000;
hits = 0;
while (p < 0x3e000 && hits < 30) {
  if (p + 2 > buf.length) break;
  const slen = buf.readUInt16LE(p);
  if (slen < 3 || slen > 30) { p++; continue; }
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
    if (/^[a-zA-Z]/.test(s)) {
      console.log('  0x' + p.toString(16) + ' pstr16(' + slen + '): "' + s + '"');
      hits++;
      p += 2 + slen * 2;
      continue;
    }
  }
  p++;
}

// 3. First 256 bytes
console.log('\n=== First 256 bytes of zone ===');
for (let p = 0x3c000; p < 0x3c100; p += 16) {
  console.log('  0x' + p.toString(16) + ': ' + hex(p, 16));
}

// 4. Last 256 bytes (before merc pools at 0x3e000)
console.log('\n=== Last 256 bytes before merc pools ===');
for (let p = 0x3df00; p < 0x3e000; p += 16) {
  console.log('  0x' + p.toString(16) + ': ' + hex(p, 16));
}
