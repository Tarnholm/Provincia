// Dig deeper: body root has 161 children. Are they all character paths?
// Find which children are NOT character_paths-shaped (CHARACTER_PATHS records all have small payloads with (x,y) pairs).
// Look at unique payload signatures, especially the BIG ones.

const fs = require('fs');
const buf = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav');

// Try body root again - but actually session 18 said root at 0x3b99 size 6.49MB
// Let me try that
let root = { off: 0x3b99, sz: buf.readUInt32LE(0x3b99 + 4) };
console.log('reading 0x3b99 size word:', root.sz);
const rootSP = buf.readUInt32LE(0x3b99);
console.log('selfptr at 0x3b99:', rootSP);
if (rootSP !== 0x3b99) {
  console.log('0x3b99 is not a self-pointer; trying others');
  // Search for big section after HST
  for (let i = 0x3a00; i < 0x10000; i += 1) {
    const sp = buf.readUInt32LE(i);
    if (sp === i) {
      const sz = buf.readUInt32LE(i + 4);
      if (sz > 1000000 && i + sz <= buf.length) {
        root = { off: i, sz };
        console.log('found root: 0x' + i.toString(16), 'size:', sz);
        break;
      }
    }
  }
}

const rootEnd = root.off + root.sz;
let p = root.off + 8;
const children = [];
while (p + 8 <= rootEnd) {
  const sp = buf.readUInt32LE(p);
  if (sp !== p) { p += 4; continue; }
  const sz = buf.readUInt32LE(p + 4);
  if (sz < 8 || p + sz > rootEnd) { p += 4; continue; }
  children.push({ off: p, sz });
  p += sz;
}
console.log('direct children of body root:', children.length);

// Look at BIG children
const big = children.filter(c => c.sz > 100000).sort((a,b) => b.sz - a.sz);
console.log('\nbig children (>100KB):');
for (const c of big.slice(0, 20)) {
  console.log(' 0x' + c.off.toString(16), 'size:', c.sz.toString().padStart(10), 'ends 0x' + (c.off+c.sz).toString(16), 'peek:', buf.slice(c.off+8, c.off+32).toString('hex'));
}

// Histogram size distribution
const buckets = {};
for (const c of children) {
  const exp = Math.floor(Math.log10(c.sz + 1));
  buckets[exp] = (buckets[exp] || 0) + 1;
}
console.log('\nsize distribution (log10):');
for (const k of Object.keys(buckets).sort((a,b) => a-b)) {
  console.log(' 10^' + k + ':', buckets[k]);
}
