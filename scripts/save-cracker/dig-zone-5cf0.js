// Check the 8 KB unmapped zone 0x5cf0..0x7b88 — could contain 34 FACTION records.

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

// 1. Dump first 256 bytes of zone
console.log('=== 0x5cf0..0x5df0 (start of zone) ===');
for (let p = 0x5cf0; p < 0x5df0; p += 16) {
  console.log('  0x' + p.toString(16) + ': ' + hex(buf, p, 16));
}

// 2. Look for u32 patterns that could be record markers
// 34 records × ~240 bytes = expect a stride of ~240
const zoneSize = 0x7b88 - 0x5cf0;
const ideal = zoneSize / 34;
console.log('\nZone size: ' + zoneSize + ' bytes, ideal stride for 34 records: ' + ideal.toFixed(1));

// 3. Look for treasury-like values varying across turns
console.log('\n=== u32 fields varying T1→T4 with plausible treasury values (1000-50000) ===');
const len = Math.min(...Object.values(T_FILES).map(b => b.length));
let found = 0;
for (let off = 0x5cf0; off < 0x7b88 - 4; off += 4) {
  const vals = [1, 2, 3, 4].map(t => T_FILES[t].readInt32LE(off));
  if (new Set(vals).size === 1) continue;
  // Skip fixed-point (×256 multiples)
  if (vals.every(v => v % 256 === 0)) continue;
  // Plausible treasury range
  if (vals.some(v => v < 0 || v > 50000)) continue;
  console.log('  i32@0x' + off.toString(16) + ' T1..T4: [' + vals.join(', ') + ']');
  found++;
  if (found > 30) break;
}

// 4. Also try u32 large range (treasury could go above 30k)
console.log('\n=== Same but u32 0..100000 ===');
found = 0;
for (let off = 0x5cf0; off < 0x7b88 - 4; off += 4) {
  const vals = [1, 2, 3, 4].map(t => T_FILES[t].readUInt32LE(off));
  if (new Set(vals).size === 1) continue;
  if (vals.every(v => v % 256 === 0)) continue;
  if (vals.some(v => v > 100000)) continue;
  console.log('  u32@0x' + off.toString(16) + ' T1..T4: [' + vals.join(', ') + ']');
  found++;
  if (found > 30) break;
}

// 5. Look for ASCII strings in zone
console.log('\n=== ASCII strings in zone ===');
let p = 0x5cf0;
let h = 0;
while (p < 0x7b88 && h < 30) {
  const c = buf[p];
  if (c < 0x20 || c > 0x7e) { p++; continue; }
  let q = p;
  while (q < buf.length && buf[q] >= 0x20 && buf[q] <= 0x7e) q++;
  const slen = q - p;
  if (slen >= 4) {
    const s = buf.slice(p, q).toString('latin1');
    if (/^[a-zA-Z][a-zA-Z_0-9 ]+$/.test(s)) {
      console.log('  0x' + p.toString(16) + ' (' + slen + '): "' + s + '"');
      h++;
    }
  }
  p = q + 1;
}
