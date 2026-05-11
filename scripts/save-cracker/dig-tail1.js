// dig-tail1.js — Map what lives in the file tail (0x1f10c72..EOF for rome10).
//
// Session 12 confirmed top-level file geography but left the 6.3MB tail
// completely un-investigated. This script:
//   1. Locates the tail boundary (= settlement zone end) precisely.
//   2. Histograms tail bytes (vs body root / gap baselines).
//   3. Scans tail for ASCII / UTF-16LE strings (>= 4 chars).
//   4. Scans tail for u32==pos self-pointer section candidates.
//   5. Looks for repeating record stride patterns (constant size at constant offset).

const fs = require("fs");
const path = require("path");

const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);
console.log(`# File: ${path.basename(SAVE)} (${buf.length} bytes = 0x${buf.length.toString(16)})\n`);

// ---- 1. Locate the tail boundary precisely.
// Settlement zone starts at 0xf88637 (per session 12). Read its self-pointer
// + size to find end-of-zone, then tail = (settlementZone.end .. fileLen).
const settlementZoneOff = 0xf88637;
const sp = buf.readUInt32LE(settlementZoneOff);
const sz = buf.readUInt32LE(settlementZoneOff + 4);
console.log(`Settlement zone @0x${settlementZoneOff.toString(16)}: self=0x${sp.toString(16)} size=${sz} (0x${sz.toString(16)})`);
const settlementZoneEnd = settlementZoneOff + sz;
console.log(`Settlement zone end: 0x${settlementZoneEnd.toString(16)}`);
const tailStart = settlementZoneEnd;
const tailEnd = buf.length;
const tailSize = tailEnd - tailStart;
console.log(`Tail: [0x${tailStart.toString(16)}..0x${tailEnd.toString(16)}) size=${tailSize} bytes\n`);

// ---- 2. Byte histogram of tail.
const hist = new Uint32Array(256);
for (let p = tailStart; p < tailEnd; p++) hist[buf[p]]++;
const entries = [];
for (let i = 0; i < 256; i++) entries.push({ v: i, n: hist[i] });
entries.sort((a, b) => b.n - a.n);
console.log("Top 15 byte values in tail:");
for (let i = 0; i < 15; i++) {
  const e = entries[i];
  console.log(`  0x${e.v.toString(16).padStart(2, "0")} (${String(e.v).padStart(3)}): ${e.n.toString().padStart(8)} (${(100 * e.n / tailSize).toFixed(2)}%)`);
}
const zeroPct = 100 * hist[0] / tailSize;
console.log(`Zero density: ${zeroPct.toFixed(2)}%\n`);

// ---- 3. ASCII string scan (>= 4 printable chars, terminated by 0 or non-print).
console.log("=== ASCII strings (len >= 4) in tail ===");
const asciiHits = [];
let start = -1;
for (let p = tailStart; p < tailEnd; p++) {
  const b = buf[p];
  if (b >= 0x20 && b <= 0x7e) {
    if (start === -1) start = p;
  } else {
    if (start !== -1 && p - start >= 4) {
      asciiHits.push({ off: start, len: p - start, s: buf.slice(start, p).toString("ascii") });
    }
    start = -1;
  }
}
if (start !== -1 && tailEnd - start >= 4) {
  asciiHits.push({ off: start, len: tailEnd - start, s: buf.slice(start, tailEnd).toString("ascii") });
}
console.log(`Total ASCII hits: ${asciiHits.length}`);
// Show distribution by length and a sample
const lenBuckets = { "4-5": 0, "6-10": 0, "11-20": 0, "21-50": 0, ">50": 0 };
for (const h of asciiHits) {
  if (h.len <= 5) lenBuckets["4-5"]++;
  else if (h.len <= 10) lenBuckets["6-10"]++;
  else if (h.len <= 20) lenBuckets["11-20"]++;
  else if (h.len <= 50) lenBuckets["21-50"]++;
  else lenBuckets[">50"]++;
}
console.log("Length distribution:", JSON.stringify(lenBuckets));
// Show longest 30
asciiHits.sort((a, b) => b.len - a.len);
console.log("\nLongest 30 ASCII strings:");
for (let i = 0; i < Math.min(30, asciiHits.length); i++) {
  const h = asciiHits[i];
  console.log(`  @0x${h.off.toString(16)} (len=${h.len}): ${JSON.stringify(h.s)}`);
}

// ---- 4. UTF-16LE string scan (>= 4 chars, ASCII codepoints only).
console.log("\n=== UTF-16LE strings (len >= 4) in tail ===");
const utf16Hits = [];
{
  let s = -1;
  for (let p = tailStart; p + 2 <= tailEnd; p += 2) {
    const c = buf.readUInt16LE(p);
    if (c >= 0x20 && c <= 0x7e) {
      if (s === -1) s = p;
    } else {
      if (s !== -1 && (p - s) / 2 >= 4) {
        utf16Hits.push({ off: s, len: (p - s) / 2, s: buf.slice(s, p).toString("utf16le") });
      }
      s = -1;
    }
  }
}
console.log(`Total UTF-16 hits: ${utf16Hits.length}`);
utf16Hits.sort((a, b) => b.len - a.len);
console.log("Longest 30 UTF-16 strings:");
for (let i = 0; i < Math.min(30, utf16Hits.length); i++) {
  const h = utf16Hits[i];
  console.log(`  @0x${h.off.toString(16)} (chars=${h.len}): ${JSON.stringify(h.s)}`);
}

// ---- 5. Self-pointer (u32==pos) section candidates in tail.
console.log("\n=== Self-pointer section candidates in tail ===");
const sectionHits = [];
for (let p = tailStart; p + 8 <= tailEnd; p += 4) {
  const v = buf.readUInt32LE(p);
  if (v !== p) continue;
  const ssz = buf.readUInt32LE(p + 4);
  if (ssz < 16 || p + ssz > tailEnd) continue;
  sectionHits.push({ off: p, size: ssz });
}
console.log(`Section candidates: ${sectionHits.length}`);
console.log("First 30:");
for (let i = 0; i < Math.min(30, sectionHits.length); i++) {
  const h = sectionHits[i];
  console.log(`  @0x${h.off.toString(16)} size=${h.size} (0x${h.size.toString(16)})`);
}

// Greedy non-overlap accept
sectionHits.sort((a, b) => a.off - b.off || b.size - a.size);
const accepted = [];
let lastEnd = tailStart;
for (const s of sectionHits) {
  if (s.off < lastEnd) continue;
  accepted.push(s);
  lastEnd = s.off + s.size;
}
console.log(`\nNon-overlapping accepted: ${accepted.length}`);
for (let i = 0; i < Math.min(15, accepted.length); i++) {
  const a = accepted[i];
  // Show first 8 bytes of payload
  const p0 = buf.readUInt32LE(a.off + 8);
  const p1 = buf.readUInt32LE(a.off + 12);
  console.log(`  [${i}] @0x${a.off.toString(16)} sz=${a.size} payload[0..2]=${p0},${p1}`);
}

// ---- 6. Section grammar invariant check (size field at +4 == payload size).
// taw invariant: u32 offset==pos, u32 size where size includes header.
console.log("\n=== Repeating size patterns in tail (stride detection) ===");
// Look for runs of identical u32 at +4-from-start of consecutive sections.
const sizeFreq = {};
for (const s of sectionHits) {
  sizeFreq[s.size] = (sizeFreq[s.size] || 0) + 1;
}
const top = Object.entries(sizeFreq).sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log("Top 10 section sizes (count):");
for (const [size, n] of top) console.log(`  size=${size} (0x${parseInt(size).toString(16)}): ${n}`);
