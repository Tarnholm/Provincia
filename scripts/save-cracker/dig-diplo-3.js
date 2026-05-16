// dig-diplo-3.js — session 108 step 3
//
// Step 2 found that each NPC's 6-12 KB record is dominated by a 510×1400
// RLE exploration grid + a settlement-observation tail. That doesn't leave
// room for a 238-entry diplomatic table.
//
// Pivot: the descr_strat docs show major-faction records have a fixed-stride
// layout. Treasury record (session 5) used a different magic — u32 at +8=100
// — to find them. Let's audit BOTH:
//   (a) the 239 "ff0aaff0" records (these have RLE) — likely "AI memory /
//       per-faction observed world" not diplomacy.
//   (b) the 23 major-faction records (treasury) — these may hold diplomacy
//       in their region-list-trailing region.
//
// Also look at: is the diplomacy in the 6.3 MB tail? Search for a stride-N
// repeating structure of length 23 (or 22 or 21 if player is excluded) in
// the tail.
//
// Usage: node dig-diplo-3.js
"use strict";

const fs = require("fs");
const path = require("path");

const SAVE = path.join(__dirname, "fixtures", "feral", "save_1.2.sav");
const buf = fs.readFileSync(SAVE);
console.log(`save_1.2.sav: ${buf.length} B`);

// === (a) Find major-faction (treasury) records ===
function readMajorFactionRecords(b) {
  const out = [];
  for (let i = 0; i + 64 < b.length; i += 1) {
    if (b.readUInt32LE(i + 8) !== 100) continue;
    if (b.readUInt32LE(i + 12) !== 1) continue;
    if (b.readUInt32LE(i + 16) !== 0 || b.readUInt32LE(i + 20) !== 0) continue;
    if (b.readUInt32LE(i + 24) !== i + 24) continue;
    if (b.readUInt32LE(i + 32) !== 0 || b.readUInt32LE(i + 36) !== 0) continue;
    if (b.readUInt32LE(i + 40) !== i + 40) continue;
    if (b.readUInt32LE(i + 44) !== 6) continue;
    const regions = b.readUInt32LE(i + 48);
    if (regions > 200) continue;
    out.push({ pos: i, regions });
  }
  return out;
}

const major = readMajorFactionRecords(buf);
console.log(`\nMajor-faction records: ${major.length}`);
for (let k = 0; k < major.length; k++) {
  const m = major[k];
  // size = distance to next
  const next = k + 1 < major.length ? major[k + 1].pos : -1;
  const sizeGuess = next > 0 ? next - m.pos : 0;
  console.log(`  [${k}] pos=0x${m.pos.toString(16)}  regions=${m.regions}  size~=${sizeGuess}`);
}

// Major faction records are clustered. Look at what is between consecutive records.
// Layout from session 5:
//   +0  treasury (i32)
//   +44 = 6 (size of sub-section)
//   +48 = regionCount N
//   +52..(52+4N) = region IDs
//   +(92 + 4N) = start-of-turn treasury snapshot
// So +(92 + 4N) is treasured; what comes after?

console.log("\n=== Major faction record sizes ===");
for (let k = 0; k < major.length; k++) {
  const m = major[k];
  const next = k + 1 < major.length ? major[k + 1].pos : null;
  if (!next) continue;
  const sz = next - m.pos;
  const headerEnd = 92 + 4 * m.regions; // where turnStart treasury sits
  const trailingFromHdr = sz - (headerEnd + 4); // bytes past treasured-turnstart u32
  console.log(`  [${k}] pos=0x${m.pos.toString(16)}  size=${sz}  headerEnd=${headerEnd}+4  trailing_past_turnstart=${trailingFromHdr}`);
}

// Dump trailing bytes for major[1] (a 22-region faction or similar)
console.log("\n=== Major[1] trailing bytes (post-turnstart) ===");
const m1 = major[1];
const m2 = major[2];
const m1End = m2 ? m2.pos : m1.pos + 1024;
const m1HeaderEnd = m1.pos + 92 + 4 * m1.regions + 4;
console.log(`  m1 pos=0x${m1.pos.toString(16)} regions=${m1.regions} hdrEnd=0x${m1HeaderEnd.toString(16)} sz=${m1End - m1.pos}`);
let h = "", a = "";
for (let i = m1HeaderEnd; i < Math.min(m1HeaderEnd + 512, m1End); i++) {
  const off = i - m1HeaderEnd;
  if (off % 16 === 0) {
    if (off > 0) console.log(`    ${h}  ${a}`);
    h = `+${off.toString(16).padStart(4, "0")}: `;
    a = "";
  }
  h += buf[i].toString(16).padStart(2, "0") + " ";
  a += (buf[i] >= 32 && buf[i] < 127 ? String.fromCharCode(buf[i]) : ".");
}
if (h) console.log(`    ${h}  ${a}`);

// === Look for 22-tuple or 23-tuple stride repetition in the MAJOR record's trailing ===
// Hypothesis: each major record has a 22-entry table (22 OTHER majors).
// If entry = 16 bytes, 22*16 = 352 bytes.
// If entry = 8 bytes, 22*8 = 176 bytes.
// If entry = 4 bytes, 22*4 = 88 bytes.
// Major[1] trailing = sz - (92+4N+4).
// Let's compute trailing sizes precisely.
console.log("\n=== Trailing sizes (after treasury-turn-start u32) ===");
for (let k = 0; k < major.length; k++) {
  const m = major[k];
  const next = k + 1 < major.length ? major[k + 1].pos : null;
  if (!next) continue;
  const sz = next - m.pos;
  const trailing = sz - (92 + 4 * m.regions + 4);
  console.log(`  [${k}] sz=${sz}  regions=${m.regions}  trailing=${trailing}  /22=${(trailing/22).toFixed(2)}  /23=${(trailing/23).toFixed(2)}  /21=${(trailing/21).toFixed(2)}`);
}

// === Also: peek further than 92+4N+4 to find sub-headers ===
console.log("\n=== Major[0] full dump (first 512 B post-pos) ===");
const m0 = major[0];
const m0End = major[1].pos;
console.log(`  pos=0x${m0.pos.toString(16)} sz=${m0End - m0.pos} regions=${m0.regions}`);
const m0Hdr = 92 + 4 * m0.regions + 4;
console.log(`  expected post-turnstart begins at +${m0Hdr}`);
let h0 = "", a0 = "";
const stride = 16;
for (let i = 0; i < Math.min(512, m0End - m0.pos); i++) {
  if (i % stride === 0) {
    if (i > 0) console.log(`    ${h0}  ${a0}`);
    h0 = `+${i.toString(16).padStart(4, "0")}: `;
    a0 = "";
  }
  h0 += buf[m0.pos + i].toString(16).padStart(2, "0") + " ";
  a0 += (buf[m0.pos + i] >= 32 && buf[m0.pos + i] < 127 ? String.fromCharCode(buf[m0.pos + i]) : ".");
}
if (h0) console.log(`    ${h0}  ${a0}`);
