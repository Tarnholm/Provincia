// dig-zerofftrail-internal.js — Session 99/H
// The zero-ff-trailer-auto detector claims 1189 ranges totaling 2.4 MB.
// Each range ends with:
//   ... [64 00 00 00] [64 00 00 00] [10×0] [u32 hash] [ff ff ff ff]
// The body before that tail is zero/ff dominated, no ASCII.
// Decode internal record structure: byte distribution, run-length, max-zero-run.

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(SAVE);

// Replicate cover.js §15 detector to enumerate the ranges
const ZONE_START = 0x14e5ac6;
const ZONE_END = Math.min(0x1f1fc14, buf.length);

// We need the bitmap from previous claims to find unclaimed runs.
// Instead, just scan for the unique tail signature and walk back to find the
// start of each blob (where the preceding zero-run begins).
const ZERO_TAIL = Buffer.from([0x64,0,0,0, 0x64,0,0,0, 0,0,0,0, 0,0,0,0, 0,0]);
const positions = [];
let i = ZONE_START;
while (i < ZONE_END - 26) {
  const idx = buf.indexOf(ZERO_TAIL, i);
  if (idx < 0 || idx >= ZONE_END) break;
  // Verify final 4 bytes are FFFFFFFF (at idx + 18 + 4 hash = idx + 22)
  if (buf[idx+22]===0xff&&buf[idx+23]===0xff&&buf[idx+24]===0xff&&buf[idx+25]===0xff) {
    positions.push({ tail: idx, end: idx + 26 });
  }
  i = idx + 1;
}

console.log(`Found ${positions.length} zero-ff trailers`);

// Walk back from each tail to find the start of the blob (consecutive zeros + last non-zero before)
const sizes = [];
let lastEnd = ZONE_START;
for (const p of positions) {
  // The blob starts at lastEnd (assume contiguous). Compute body size.
  const size = p.end - lastEnd;
  if (size > 0 && size < 100000) sizes.push(size);
  lastEnd = p.end;
}

console.log(`\nBlob size distribution (gap between adjacent trailers):`);
sizes.sort((a, b) => a - b);
console.log(`  min: ${sizes[0]}, max: ${sizes[sizes.length-1]}, median: ${sizes[Math.floor(sizes.length/2)]}`);
const buckets = new Map();
for (const s of sizes) {
  const bucket = Math.floor(s / 100) * 100;
  buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
}
const topB = [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log('Top size buckets (100-byte bins):');
for (const [b, c] of topB) console.log(`  ${b}..${b+100}: ${c}`);

// Now look at the actual body of a small blob.  Take blob #0..#5.
console.log('\nSample blob content (first 6 trailers, body before tail):');
for (let k = 0; k < Math.min(6, positions.length); k++) {
  const p = positions[k];
  const start = k === 0 ? ZONE_START : positions[k - 1].end;
  const bodyLen = p.tail - start;
  if (bodyLen > 0 && bodyLen < 10000) {
    const body = buf.slice(start, p.tail);
    // Hash before tail = u32 at p.tail+18
    const hashU32 = buf.readUInt32LE(p.tail + 18);
    // Byte before tail
    const beforeTail = buf[p.tail - 1];
    // Body stats: zero count, ff count, other
    let zeros = 0, ffs = 0;
    for (const b of body) {
      if (b === 0) zeros++;
      else if (b === 0xff) ffs++;
    }
    console.log(`  trailer @0x${p.tail.toString(16)}  bodyLen=${bodyLen}  zeros=${zeros}(${(zeros/bodyLen*100).toFixed(0)}%)  ffs=${ffs}(${(ffs/bodyLen*100).toFixed(0)}%)  hash=0x${hashU32.toString(16)}  byte-before-tail=0x${beforeTail.toString(16)}`);
    // Show first 32 bytes and last 32 bytes of body
    console.log('    body start: ' + body.slice(0, 32).toString('hex'));
    console.log('    body end:   ' + body.slice(-32).toString('hex'));
  }
}
