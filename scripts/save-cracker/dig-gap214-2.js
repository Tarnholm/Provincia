// dig-gap214-2.js — structure the 214 KB gap.
//
// First-pass findings:
//   * 95% zero bytes, but the first ~few KB shows a clear 12-byte record
//     pattern with three recurring u32 "tag" values: 0xe5e47935, 0x23e1f461,
//     0x3a 17 13 87 = 0x8713173a, and 0x9b 11 ee eb = 0xebee119b.
//   * Each record = [u16 turn-or-event?][u16 something][u32 increasing seq][u32 tag-uuid]
//     12-byte stride autocorrelation is highest (90%).
//   * 219-byte zero runs repeat in the first ~10 KB — sized like fixed-stride table rows.
//   * Big zero swathes >1 KB suggest sparse table indexed by id.
//
// Goal here:
//   1. Confirm 12-byte stride: parse a 12-byte loop until the "active" prefix ends.
//   2. Catalog the distinct "tag" u32 values and their counts. Are these character UUIDs?
//   3. Check whether the active record block ends at some offset and is followed
//      by a different structure (the long zero runs).
//   4. Look at the 219-byte stride — sized like a per-character or per-region slot.
//   5. Find sub-region boundaries inside the gap (where density changes).

"use strict";

const fs = require("fs");
const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const GAP_START = 0x2d4a9;
const GAP_END   = 0x618f8;
const buf = fs.readFileSync(SAVE);
const len = GAP_END - GAP_START;

// ---- A. Parse 12-byte records starting at gap start until pattern fails ---
console.log("=== 12-byte record parse (first 30 records) ===");
console.log("  off       u16   u16   seq        tag-u32");
let okRecords = 0;
let lastSeq = null;
const tagCounts = new Map();
for (let r = 0; r < 100; r++) {
  const p = GAP_START + r * 12;
  if (p + 12 > GAP_END) break;
  const a = buf.readUInt16LE(p);
  const b = buf.readUInt16LE(p + 2);
  const seq = buf.readUInt32LE(p + 4);
  const tag = buf.readUInt32LE(p + 8);
  if (r < 30) {
    console.log(`  0x${p.toString(16)}  0x${a.toString(16).padStart(4,"0")}  0x${b.toString(16).padStart(4,"0")}  ${seq.toString().padStart(8)}  0x${tag.toString(16).padStart(8,"0")}`);
  }
  if (a !== 0 && seq < 10000 && (lastSeq === null || Math.abs(seq - lastSeq) <= 4)) {
    okRecords++;
    lastSeq = seq;
    tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
  } else {
    if (r < 30) console.log(`    ^ pattern break at record ${r}`);
  }
}
console.log(`\n  recognized records: ${okRecords}`);
console.log("  tag counts (top 20):");
const tagArr = [...tagCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,20);
for (const [tag, cnt] of tagArr) {
  console.log(`    0x${tag.toString(16).padStart(8,"0")}  ${cnt}`);
}

// ---- B. Scan the whole 214 KB with the 12-byte stride and count active records ----
console.log("\n=== 12-byte record scan: where does the pattern stop? ===");
const allTagCounts = new Map();
let firstZeroBlock = -1;
let scanEnd = GAP_START;
let zeroRunIn12 = 0;
for (let p = GAP_START; p + 12 <= GAP_END; p += 12) {
  const a = buf.readUInt32LE(p);
  const seq = buf.readUInt32LE(p + 4);
  const tag = buf.readUInt32LE(p + 8);
  if (a === 0 && seq === 0 && tag === 0) {
    zeroRunIn12++;
    if (firstZeroBlock < 0 && zeroRunIn12 >= 4) firstZeroBlock = p - zeroRunIn12 * 12 + 12;
  } else {
    zeroRunIn12 = 0;
    allTagCounts.set(tag, (allTagCounts.get(tag) || 0) + 1);
    scanEnd = p + 12;
  }
}
console.log(`  last non-zero 12-byte record ends at: 0x${scanEnd.toString(16)}`);
console.log(`  first long zero block (>= 4 records): 0x${firstZeroBlock.toString(16)}`);
console.log(`  unique tags across whole gap: ${allTagCounts.size}`);
const allTagArr = [...allTagCounts.entries()].sort((a,b)=>b[1]-a[1]);
console.log("  top 20 tags:");
for (const [tag, cnt] of allTagArr.slice(0,20)) {
  console.log(`    0x${tag.toString(16).padStart(8,"0")}  ${cnt}`);
}

// ---- C. Density profile: count nonzero bytes per 4 KB block ----
console.log("\n=== Density profile (4 KB blocks, %% nonzero) ===");
const BLOCK = 4096;
const blocks = Math.ceil(len / BLOCK);
const profile = [];
for (let bIdx = 0; bIdx < blocks; bIdx++) {
  const start = GAP_START + bIdx * BLOCK;
  const end = Math.min(start + BLOCK, GAP_END);
  let nz = 0;
  for (let i = start; i < end; i++) if (buf[i] !== 0) nz++;
  const pct = (nz / (end-start) * 100).toFixed(1);
  profile.push({ start, end, nz, pct });
}
for (const b of profile) {
  const bar = "#".repeat(Math.min(50, Math.floor(b.nz / (b.end - b.start) * 50)));
  console.log(`  0x${b.start.toString(16).padStart(8,"0")}..0x${b.end.toString(16).padStart(8,"0")}  ${b.pct.padStart(5)}%  ${bar}`);
}

// ---- D. Look for region/character UUIDs in tags (compare to known UUIDs) ----
//   Known character record magic is ff0aaff0. UUIDs are stored at varying offsets.
//   Just check whether the top tags appear elsewhere in the file (cross-reference).
console.log("\n=== Cross-reference top tags against rest of file ===");
for (const [tag, cnt] of allTagArr.slice(0, 10)) {
  const tagBuf = Buffer.alloc(4);
  tagBuf.writeUInt32LE(tag, 0);
  let total = 0;
  let outsideGap = 0;
  let firstOutside = -1;
  let p = 0;
  while (p < buf.length - 4) {
    const i = buf.indexOf(tagBuf, p);
    if (i < 0) break;
    total++;
    if (i < GAP_START || i >= GAP_END) {
      outsideGap++;
      if (firstOutside < 0) firstOutside = i;
    }
    p = i + 1;
  }
  console.log(`  tag 0x${tag.toString(16).padStart(8,"0")}: gap=${cnt}  outside=${outsideGap}  firstOutside=${firstOutside >= 0 ? "0x"+firstOutside.toString(16) : "-"}`);
}

// ---- E. Stride sweep for the *tail* (where most of the zeros are) ----
console.log("\n=== Tail stride sweep (0x40000..gap_end) ===");
const TAIL = 0x40000;
const tailLen = GAP_END - TAIL;
const tailStrides = [4, 8, 12, 16, 20, 24, 32, 48, 64, 96, 128, 256];
for (const s of tailStrides) {
  let same = 0; let total = 0;
  for (let i = 0; i < Math.min(tailLen, 100000) - s; i += 4) {
    total++;
    if (buf[TAIL + i] === buf[TAIL + i + s]) same++;
  }
  console.log(`  stride ${s.toString().padStart(4)}: ${(same/total*100).toFixed(2)}%`);
}

// ---- F. Last non-zero u32 in the gap, and approx tail content sample ----
console.log("\n=== Last nonzero u32 in gap ===");
for (let p = GAP_END - 4; p >= GAP_START; p -= 4) {
  if (buf.readUInt32LE(p) !== 0) {
    console.log(`  0x${p.toString(16)}  u32=0x${buf.readUInt32LE(p).toString(16).padStart(8,"0")}`);
    // Hexdump 64 bytes around it
    const dStart = Math.max(GAP_START, p - 32);
    for (let r = 0; r < 4; r++) {
      const base = dStart + r * 16;
      const hex = [];
      const ascii = [];
      for (let c = 0; c < 16; c++) {
        const bb = buf[base + c];
        hex.push(bb.toString(16).padStart(2, "0"));
        ascii.push(bb >= 0x20 && bb < 0x7f ? String.fromCharCode(bb) : ".");
      }
      console.log(`    0x${base.toString(16).padStart(8, "0")}  ${hex.join(" ")}  |${ascii.join("")}|`);
    }
    break;
  }
}

// ---- G. Section transitions: where does the 12-byte regime END? ----
//   Scan first non-12-byte-record offset.
console.log("\n=== End of 12-byte-record regime detection ===");
let consecGood = 0;
let lastGoodEnd = GAP_START;
let firstBreak = -1;
for (let p = GAP_START; p + 12 <= GAP_END; p += 12) {
  const a = buf.readUInt32LE(p);
  const seq = buf.readUInt32LE(p + 4);
  // record looks "good" if a != 0 and seq is a small positive int
  if (a !== 0 && seq > 0 && seq < 100000) {
    consecGood++;
    lastGoodEnd = p + 12;
  } else {
    if (consecGood >= 50 && firstBreak < 0) firstBreak = p;
    consecGood = 0;
  }
}
console.log(`  last good 12-byte record end: 0x${lastGoodEnd.toString(16)}`);
console.log(`  first break after long good run: 0x${firstBreak.toString(16)}`);
console.log(`  active region size: ${lastGoodEnd - GAP_START} bytes = ${((lastGoodEnd - GAP_START)/12).toFixed(0)} records`);
