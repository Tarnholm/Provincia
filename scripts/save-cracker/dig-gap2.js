// dig-gap2.js — Density, zero-padding, and entropy map of the 9.33MB gap.
// No self-pointers → it's a flat or differently-structured blob. Map by content type.

const fs = require('fs');
const path = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(path);

const START = 0x633bb3;
const END   = 0xf88637;

// Walk in 4KB pages; for each page compute:
//  - zero-byte ratio
//  - 0xff-byte ratio
//  - distinct byte count (rough entropy)
//  - printable-ASCII ratio
//  - UTF-16LE-printable ratio (every-other byte is 0 and other is printable)

const PAGE = 4096;
const pages = [];
for (let p = START; p < END; p += PAGE) {
  const len = Math.min(PAGE, END - p);
  let zeros = 0, ffs = 0, ascii = 0, utf16 = 0;
  const seen = new Set();
  for (let i = 0; i < len; i++) {
    const b = buf[p+i];
    seen.add(b);
    if (b === 0) zeros++;
    if (b === 0xff) ffs++;
    if (b >= 32 && b <= 126) ascii++;
  }
  // UTF-16LE: scan pairs (lo, hi). printable if lo in 32..126 and hi === 0
  for (let i = 0; i + 1 < len; i += 2) {
    if (buf[p+i] >= 32 && buf[p+i] <= 126 && buf[p+i+1] === 0) utf16 += 2;
  }
  pages.push({
    pos: p,
    len,
    z: zeros / len,
    f: ffs / len,
    e: seen.size,
    a: ascii / len,
    u: utf16 / len,
  });
}

console.log(`Scanned ${pages.length} pages of 4KB each.`);
// classify
function classify(p) {
  if (p.z > 0.95) return 'ZERO';
  if (p.f > 0.95) return 'FF';
  if (p.a > 0.7 && p.e > 20) return 'ASCII';
  if (p.u > 0.4 && p.e > 10) return 'UTF16';
  if (p.e < 10) return 'LOWENT';
  if (p.e > 100) return 'HIENT';
  return 'MIXED';
}

const klasses = pages.map(classify);

// Run-length encode classification
const runs = [];
let cur = { kind: klasses[0], from: pages[0].pos, to: pages[0].pos + pages[0].len };
for (let i = 1; i < pages.length; i++) {
  if (klasses[i] === cur.kind) {
    cur.to = pages[i].pos + pages[i].len;
  } else {
    runs.push(cur);
    cur = { kind: klasses[i], from: pages[i].pos, to: pages[i].pos + pages[i].len };
  }
}
runs.push(cur);

console.log(`\n=== ${runs.length} content-class runs in the gap ===`);
for (const r of runs) {
  const sz = r.to - r.from;
  console.log(`${r.kind.padEnd(7)} 0x${r.from.toString(16).padStart(8,'0')}..0x${r.to.toString(16).padStart(8,'0')}  size=${(sz).toString().padStart(9)} (${(sz/1024).toFixed(1)}KB)`);
}

// Summary by class
const sum = {};
for (const r of runs) {
  const sz = r.to - r.from;
  sum[r.kind] = (sum[r.kind] || 0) + sz;
}
console.log(`\n=== bytes per class ===`);
Object.keys(sum).sort((a,b)=>sum[b]-sum[a]).forEach(k => {
  const sz = sum[k];
  console.log(`  ${k.padEnd(7)} ${sz.toString().padStart(9)} bytes  (${(sz/1024/1024).toFixed(2)} MB)  ${(sz/(END-START)*100).toFixed(1)}%`);
});

fs.writeFileSync(__dirname + '/gap-pagemap.json', JSON.stringify({ pages, runs }, null, 2));
