// Session 65 final long-tail sweep.
// Dump first 64 bytes of each top-10 unknown range and group by leading 4-byte signature.

const fs = require('fs');
const path = process.argv[2] || 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(path);

const ranges = [
  [0x00f84632, 0x00f85f5c, 6442],
  [0x01f17f18, 0x01f18948, 2608],
  [0x01f170f5, 0x01f17b0f, 2586],
  [0x015fb87c, 0x015fc177, 2299],
  [0x015cfe7b, 0x015d0772, 2295],
  [0x015d088a, 0x015d1181, 2295],
  [0x015d1299, 0x015d1b90, 2295],
  [0x015d1ca8, 0x015d259f, 2295],
  [0x016091aa, 0x01609a9a, 2288],
  [0x015e72b9, 0x015e7ba2, 2281],
];

function hex(b, len) {
  let s = '';
  for (let i = 0; i < len && i < b.length; i++) s += b[i].toString(16).padStart(2, '0') + ' ';
  return s;
}

function ascii(b, len) {
  let s = '';
  for (let i = 0; i < len && i < b.length; i++) {
    const c = b[i];
    s += (c >= 32 && c < 127) ? String.fromCharCode(c) : '.';
  }
  return s;
}

const sigCount = new Map();
for (const [s, e, sz] of ranges) {
  const slice = buf.slice(s, Math.min(s + 64, e));
  const sig = buf.slice(s, s + 4).toString('hex');
  sigCount.set(sig, (sigCount.get(sig) || 0) + 1);
  console.log(`\n[0x${s.toString(16).padStart(8,'0')}..0x${e.toString(16).padStart(8,'0')}) sz=${sz}`);
  console.log(`  hex: ${hex(slice, 64)}`);
  console.log(`  asc: ${ascii(slice, 64)}`);

  // Also peek at the 8 bytes BEFORE the range to identify adjacent context
  const before = buf.slice(Math.max(0, s - 16), s);
  console.log(`  prv: ${hex(before, before.length)}`);
}

console.log('\n=== Signature groups ===');
for (const [sig, cnt] of [...sigCount.entries()].sort((a,b)=>b[1]-a[1])) {
  console.log(`  ${sig}: ${cnt}`);
}

// Also: count signatures across ALL unknown runs ≥1000 bytes from cover.js perspective.
// Re-derive claimed set via spans by recomputing approximately — for speed, just look at all
// 2200-2700 byte unknowns based on the bands we see (the 5 of size 2295 are suspicious).

// Look at ALL ~2295 byte chunks: print delta between consecutive starts.
const big2295 = [0x015cfe7b, 0x015d088a, 0x015d1299, 0x015d1ca8];
console.log('\n=== 2295-byte cluster deltas ===');
for (let i = 1; i < big2295.length; i++) {
  console.log(`  delta ${i}: ${(big2295[i] - big2295[i-1])}`);
}
