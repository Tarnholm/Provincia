// Explore the 4KB header zone 0x100..0x1190 (right after file header)
// Likely contains: game settings, player faction, year, season, weather, etc.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav') && f.includes('Spain'));

const T_FILES = {};
for (const f of allFiles) {
  for (const t of [1, 2, 3, 4]) {
    if (f.includes('Turn ' + t)) {
      if (!T_FILES[t]) T_FILES[t] = fs.readFileSync(path.join(BASE, f));
      break;
    }
  }
}

const buf = T_FILES[4];

function hex(buf, off, len) {
  return Array.from(buf.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

// 1. ASCII strings
console.log('=== ASCII strings in 0x100..0x1190 ===');
let p = 0x100;
let hits = 0;
while (p < 0x1190 && hits < 30) {
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
console.log('\n=== UTF-16 pstr16 strings in 0x100..0x1190 ===');
p = 0x100;
hits = 0;
while (p < 0x1190 && hits < 30) {
  if (p + 2 > buf.length) break;
  const slen = buf.readUInt16LE(p);
  if (slen < 3 || slen > 50) { p++; continue; }
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

// 3. Find u32 fields that change across T1→T4 (campaign state)
console.log('\n=== u32 fields changing across T1→T4 in 0x100..0x1190 ===');
const len = Math.min(...Object.values(T_FILES).map(b => b.length));
for (let off = 0x100; off < 0x1190 - 4; off += 4) {
  const vals = [1, 2, 3, 4].map(t => T_FILES[t].readInt32LE(off));
  if (new Set(vals).size === 1) continue;  // unchanging
  // Plausible values
  if (vals.some(v => Math.abs(v) > 10000000)) continue;
  console.log('  i32@0x' + off.toString(16) + ' T1..T4: [' + vals.join(', ') + ']');
}

// 4. Dump key region — first 256 bytes after header end
console.log('\n=== First 256 bytes of 0x100..0x200 ===');
for (let row = 0; row < 16; row++) {
  console.log('  0x' + (0x100 + row * 16).toString(16) + ': ' + hex(buf, 0x100 + row * 16, 16));
}

console.log('\n=== 0x400..0x500 (around year offset 0x514) ===');
for (let row = 0; row < 16; row++) {
  console.log('  0x' + (0x400 + row * 16).toString(16) + ': ' + hex(buf, 0x400 + row * 16, 16));
}

console.log('\n=== 0x1000..0x1190 (right before owner table) ===');
for (let row = 0; row < 25; row++) {
  console.log('  0x' + (0x1000 + row * 16).toString(16) + ': ' + hex(buf, 0x1000 + row * 16, 16));
}
