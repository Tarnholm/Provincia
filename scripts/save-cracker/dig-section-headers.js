// Scan the whole file for `{u32 self_ptr == pos, u32 size}` section headers.
// FACTION records (34 instances) should appear as a cluster of self-pointer
// records with consistent size.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

// Find all u32 positions where u32 at pos == pos (self-pointer)
const selfPtrs = [];
for (let off = 0x100; off < buf.length - 8; off += 1) {  // any byte alignment
  const v = buf.readUInt32LE(off);
  if (v === off) {
    const size = buf.readUInt32LE(off + 4);
    if (size > 50 && size < 50000) {  // plausible section size
      selfPtrs.push({ off, size });
    }
  }
}
console.log('Total self-pointer records (size 50..50000): ' + selfPtrs.length);

// Group by size range to find clusters of 34
const sizeBuckets = {};
for (const sp of selfPtrs) {
  const bucket = Math.floor(sp.size / 50) * 50;
  if (!sizeBuckets[bucket]) sizeBuckets[bucket] = [];
  sizeBuckets[bucket].push(sp);
}

// Find buckets with ~34 entries (FACTION count)
console.log('\n=== Size buckets with 20-50 entries (FACTION candidates) ===');
for (const [bucket, items] of Object.entries(sizeBuckets).sort((a, b) => b[1].length - a[1].length)) {
  if (items.length >= 20 && items.length <= 50) {
    console.log('  size ~' + bucket + ': ' + items.length + ' entries. First few: ' +
      items.slice(0, 4).map(s => '0x' + s.off.toString(16) + '(sz=' + s.size + ')').join(', '));
  }
}

// Also look for clusters by file region
console.log('\n=== File-region buckets (10 KB chunks) ===');
const regionBuckets = {};
for (const sp of selfPtrs) {
  const bucket = Math.floor(sp.off / 0x2800) * 0x2800;
  if (!regionBuckets[bucket]) regionBuckets[bucket] = [];
  regionBuckets[bucket].push(sp);
}
for (const [bucket, items] of Object.entries(regionBuckets).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
  if (items.length > 5) {
    console.log('  region 0x' + parseInt(bucket).toString(16) + ': ' + items.length + ' records. Avg size: ' +
      (items.reduce((a, b) => a + b.size, 0) / items.length).toFixed(0));
  }
}

// Print first 50 self-pointers sorted by offset
console.log('\n=== First 50 self-pointer records ===');
selfPtrs.sort((a, b) => a.off - b.off);
for (const sp of selfPtrs.slice(0, 50)) {
  console.log('  0x' + sp.off.toString(16).padStart(5, '0') + '  size=' + sp.size);
}
