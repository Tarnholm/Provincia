// Find sections in body. Section grammar: [u32 selfPtr][u32 size][payload]
// Find all self-pointing sections in the file

const fs = require('fs');
const buf = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav');

// Identify body root - largest section after HST
const HST_END = 0x3a00;
let bodyRoot = null;
for (let i = HST_END; i < 0x100000; i += 4) {
  if (i + 8 > buf.length) break;
  const sp = buf.readUInt32LE(i);
  if (sp !== i) continue;
  const sz = buf.readUInt32LE(i + 4);
  if (sz < 1000000 || i + sz > buf.length) continue;
  // body root candidate
  bodyRoot = { off: i, sz };
  console.log('candidate root: 0x' + i.toString(16), 'size:', sz, 'ends at 0x' + (i+sz).toString(16));
  break;
}

// Walk direct children
const root = bodyRoot;
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

// Group by approximate size and dump first 50
console.log('first 50 children:');
for (let i = 0; i < Math.min(50, children.length); i++) {
  const c = children[i];
  // peek at first 16 bytes of payload
  const peek = buf.slice(c.off + 8, c.off + 24).toString('hex');
  console.log(' [' + i + '] 0x' + c.off.toString(16), 'size:', c.sz.toString().padStart(10), 'peek:', peek);
}

console.log('\nSize histogram of children:');
const sizeBuckets = {};
for (const c of children) {
  const exp = Math.floor(Math.log2(c.sz));
  sizeBuckets[exp] = (sizeBuckets[exp] || 0) + 1;
}
const sks = Object.keys(sizeBuckets).map(Number).sort((a,b) => a-b);
for (const k of sks) console.log(' 2^' + k + ' (' + (1<<k) + 'B):', sizeBuckets[k]);

// Look for "interesting" children - ones with payload starting with familiar tokens
console.log('\nChildren starting with each character index:');
const firstU32s = {};
for (const c of children) {
  if (c.off + 12 > buf.length) continue;
  const u = buf.readUInt32LE(c.off + 8);
  const key = u & 0xff;
  firstU32s[key] = (firstU32s[key] || 0) + 1;
}
// Sort by count
const sortedTags = Object.entries(firstU32s).sort((a,b) => b[1] - a[1]).slice(0, 20);
console.log('top 20 first-byte tags:');
for (const [k, c] of sortedTags) console.log(' tag 0x' + parseInt(k).toString(16).padStart(2,'0'), 'count:', c);
