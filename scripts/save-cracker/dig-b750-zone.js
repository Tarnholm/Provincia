// Explore the 5KB unmapped zone 0xb750-0xcff0 (between building coords and diplomatic table)

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

function hex(off, len) {
  return Array.from(buf.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

// 1. ASCII strings
console.log('=== ASCII strings in 0xb750..0xcff0 (4+ chars) ===');
let p = 0xb750;
let hits = 0;
while (p < 0xcff0 && hits < 40) {
  const c = buf[p];
  if (c < 0x20 || c > 0x7e) { p++; continue; }
  let q = p;
  while (q < buf.length && buf[q] >= 0x20 && buf[q] <= 0x7e) q++;
  const len = q - p;
  if (len >= 4) {
    const s = buf.slice(p, q).toString('latin1');
    if (/^[a-zA-Z][a-zA-Z_0-9 ]+$/.test(s)) {
      console.log('  0x' + p.toString(16) + ' (' + len + '): "' + s + '"');
      hits++;
    }
  }
  p = q + 1;
}

// 2. UTF-16 pstr16
console.log('\n=== UTF-16 pstr16 strings in 0xb750..0xcff0 ===');
p = 0xb750;
hits = 0;
while (p < 0xcff0 && hits < 40) {
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

// 3. Look at the structural data — sample first 256 bytes
console.log('\n=== First 512 bytes of 0xb750 ===');
for (let p = 0xb750; p < 0xb950; p += 16) {
  console.log('  0x' + p.toString(16) + ': ' + hex(p, 16));
}

// 4. Compute distinct u32 values and find clusters
console.log('\n=== u32 values in 100..10000 range in 0xb750..0xcff0 ===');
const candidates = [];
for (let off = 0xb750; off < 0xcff0; off += 4) {
  const v = buf.readUInt32LE(off);
  if (v < 100 || v > 10000) continue;
  candidates.push({ off, v });
}
console.log('Found ' + candidates.length + ' candidates');
// Show first 30
for (const c of candidates.slice(0, 30)) {
  console.log('  u32@0x' + c.off.toString(16) + ' = ' + c.v);
}
