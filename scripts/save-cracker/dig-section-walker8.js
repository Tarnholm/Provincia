// dig-section-walker8.js — FINAL section walker for session 12.
//
// Confirmed file structure (rome10):
//   Header + HST: 0x0..0x3b97 (~15KB)
//   Body root: 0x3b99 (6.5MB) — section with self-pointer invariant; 287 direct children
//   Gap: 0x633bb3..0xf88637 (9.8MB) — mostly zeros, sparse small-int arrays
//        (no self-pointing sections; treat as flat data)
//   Settlement zone: 0xf88637 (16MB) — contains 1300+ UTF-16LE-named settlement
//        records; sections found are FALSE positives (no clean self-pointer grammar
//        inside this region — settlement records are positional, not section-tagged).
//   File tail: 0x1f10c72..0x21153ae (~6.3MB) — likely save trailer.
//
// Output: a CSV-style summary of every confirmed structural section.

const fs = require("fs");
const path = require("path");

const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);
console.log(`# File: ${path.basename(SAVE)} (${buf.length} bytes)\n`);

function isSection(p, maxEnd) {
  if (p + 8 > maxEnd) return false;
  if (buf.readUInt32LE(p) !== p) return false;
  const sz = buf.readUInt32LE(p + 4);
  if (sz < 16 || p + sz > maxEnd) return false;
  return true;
}
function walkSequential(start, end, max = 100000) {
  const found = [];
  for (let p = start; p + 8 <= end; p += 4) {
    if (!isSection(p, end)) continue;
    found.push({ off: p, size: buf.readUInt32LE(p + 4) });
  }
  found.sort((a, b) => a.off - b.off || b.size - a.size);
  const accepted = [];
  let lastEnd = start;
  for (const s of found) {
    if (s.off < lastEnd) continue;
    accepted.push(s);
    lastEnd = s.off + s.size;
    if (accepted.length >= max) break;
  }
  return accepted;
}

const bodyRoot = { off: 0x3b99, size: buf.readUInt32LE(0x3b99 + 4) };
const kids = walkSequential(bodyRoot.off + 8, bodyRoot.off + bodyRoot.size);
console.log(`Body root: 0x${bodyRoot.off.toString(16)} size=${bodyRoot.size}`);
console.log(`Body root direct children: ${kids.length}`);

// Find all distinct trailing 4-byte signatures right BEFORE each child's start
// (this is the "boundary marker" that often distinguishes section types).
const sigCount = {};
for (const k of kids) {
  if (k.off < 32) continue;
  const sig = buf.readUInt32LE(k.off - 4).toString(16);
  sigCount[sig] = (sigCount[sig] || 0) + 1;
}
console.log(`\nPre-child 4-byte signatures (top 5):`);
for (const [s, n] of Object.entries(sigCount).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
  console.log(`  ${s}: ${n}`);
}

// Print first 20 children with size and inferred type
console.log(`\nFirst 20 body root children:`);
for (let i = 0; i < 20 && i < kids.length; i++) {
  const k = kids[i];
  const payload = buf.slice(k.off + 8, Math.min(k.off + k.size, k.off + 100));
  // First u32 of payload (often the "owner faction id" or similar)
  const u32a = payload.readUInt32LE(0);
  const u32b = payload.length >= 8 ? payload.readUInt32LE(4) : -1;
  const u32c = payload.length >= 12 ? payload.readUInt32LE(8) : -1;
  console.log(`  [${i}] @0x${k.off.toString(16)} sz=${String(k.size).padStart(5)} u32_payload[0..2]=${u32a},${u32b},${u32c}`);
}

// Coord-pair signature check: count u32 pairs in (1..1500,1..1500) range
console.log(`\nCoord-pair analysis (for kids 1..286):`);
let coordCount = 0;
let totalCount = 0;
for (let i = 1; i < kids.length; i++) {
  const k = kids[i];
  const ps = k.off + 24;  // start of pair stream (after self,size,size,count,X,Y header)
  const pe = k.off + k.size - 8;
  let pairs = 0, slots = 0;
  for (let p = ps; p + 8 <= pe; p += 8) {
    const a = buf.readUInt32LE(p);
    const b = buf.readUInt32LE(p + 4);
    slots++;
    if (a >= 1 && a <= 1500 && b >= 1 && b <= 1500) pairs++;
  }
  if (slots >= 8 && pairs / slots > 0.7) coordCount++;
  totalCount++;
}
console.log(`  ${coordCount}/${totalCount} kids are >70% coord-pairs (likely tile-trail records)`);
