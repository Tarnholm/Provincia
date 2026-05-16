// Decode the CHARACTER_PATHS section at 0xa9000..0xf9000.
// Hypothesis: each path is a section with self-pointing header + character
// UUID + list of (X, Y) waypoint pairs.

const fs = require('fs');

const A = fs.readFileSync('C:\\Users\\vtarn\\Downloads\\save_halo_oneman.sav..sav');

// Find all self-pointer positions in the zone
const START = 0x000a9000;
const END = 0x000f9000;
const selfPtrs = [];
for (let p = START; p + 8 <= END; p++) {
  if (A.readUInt32LE(p) === p) selfPtrs.push(p);
}
console.log('Self-pointers in zone:', selfPtrs.length);

// Each path record starts with two self-pointers, like the major-record pattern:
// +0  u32 selfPtr  (= pos)
// +4  u32 hash/UUID
// +8  u32 selfPtr  (= pos+8)
// +12 u32 = recordSize?
// Then header data
// Then waypoint list

// Let me confirm by looking for {selfPtr, X, selfPtr at +8} pairs:
const pathStarts = [];
for (const p of selfPtrs) {
  // Check there's another selfPtr at p+8 (= p+8)
  if (p + 12 < A.length && A.readUInt32LE(p + 8) === p + 8) {
    pathStarts.push(p);
  }
}
console.log('Path starts (with self-pointer at +8):', pathStarts.length);

if (pathStarts.length > 0) {
  console.log('\nFirst 5 path-start headers (40 bytes each):');
  for (const p of pathStarts.slice(0, 5)) {
    console.log('\nPath at 0x' + p.toString(16) + ':');
    for (let o = 0; o < 64; o += 16) {
      const slice = A.subarray(p + o, p + o + 16);
      const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
      const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
      console.log('  +' + o.toString().padStart(2) + ': ' + hex + '  ' + asc);
    }
    // Read structured fields
    const u4 = A.readUInt32LE(p + 4);
    const u12 = A.readUInt32LE(p + 12);
    const u16 = A.readUInt32LE(p + 16);
    const u20 = A.readUInt32LE(p + 20);
    console.log('  u32@+4 = 0x' + u4.toString(16).padStart(8, '0') + ' (' + u4 + ')');
    console.log('  u32@+12 = 0x' + u12.toString(16).padStart(8, '0') + ' (' + u12 + ')');
    console.log('  u32@+16 = 0x' + u16.toString(16).padStart(8, '0') + ' (' + u16 + ')');
    console.log('  u32@+20 = 0x' + u20.toString(16).padStart(8, '0') + ' (' + u20 + ')');
  }
}

// What sizes do paths have? Compute deltas between consecutive starts.
const sizes = [];
for (let i = 1; i < pathStarts.length; i++) {
  sizes.push(pathStarts[i] - pathStarts[i - 1]);
}
console.log('\nPath-size distribution:');
const sizeHist = new Map();
for (const s of sizes) sizeHist.set(s, (sizeHist.get(s) || 0) + 1);
const sortedSizes = Array.from(sizeHist.entries()).sort((a, b) => a[0] - b[0]);
console.log('  size  count');
for (const [s, c] of sortedSizes.slice(0, 20)) console.log('  ' + String(s).padStart(4) + '  ' + c);
console.log('  ...');
for (const [s, c] of sortedSizes.slice(-5)) console.log('  ' + String(s).padStart(4) + '  ' + c);
console.log('  total path records:', pathStarts.length);
console.log('  min size:', Math.min(...sizes));
console.log('  max size:', Math.max(...sizes));

// Decode a few paths in full — extract the (x, y) waypoints
console.log('\n=== Decoded waypoints for first 3 paths ===');
for (let i = 0; i < 3 && i < pathStarts.length; i++) {
  const p = pathStarts[i];
  const next = pathStarts[i + 1] || END;
  const recSize = next - p;
  console.log('\nPath #' + i + ' at 0x' + p.toString(16) + ' size=' + recSize);

  // header_size = ? Try +24 onwards as waypoint list. Each waypoint = 8 bytes (u32 X, u32 Y)
  // Let me also try +32, +40 starts
  for (const headerSize of [24, 28, 32, 36, 40]) {
    const wpStart = p + headerSize;
    const wpEnd = p + recSize;
    if ((wpEnd - wpStart) % 8 !== 0) continue;
    const N = (wpEnd - wpStart) / 8;
    if (N < 2 || N > 100) continue;
    // Sanity: read first waypoint, check if x, y in reasonable map range
    const x0 = A.readUInt32LE(wpStart);
    const y0 = A.readUInt32LE(wpStart + 4);
    if (x0 < 0 || x0 > 1100 || y0 < 0 || y0 > 800) continue;
    console.log('  trying headerSize=' + headerSize + ', ' + N + ' waypoints');
    console.log('  first 10 waypoints:');
    for (let k = 0; k < Math.min(10, N); k++) {
      const x = A.readUInt32LE(wpStart + k * 8);
      const y = A.readUInt32LE(wpStart + k * 8 + 4);
      console.log('    (' + x + ', ' + y + ')');
    }
    break;
  }
}
