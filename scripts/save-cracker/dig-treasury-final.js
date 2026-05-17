// Narrow the 4 treasury candidates from session 120 by checking:
//   1. Are they part of a per-faction array (1 entry per faction, ~21 entries)?
//   2. Do they live inside a recognizable section?
//   3. Do they sum to a plausible total economy?

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav') && f.includes('Spain'));

const SAVES = [];
for (const f of allFiles) {
  const buf = fs.readFileSync(path.join(BASE, f));
  const year = buf.readInt32LE(0x514);
  SAVES.push({ name: f, buf, year, size: buf.length });
}
SAVES.sort((a, b) => a.size - b.size);

const CANDIDATES = [0xb6fc, 0xaa74, 0xb708, 0xb718];

function hex(buf, off, len) {
  return Array.from(buf.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

console.log('=== Bytes around each candidate (T4 Start save) ===');
const t4Start = SAVES.find(s => s.name.includes('Turn 4 Start')) || SAVES[3];
console.log('Using save: ' + t4Start.name);
for (const c of CANDIDATES) {
  console.log('\n--- candidate 0x' + c.toString(16) + ' ---');
  for (let row = -2; row <= 4; row++) {
    const addr = c + row * 16;
    if (addr < 0 || addr + 16 > t4Start.buf.length) continue;
    const marker = row === 0 ? '  ←' : '';
    console.log('  0x' + addr.toString(16) + ': ' + hex(t4Start.buf, addr, 16) + marker);
  }
}

// Check if these candidates are part of a fixed-stride array.
// If yes, candidates would appear at offset = base + index * stride.
// Common strides: 4 (u32 array), 8, 12, 16, 32 bytes.
console.log('\n=== Pattern matching: is candidate part of a u32 array? ===');
for (const c of CANDIDATES) {
  // Look 80 bytes before and after for similar-magnitude u32 values
  console.log('\n--- 0x' + c.toString(16) + ' centered (u32 values within 1 KB above/below) ---');
  const targetVal = t4Start.buf.readInt32LE(c);
  // Scan around for values in 0..50000 (plausible treasury range)
  const surroundingValid = [];
  for (let off = Math.max(0, c - 0x80); off <= c + 0x80; off += 4) {
    if (off + 4 > t4Start.buf.length) break;
    const v = t4Start.buf.readInt32LE(off);
    if (v >= 0 && v < 50000) {
      surroundingValid.push({ off, v });
    }
  }
  // Find the longest contiguous run of "valid" u32s in a row
  let bestRun = 0;
  let bestStart = c;
  let curRun = 0;
  let curStart = -1;
  for (let i = 0; i < surroundingValid.length; i++) {
    if (i > 0 && surroundingValid[i].off === surroundingValid[i-1].off + 4) {
      curRun++;
    } else {
      if (curRun > bestRun) { bestRun = curRun; bestStart = curStart; }
      curRun = 1;
      curStart = surroundingValid[i].off;
    }
  }
  if (curRun > bestRun) { bestRun = curRun; bestStart = curStart; }
  console.log('  Longest contiguous u32 array near candidate: ' + bestRun + ' values starting at 0x' + bestStart.toString(16));
  // Print the array
  for (let i = 0; i < bestRun && i < 25; i++) {
    const off = bestStart + i * 4;
    console.log('    u32@0x' + off.toString(16) + ': ' + t4Start.buf.readInt32LE(off) + (off === c ? '  ← CANDIDATE' : ''));
  }
}

// FACTION COUNT: vanilla Rome has 21 factions (20 playable + slave)
// If candidate is in a per-faction array, look for 20-21 plausible values around it
console.log('\n=== Check: read 20 consecutive u32s starting from various base offsets ===');
const arrayBases = [0xaa68, 0xaa70, 0xaa74, 0xb6e0, 0xb6f0, 0xb6fc, 0xb708, 0xb718];
for (const base of arrayBases) {
  process.stdout.write('  0x' + base.toString(16) + ' (×20): ');
  for (let i = 0; i < 20; i++) {
    const off = base + i * 4;
    if (off + 4 > t4Start.buf.length) break;
    process.stdout.write(t4Start.buf.readInt32LE(off) + ' ');
  }
  console.log();
}
