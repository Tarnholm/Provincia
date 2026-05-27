// dig-nearest-section.js — search the bytes IMMEDIATELY before record #50
// for the closest plausible section header. If sec[1] is pre-allocated
// (not actually iterated), there might be a smaller block header much
// closer to our splice point.
//
// Strategy:
//   1. Walk backward from SPLICE_FROM looking for any 8-byte window where
//      u32@p == p AND u32@p+4 is plausible size. Report all hits in
//      [SPLICE_FROM - 1MB .. SPLICE_FROM].
//   2. For each hit, check if the section extent contains SPLICE_FROM
//      (i.e., it's actually a parent).
//   3. Report only the SMALLEST containing sections.

"use strict";
const fs = require("fs");

const SRC = "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const SPLICE_FROM = 0x1896d92;
const SPLICE_BYTES = 462;
const buf = fs.readFileSync(SRC);

// All section-like headers in [SPLICE_FROM - 4MB, SPLICE_FROM].
const candidates = [];
const SCAN_FROM = Math.max(0, SPLICE_FROM - 0x400000);
for (let p = SCAN_FROM; p < SPLICE_FROM; p++) {
  const self = buf.readUInt32LE(p);
  if (self !== p) continue;
  const size = buf.readUInt32LE(p + 4);
  if (size < 16 || p + size > buf.length) continue;
  // Must extend past SPLICE_FROM to "contain" it.
  if (p + size <= SPLICE_FROM) continue;
  candidates.push({ off: p, size, end: p + size, sizeAfter: p + size - SPLICE_FROM });
}
console.log(`section-header candidates containing splice in last 4MB before splice: ${candidates.length}`);

// Sort by SIZE ascending — the smallest is likely the innermost real section.
candidates.sort((a, b) => a.size - b.size);

console.log();
console.log(`SMALLEST 20 (innermost-likely):`);
console.log(`offset      size        end         dist-to-splice   bytes-after-splice`);
console.log(`----------  ----------  ----------  ---------------  -----------------`);
for (const c of candidates.slice(0, 20)) {
  const dist = SPLICE_FROM - c.off;
  console.log(`0x${c.off.toString(16).padEnd(8)}  ${String(c.size).padStart(10)}  0x${c.end.toString(16).padEnd(8)}  ${String(dist).padStart(15)}  ${String(c.sizeAfter).padStart(17)}`);
}

// Of those, which are CLOSEST to the splice (smallest distance)?
console.log();
console.log(`CLOSEST 20 to splice (most-likely-innermost-real):`);
const closest = [...candidates].sort((a, b) => (SPLICE_FROM - a.off) - (SPLICE_FROM - b.off));
for (const c of closest.slice(0, 20)) {
  const dist = SPLICE_FROM - c.off;
  console.log(`0x${c.off.toString(16).padEnd(8)}  size=${String(c.size).padStart(10)}  dist=${String(dist).padStart(8)}  bytes-after=${c.sizeAfter}`);
}

// Bonus: also search for any "block header" pattern - i.e. 8 bytes where
// u32@p+4 = exact (SPLICE_FROM - p) + N for small N. If the engine uses
// "block_offset + block_size" instead of "self_offset + size", this would
// surface as a "size = distance to splice + small" pattern.
console.log();
console.log(`bonus: candidates where u32@p+4 is close to dist-to-splice (suggests"block_offset + block_size" form):`);
{
  let found = 0;
  for (let p = SCAN_FROM; p < SPLICE_FROM - 8; p++) {
    const a = buf.readUInt32LE(p);
    const s = buf.readUInt32LE(p + 4);
    const dist = SPLICE_FROM - p;
    // a might be a small offset, s might be the size that just exceeds dist
    if (s >= dist && s <= dist + 1024) {
      // and a should look like an offset/marker
      if (a > 0 && a < buf.length) {
        if (found < 10) console.log(`  @0x${p.toString(16)}  a=${a} (=0x${a.toString(16)})  s=${s}  dist=${dist}  (s-dist=${s-dist})`);
        found++;
      }
    }
  }
  console.log(`  total: ${found}`);
}
