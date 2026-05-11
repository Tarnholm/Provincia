// Look for per-region resource records.
// MAP_REGIONS HST entry exists; might be encoded as 1305 per-region records each containing resource lists.

const fs = require('fs');
const buf = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav');
const res = JSON.parse(fs.readFileSync('C:/dev/Provincia/public/resources_large.json'));

const MAP_H = 700;
const resSet = new Map();
for (const region of Object.keys(res)) {
  for (const r of res[region]) {
    resSet.set(r.x + ',' + r.y, { region, type: r.type, amount: r.amount });
  }
}

// Body root @ 0xc4842 / 0x3b99 — let's walk the body root's direct children
// First, find a likely body root: a section with size huge (>5MB)
function readSection(off) {
  if (off < 0 || off + 8 > buf.length) return null;
  const sp = buf.readUInt32LE(off);
  if (sp !== off) return null;
  const sz = buf.readUInt32LE(off + 4);
  if (sz < 8 || off + sz > buf.length) return null;
  return { off, sz };
}

// Find largest section in 0..0x10000
let rootCand = null;
for (let i = 0x3000; i < 0x100000; i += 4) {
  const s = readSection(i);
  if (s && s.sz > 5000000) {
    rootCand = s;
    console.log('body root candidate: 0x' + s.off.toString(16), 'size:', s.sz);
    break;
  }
}

// Walk direct children of body root
if (rootCand) {
  const end = rootCand.off + rootCand.sz;
  let p = rootCand.off + 8;
  const children = [];
  while (p < end) {
    const c = readSection(p);
    if (!c) {
      p += 4;
      continue;
    }
    children.push(c);
    p = c.off + c.sz;
  }
  console.log('direct children of body root:', children.length);

  // For each child, count how many (X,Y) pairs in its payload match a known resource location
  console.log('children with resource (X,Y) matches:');
  const childHits = [];
  for (const child of children) {
    let hits = 0;
    const end = child.off + child.sz;
    for (let i = child.off + 8; i < end - 8; i += 4) {
      const x = buf.readUInt32LE(i);
      if (x < 1 || x > 1020) continue;
      const y = buf.readUInt32LE(i + 4);
      if (y < 1 || y > 700) continue;
      if (resSet.has(x + ',' + y) || resSet.has(x + ',' + (MAP_H - y))) hits++;
    }
    childHits.push({ ...child, hits });
  }
  childHits.sort((a,b) => b.hits - a.hits);
  console.log('top 30 children by resource-coord hits:');
  for (const c of childHits.slice(0, 30)) {
    console.log(' 0x' + c.off.toString(16), 'size:', c.sz, 'hits:', c.hits);
  }
}
