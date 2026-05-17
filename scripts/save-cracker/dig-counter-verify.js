// Verify which u32 is the vanilla Rome event counter.
// Test candidates against multiple Spain saves to see which advances monotonically.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav') && f.includes('Spain'));
console.log('Spain saves:', allFiles.length);

// Read all Spain saves
const saves = [];
for (const f of allFiles) {
  saves.push({ name: f, buf: fs.readFileSync(path.join(BASE, f)) });
}

const CANDIDATES = [0xe68, 0x102c, 0x4940, 0x4ba0, 0x4ba8, 0x4408, 0x4b94, 0x4e40, 0x52f8, 0x53fc, 0x5410];

console.log('\nsave'.padEnd(60) + ' | ' + CANDIDATES.map(c => '0x' + c.toString(16)).join(' | '));
saves.sort((a, b) => fs.statSync(path.join(BASE, a.name)).mtimeMs - fs.statSync(path.join(BASE, b.name)).mtimeMs);
for (const s of saves) {
  const vals = CANDIDATES.map(c => {
    if (c + 4 > s.buf.length) return '-';
    return s.buf.readUInt32LE(c);
  });
  console.log(s.name.padEnd(60) + ' | ' + vals.map(v => String(v).padStart(8)).join(' | '));
}

// Also try reading u32 at every u32-aligned offset and find ones that
// monotonically advance across all saves (sorted by mtime).
console.log('\n=== Scan for monotonically-increasing u32 candidates across all saves ===');
const sortedSaves = saves;  // already sorted by mtime
const CHUNK_SIZE = 0x1000;
const MAX_CHECK = 0x10000;
let bestMatches = [];
for (let off = 0; off < MAX_CHECK; off += 4) {
  let ok = true;
  let monotonic = true;
  let prevV = -1;
  let firstV = -1;
  let lastV = -1;
  for (const s of sortedSaves) {
    if (off + 4 > s.buf.length) { ok = false; break; }
    const v = s.buf.readUInt32LE(off);
    if (v < 0 || v > 1e9) { ok = false; break; }  // exclude UUID-looking values
    if (firstV === -1) firstV = v;
    lastV = v;
    if (prevV !== -1 && v < prevV) { monotonic = false; break; }
    prevV = v;
  }
  if (ok && monotonic && lastV !== firstV && (lastV - firstV) < 1000000) {
    bestMatches.push({ off, first: firstV, last: lastV, delta: lastV - firstV });
  }
}
bestMatches.sort((a, b) => (a.last - a.first) - (b.last - b.first));
console.log('Monotonic candidates (first 30, sorted by total advance):');
for (const m of bestMatches.slice(0, 30)) {
  console.log('  u32@0x' + m.off.toString(16).padStart(5, '0') + '  first=' + m.first + '  last=' + m.last + '  Δ=' + m.delta);
}
console.log('\nLargest advances (last 10):');
for (const m of bestMatches.slice(-10)) {
  console.log('  u32@0x' + m.off.toString(16).padStart(5, '0') + '  first=' + m.first + '  last=' + m.last + '  Δ=' + m.delta);
}
