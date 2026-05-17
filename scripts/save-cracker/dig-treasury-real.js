// Re-hunt treasury knowing now that the 4 prior candidates were building-coord
// arrays. Spain starts vanilla with ~5000-10000 denarii. Look for stand-alone
// u32 values (NOT part of a coord/array) that:
//   - Are in 1000-30000 range across all saves
//   - Vary monotonically (income each turn adds ~1500-3000)
//   - Are isolated (not in a contiguous array of similar values)

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

// 1. Get an isolated u32 = one that is NOT surrounded by similar-magnitude values
//    (treasury sits alone in a faction record, not in an array of coordinates)
const len = Math.min(...SAVES.map(s => s.buf.length));
const candidates = [];
for (let off = 0x1000; off < 0x40000; off += 4) {
  if (off + 4 > len) break;
  const vals = SAVES.map(s => s.buf.readInt32LE(off));
  if (vals.some(v => v < 1000 || v > 30000)) continue;
  // Must vary
  if (new Set(vals).size === 1) continue;
  // Check ISOLATION: neighbors should be vastly different magnitude
  const neighbors = [];
  for (const delta of [-12, -8, -4, 4, 8, 12]) {
    if (off + delta >= 0 && off + delta + 4 <= len) {
      neighbors.push(SAVES[0].buf.readInt32LE(off + delta));
    }
  }
  // Treasury should NOT have neighbors in the same range (1000-30000)
  const neighborSimilar = neighbors.filter(n => n >= 1000 && n <= 30000).length;
  if (neighborSimilar > 2) continue;  // Too many similar neighbors — looks like an array
  // Treasury should MOSTLY INCREASE over time (Spain accumulates money)
  // count monotonic-increasing pairs vs decreasing
  let inc = 0, dec = 0;
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] > vals[i-1]) inc++;
    else if (vals[i] < vals[i-1]) dec++;
  }
  if (inc < dec) continue;  // Discard mostly-decreasing
  candidates.push({ off, vals, neighborSimilar, inc, dec });
}

console.log('=== Isolated u32 treasury candidates ===');
console.log('Found ' + candidates.length + ' isolated candidates');

// Sort by spread (treasury growth should be MODEST, not 10×)
candidates.sort((a, b) => {
  const spreadA = Math.max(...a.vals) - Math.min(...a.vals);
  const spreadB = Math.max(...b.vals) - Math.min(...b.vals);
  return spreadA - spreadB;
});

console.log('\n=== Top 30 with smallest spreads (smooth treasury growth) ===');
for (const c of candidates.slice(0, 30)) {
  console.log('  u32@0x' + c.off.toString(16) + ' nbrs=' + c.neighborSimilar + ' inc=' + c.inc + ' dec=' + c.dec + ': [' + c.vals.join(', ') + ']');
}

// Also: check 0xaa74 (the false positive from session 120) more carefully
// It's actually building-coord data. Verify by reading u32 stride.
console.log('\n=== False-positive confirmation: 0xaa74 is building coords ===');
const t4Start = SAVES.find(s => s.name.includes('Turn 4 Start')) || SAVES[3];
console.log('At 0xaa74, alternating u32s look like (x, y) pairs of building positions:');
for (let i = 0; i < 10; i++) {
  const x = t4Start.buf.readUInt32LE(0xaa74 + i * 8);
  const y = t4Start.buf.readUInt32LE(0xaa74 + i * 8 + 4);
  console.log('  (x=' + x + ', y=' + y + ')  ÷256: (' + (x/256).toFixed(2) + ', ' + (y/256).toFixed(2) + ')');
}
