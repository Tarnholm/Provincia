// Extract all region border polygons. The polygon zone extends beyond
// session 124's 0x7c20..0xaa00 — actually 0x7c20..0xcff0.
// Each polygon record has self-pointer + uuid + vertex_count + (x, y) pairs.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

// Polygon records have a self-pointer at the start.
// Scan the polygon zone 0x7c20..0xcff0 for u32 values that equal their own offset.
const polygons = [];
for (let off = 0x7c20; off < 0xcff0; off += 4) {
  const v = buf.readUInt32LE(off);
  if (v === off) {
    polygons.push({ off });
  }
}
console.log('Found ' + polygons.length + ' self-pointer records in 0x7c20..0xcff0');

// For each polygon record, decode the vertex count and (x, y) pairs
for (let i = 0; i < polygons.length; i++) {
  const p = polygons[i];
  // Format: u32 self + u32 uuid + u32 self+8 + u32 vertex_count + ... + vertices
  const uuid = buf.readUInt32LE(p.off + 4);
  const nextSelfPtr = buf.readUInt32LE(p.off + 8);
  const vertCount = buf.readUInt32LE(p.off + 12);
  p.uuid = uuid;
  p.vertCount = vertCount;
  // Try to find the vertex array start - it's usually after a small fixed header
  // Look for where (x, y) pairs that are in 0..255 range start
  // Skip 8-30 bytes after the count, then find the first u32 pair with both in 0..255
  for (let skip = 8; skip < 60; skip += 4) {
    const addr = p.off + 16 + skip;
    if (addr + 8 > buf.length) break;
    const x1 = buf.readUInt32LE(addr);
    const y1 = buf.readUInt32LE(addr + 4);
    const x2 = buf.readUInt32LE(addr + 8);
    const y2 = buf.readUInt32LE(addr + 12);
    if (x1 < 256 && y1 < 256 && x2 < 256 && y2 < 256 &&
        Math.abs(x1 - x2) <= 3 && Math.abs(y1 - y2) <= 3) {
      p.vertStart = addr;
      p.firstVertex = [x1, y1];
      break;
    }
  }
}

// Show summary
console.log('\n=== Polygon summary (first 20) ===');
console.log('offset       uuid         vertCount  firstVertex');
for (const p of polygons.slice(0, 20)) {
  console.log('  0x' + p.off.toString(16).padStart(5, '0') + '  0x' + p.uuid.toString(16).padStart(8, '0') +
    '   ' + String(p.vertCount).padStart(4) + '       ' +
    (p.firstVertex ? '(' + p.firstVertex[0] + ', ' + p.firstVertex[1] + ')' : 'NA'));
}

// Verify: extract Arretium's polygon (around 0xb820)
console.log('\n=== Polygon at 0xb820 (likely Arretium) — first 20 vertices ===');
const arret = polygons.find(p => p.off === 0xb81f || p.off === 0xb820);
if (arret && arret.vertStart) {
  for (let i = 0; i < 20 && i < arret.vertCount; i++) {
    const addr = arret.vertStart + i * 8;
    const x = buf.readUInt32LE(addr);
    const y = buf.readUInt32LE(addr + 4);
    console.log('  vertex ' + i + ': (' + x + ', ' + y + ')');
  }
}

// Histogram of vertex counts
const histo = {};
for (const p of polygons) {
  const range = Math.floor(p.vertCount / 10) * 10;
  histo[range] = (histo[range] || 0) + 1;
}
console.log('\n=== Vertex count histogram ===');
for (const [k, v] of Object.entries(histo).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
  console.log('  ' + k + '-' + (parseInt(k) + 9) + ': ' + v);
}

// Total polygons + cross-reference with 103 settlements
console.log('\nTotal self-pointer records (polygons): ' + polygons.length);
console.log('Total settlements (default_set markers): ~103');
console.log('Note: some self-pointers may be other record types, not all polygons.');
