// Search the 38 KB gap 0x14a0..0xaa00 for per-faction records.
// Each faction record should contain: faction name (ASCII), treasury, AI state.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

const RANGE_START = 0x14a0;
const RANGE_END = 0xaa00;

// 1. ASCII string scan within the range
console.log('=== ASCII strings (4+ chars) in 0x14a0..0xaa00 ===');
let p = RANGE_START;
let hits = 0;
while (p < RANGE_END && hits < 100) {
  // Find a printable ASCII char
  const c = peace[p];
  if (c < 0x20 || c > 0x7e) { p++; continue; }
  // Find length of contiguous printable
  let q = p;
  while (q < RANGE_END && peace[q] >= 0x20 && peace[q] <= 0x7e) q++;
  const len = q - p;
  if (len >= 4) {
    const s = peace.slice(p, q).toString('latin1');
    if (/^[a-zA-Z][a-zA-Z_0-9 ]+$/.test(s)) {
      console.log('  0x' + p.toString(16).padStart(5, '0') + ' (' + len + '): "' + s + '"');
      hits++;
    }
  }
  p = q + 1;
}

// 2. UTF-16 string scan
console.log('\n=== UTF-16 strings (4+ chars) in 0x14a0..0xaa00 ===');
p = RANGE_START;
hits = 0;
while (p < RANGE_END && hits < 50) {
  // Try to read u16 pstr16 length prefix
  if (p + 2 > peace.length) break;
  const len = peace.readUInt16LE(p);
  if (len < 4 || len > 30) { p++; continue; }
  if (p + 2 + len * 2 > peace.length) { p++; continue; }
  let allPrintable = true;
  const chars = [];
  for (let i = 0; i < len; i++) {
    const c = peace.readUInt16LE(p + 2 + i * 2);
    if (c < 0x20 || c > 0x7e) { allPrintable = false; break; }
    chars.push(String.fromCharCode(c));
  }
  if (allPrintable) {
    const s = chars.join('');
    if (/^[a-zA-Z][a-zA-Z_0-9 ]+$/.test(s)) {
      console.log('  0x' + p.toString(16).padStart(5, '0') + ' pstr16(' + len + '): "' + s + '"');
      hits++;
      p += 2 + len * 2;
      continue;
    }
  }
  p++;
}

// 3. Look for big "round" u32 values in 1000-100000 that could be treasury/income
console.log('\n=== Plausible-treasury u32s in 0x14a0..0xaa00 ===');
for (let off = RANGE_START; off < RANGE_END - 4; off += 4) {
  const v = peace.readUInt32LE(off);
  if (v < 1000 || v > 100000) continue;
  if (v % 256 === 0) continue;  // skip fixed-point coords
  // Check it's surrounded by zeros or small values (isolated treasury field)
  let neighborZeros = 0;
  for (const d of [-8, -4, 4, 8]) {
    if (off + d >= 0 && off + d + 4 <= peace.length) {
      if (peace.readUInt32LE(off + d) === 0) neighborZeros++;
    }
  }
  if (neighborZeros >= 2) {
    console.log('  u32@0x' + off.toString(16) + ' = ' + v + '  (' + neighborZeros + ' zero neighbors)');
  }
}
