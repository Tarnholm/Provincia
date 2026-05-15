// dig-gap167-2.js — Drill into the structure found by dig-gap167-1.js.
//
// Strong signals:
//   * 77% byte-eq at stride 12 → 12-byte record stride.
//   * Tail of gap (~0x18000..0x2d15a) packed with records ending in 4-byte
//     "cookies": 1e 5d cf 5c, 0e 78 55 7a, 4a fa 6c e0, 99 fc 3d 37,
//     2e c0 13 56, 72 1b 86 54, plus 00 00 00 00.
//   * Each 12-byte record contains an incrementing 16-bit number that runs
//     through 0x023a, 0x023b, ..., 0x0245 — looks like a turn counter.
//   * Head of gap (0x44e2..) has a "1e 00 00 00" appearing every 35 bytes —
//     could be 239-entry table.
//
// Goal: confirm 12-byte stride, classify cookies, find record boundary,
// determine sub-region layout.

"use strict";

const fs = require("fs");

const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const GAP_START = 0x44e2;
const GAP_END   = 0x2d15a;

const buf = fs.readFileSync(SAVE);

// ---- 1. Drill into the 12-byte stride. ------------------------------
// The tail of the gap has clear 12-byte structure. Try to find where it
// starts. Walk backward from the end finding the first byte at which the
// 12-byte stride breaks down.

// Define: "looks like a record block" = at offset i, buf[i+10..i+12] forms
// the recognised "trailing" pattern (last byte 0x01 or 0x04, second-last 0x00).
// Inspecting tail: every record ends with "... 01" or "... 04 00"; let's
// check the alignment offset of records in last 4 KB.

function tryAlign(rangeStart, rangeEnd, stride, requireFn) {
  // For each offset 0..stride-1, count records matching requireFn.
  const counts = new Array(stride).fill(0);
  for (let off = 0; off < stride; off++) {
    let c = 0;
    for (let p = rangeStart + off; p + stride <= rangeEnd; p += stride) {
      if (requireFn(p)) c++;
    }
    counts[off] = c;
  }
  return counts;
}

// Records seen end with bytes "01 20 79 03 39 02 00 00 1e 5d cf 5c" then next
// record starts. Looking at the dump:
//   01 20 79 03 39 02 00 00 1e 5d cf 5c | 01 20 7a 03 39 02 00 00 00 00 00 00
//   04 00 fc 00 3a 02 00 00 4a fa 6c e0 | 01 20 79 03 3a 02 00 00 1e 5d cf 5c
//   01 20 7a 03 3a 02 00 00 1e 5d cf 5c | 01 20 7b 03 3a 02 00 00 00 00 00 00
//
// Many records start with "01 20" or "04 00". Test that pattern at start.
function looksLikeRecordStart(p) {
  const b0 = buf[p], b1 = buf[p + 1];
  // record starts with "01 20" (a 0x2001 little-endian value)
  // or "04 00 <8 zeros>" pattern (header/separator).
  return (b0 === 0x01 && b1 === 0x20) || (b0 === 0x04 && b1 === 0x00);
}

console.log("=== Alignment of 12-byte records in last 16 KB ===");
{
  const counts = tryAlign(GAP_END - 16384, GAP_END, 12, looksLikeRecordStart);
  for (let off = 0; off < 12; off++) {
    console.log(`  offset+${off}: ${counts[off]} matches`);
  }
}

// Best offset wins
let best = { off: 0, c: -1 };
{
  const counts = tryAlign(GAP_END - 16384, GAP_END, 12, looksLikeRecordStart);
  for (let off = 0; off < 12; off++) if (counts[off] > best.c) best = {off, c: counts[off]};
}
console.log(`  best alignment: offset+${best.off} (${best.c} matches)`);

// Find first byte at which 12-byte records start (walk forward from
// gap start, looking for first 12-byte aligned "01 20" sequence sustained).

// ---- 2. Scan whole gap, classify records by first byte and cookie. --
// Align to best.off relative to GAP_END. The records seem to be densely
// packed in the tail. Walk backwards from GAP_END aligning to 12 boundaries.

// Find the 12-byte alignment grid: pick the largest p < GAP_END such that
// (GAP_END - p) % 12 === 0 and looksLikeRecordStart(p).
let alignAnchor = -1;
for (let p = GAP_END - 12; p >= GAP_END - 48; p--) {
  if (looksLikeRecordStart(p)) { alignAnchor = p; break; }
}
console.log(`  align anchor near tail: 0x${alignAnchor.toString(16)}`);

// Walk from anchor backward in 12-byte steps as long as records look valid.
// Then forward to GAP_END.
function recordValid(p) {
  if (p < GAP_START || p + 12 > GAP_END) return false;
  return looksLikeRecordStart(p);
}
let recStart = alignAnchor;
while (recStart - 12 >= GAP_START && recordValid(recStart - 12)) recStart -= 12;
let recEnd = alignAnchor;
while (recEnd + 12 <= GAP_END && recordValid(recEnd + 12)) recEnd += 12;
recEnd += 12;
console.log(`  contiguous record block: 0x${recStart.toString(16)}..0x${recEnd.toString(16)}`);
console.log(`  block size: ${recEnd - recStart} bytes = ${(recEnd-recStart)/12} records`);

// ---- 3. Classify by first byte (record type byte) --------------------
console.log("\n=== Record type distribution (byte at offset 0) ===");
{
  const typeHist = new Map();
  for (let p = recStart; p + 12 <= recEnd; p += 12) {
    const t = buf[p];
    typeHist.set(t, (typeHist.get(t) || 0) + 1);
  }
  for (const [t, c] of [...typeHist.entries()].sort((a,b)=>b[1]-a[1])) {
    console.log(`  0x${t.toString(16).padStart(2,"0")}: ${c}`);
  }
}

// ---- 4. Classify by trailing 4-byte cookie (offset +8..+11) ----------
console.log("\n=== Trailing 4-byte cookie distribution (offset +8) ===");
{
  const cookieHist = new Map();
  for (let p = recStart; p + 12 <= recEnd; p += 12) {
    const c = buf.readUInt32LE(p + 8);
    cookieHist.set(c, (cookieHist.get(c) || 0) + 1);
  }
  const sorted = [...cookieHist.entries()].sort((a,b)=>b[1]-a[1]);
  console.log(`  unique cookies: ${sorted.length}`);
  for (const [c, n] of sorted.slice(0, 20)) {
    console.log(`  0x${c.toString(16).padStart(8,"0")}: ${n}`);
  }
}

// ---- 5. Sequence counter at +4..+5 (16-bit). Distribution -----------
console.log("\n=== 16-bit field at offset +4 (suspected turn counter) ===");
{
  const seqHist = new Map();
  for (let p = recStart; p + 12 <= recEnd; p += 12) {
    const v = buf.readUInt16LE(p + 4);
    seqHist.set(v, (seqHist.get(v) || 0) + 1);
  }
  const sorted = [...seqHist.entries()].sort((a,b)=>a[0]-b[0]);
  console.log(`  unique values: ${sorted.length}, min=0x${sorted[0][0].toString(16)}, max=0x${sorted[sorted.length-1][0].toString(16)}`);
  // print first 15 and last 5
  for (let i = 0; i < Math.min(15, sorted.length); i++) {
    console.log(`  0x${sorted[i][0].toString(16).padStart(4,"0")}: ${sorted[i][1]}`);
  }
  console.log("  ...");
  for (let i = Math.max(0, sorted.length - 5); i < sorted.length; i++) {
    console.log(`  0x${sorted[i][0].toString(16).padStart(4,"0")}: ${sorted[i][1]}`);
  }
}

// ---- 6. Bytes +2..+3 (suspected sub-id) ------------------------------
console.log("\n=== 16-bit field at offset +2 ===");
{
  const histB = new Map();
  for (let p = recStart; p + 12 <= recEnd; p += 12) {
    const v = buf.readUInt16LE(p + 2);
    histB.set(v, (histB.get(v) || 0) + 1);
  }
  const sorted = [...histB.entries()].sort((a,b)=>b[1]-a[1]);
  console.log(`  unique values: ${sorted.length}`);
  for (const [v, c] of sorted.slice(0, 20)) {
    console.log(`  0x${v.toString(16).padStart(4,"0")} (dec=${v}): ${c}`);
  }
}

// ---- 7. Pre-record-block header: dump 0x44e2..recStart --------------
console.log(`\n=== Pre-record-block header dump (0x${GAP_START.toString(16)}..0x${recStart.toString(16)}) ===`);
console.log(`  header length: ${recStart - GAP_START} bytes`);

// ---- 8. Look for stride 35 in the 1e-periodic head region -----------
console.log("\n=== Find the 1e-periodic region's stride ===");
{
  // Pattern: bytes at 0x4564, 0x4587, 0x45ad, 0x45ce, 0x45ef etc are 0x1e.
  // Distance: 0x4587 - 0x4564 = 0x23 = 35. Confirm.
  const ones = [];
  for (let i = GAP_START; i < GAP_START + 0x2000; i++) {
    if (buf[i] === 0x1e && buf[i+1] === 0x00 && buf[i+2] === 0x00 && buf[i+3] === 0x00) {
      ones.push(i);
      if (ones.length > 50) break;
    }
  }
  console.log(`  '1e 00 00 00' hits in first 8 KB of gap: ${ones.length}`);
  console.log(`  first 12: ${ones.slice(0,12).map(o=>"0x"+o.toString(16)).join(", ")}`);
  if (ones.length >= 3) {
    console.log(`  deltas: ${ones.slice(0,12).map((o,i)=>i?(o-ones[i-1]):"-").join(", ")}`);
  }
}

// ---- 9. Search for known character/general names in the head region --
console.log("\n=== ASCII scan of head region (pre-record-block) ===");
{
  const strs = [];
  let cur = "";
  let curStart = -1;
  for (let i = GAP_START; i < recStart; i++) {
    const b = buf[i];
    if (b >= 0x20 && b < 0x7f) {
      if (cur.length === 0) curStart = i;
      cur += String.fromCharCode(b);
    } else {
      if (cur.length >= 4) strs.push({ off: curStart, s: cur });
      cur = ""; curStart = -1;
    }
  }
  console.log(`  strings >= 4 chars in head: ${strs.length}`);
  for (let i = 0; i < Math.min(20, strs.length); i++) {
    console.log(`  0x${strs[i].off.toString(16).padStart(8, "0")}  (${strs[i].s.length}) ${JSON.stringify(strs[i].s)}`);
  }
}

// ---- 10. Histogram of bytes in head region only -----------------------
console.log("\n=== Head-region byte histogram (top 10) ===");
{
  const h = new Uint32Array(256);
  const ln = recStart - GAP_START;
  for (let i = GAP_START; i < recStart; i++) h[buf[i]]++;
  const sorted = [...h].map((c,b)=>({b,c})).sort((a,b)=>b.c-a.c);
  for (let i = 0; i < 10; i++) {
    const e = sorted[i];
    console.log(`  0x${e.b.toString(16).padStart(2,"0")}: ${e.c} (${(e.c/ln*100).toFixed(2)}%)`);
  }
  console.log(`  head length: ${ln} bytes`);
}

// ---- 11. Are records sorted by turn counter (+4 field)? --------------
console.log("\n=== Check monotonicity of +4 field ===");
{
  let prev = -1;
  let monotonic = 0, total = 0;
  for (let p = recStart; p + 12 <= recEnd; p += 12) {
    const v = buf.readUInt16LE(p + 4);
    if (prev >= 0) {
      total++;
      if (v >= prev) monotonic++;
    }
    prev = v;
  }
  console.log(`  monotonic (next >= prev): ${monotonic}/${total} (${(monotonic/total*100).toFixed(1)}%)`);
}

// ---- 12. Sample 30 records as parsed structs --------------------------
console.log("\n=== Sample of 20 records from the record block ===");
{
  const COOKIES = {
    [0x5ccf5d1e]: "C1", // 1e 5d cf 5c
    [0x7a55780e]: "C2", // 0e 78 55 7a
    [0xe06cfa4a]: "C3", // 4a fa 6c e0
    [0x373dfc99]: "C4", // 99 fc 3d 37
    [0x5613c02e]: "C5", // 2e c0 13 56
    [0x54861b72]: "C6", // 72 1b 86 54
    [0x00000000]: "NUL",
  };
  for (let i = 0; i < 20; i++) {
    const p = recStart + i * 12;
    const t = buf[p];
    const sub = buf.readUInt16LE(p + 2);
    const seq = buf.readUInt16LE(p + 4);
    const ck = buf.readUInt32LE(p + 8);
    const ckName = COOKIES[ck] || "?";
    const flag = buf[p + 1];
    console.log(`  0x${p.toString(16).padStart(8,"0")}  type=0x${t.toString(16).padStart(2,"0")} f=0x${flag.toString(16).padStart(2,"0")} sub=0x${sub.toString(16).padStart(4,"0")}(${sub})  seq=0x${seq.toString(16).padStart(4,"0")}(${seq})  cookie=0x${ck.toString(16).padStart(8,"0")} (${ckName})`);
  }
}

// ---- 13. Check if cookies look like UUIDs/character pointers --------
// Compare cookies to known UUID forms elsewhere in save.
console.log("\n=== Cookie cross-reference: do top cookies appear elsewhere in save? ===");
{
  const targets = [0x5ccf5d1e, 0x7a55780e, 0xe06cfa4a, 0x373dfc99, 0x5613c02e, 0x54861b72];
  for (const t of targets) {
    const needle = Buffer.alloc(4);
    needle.writeUInt32LE(t, 0);
    let count = 0;
    let firstOutOfGap = -1;
    let p = 0;
    while ((p = buf.indexOf(needle, p)) >= 0) {
      count++;
      if (firstOutOfGap < 0 && (p < GAP_START || p >= GAP_END)) firstOutOfGap = p;
      p++;
      if (count > 5000) break;
    }
    console.log(`  0x${t.toString(16).padStart(8,"0")}: ${count} hits total (first outside gap = 0x${firstOutOfGap.toString(16)})`);
  }
}
