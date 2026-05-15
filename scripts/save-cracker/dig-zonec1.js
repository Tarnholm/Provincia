// dig-zonec1.js — session 55 attempt 1.
// Walk every taw self-pointer record in Zone C 0xa8beb..0xf8fd2,
// bucket by size, dump first 2-3 records of the top 3 buckets,
// scan for faction-id-ish (0..239) u32s, ASCII strings, and entity UUIDs.

"use strict";

const fs = require("fs");

const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const ZC_START = 0xa8beb;
const ZC_END   = 0xf8fd2;

const buf = fs.readFileSync(SAVE);
console.log(`zone C: 0x${ZC_START.toString(16)}..0x${ZC_END.toString(16)} = ${ZC_END-ZC_START} bytes`);

// ---- 1. Walk taw headers wall-to-wall (sequential, not scan-all positions).
// A taw record is { u32 size, u32 self_ptr_to_size_field_pos }. The session-54
// scan flagged a self-pointer hit where buf.readUInt32LE(p) === p — meaning that
// offset 4 of the header (the self-ptr) actually equals p. So at position p we
// have: buf[p..p+3]=p (self-ptr), buf[p+4..p+7]=size, payload follows.
//
// Re-check the convention by looking at the very first hit.
console.log("\n=== First 64 bytes of Zone C (raw) ===");
for (let row = 0; row < 4; row++) {
  const base = ZC_START + row * 16;
  const hex = [];
  const ascii = [];
  for (let c = 0; c < 16; c++) {
    const b = buf[base+c];
    hex.push(b.toString(16).padStart(2,"0"));
    ascii.push(b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".");
  }
  console.log(`  0x${base.toString(16).padStart(8,"0")}  ${hex.join(" ")}  |${ascii.join("")}|`);
}

// Scan every byte position for "u32==p" hits (matches the prior convention).
const recs = [];
for (let p = ZC_START; p < ZC_END - 8; p++) {
  if (buf.readUInt32LE(p) === p) {
    const sz = buf.readUInt32LE(p + 4);
    if (sz > 0 && sz < 8192) recs.push({ off: p, size: sz, payStart: p + 8, payEnd: p + 8 + sz });
  }
}
console.log(`\ntotal taw records: ${recs.length}`);

// Sort by offset.
recs.sort((a,b)=>a.off-b.off);

// ---- 2. Bucket size distribution.
const sizeHist = new Map();
for (const r of recs) sizeHist.set(r.size, (sizeHist.get(r.size)||0)+1);
const sortedBuckets = [...sizeHist.entries()].sort((a,b)=>b[1]-a[1]);
console.log("\n=== Size histogram (top 20) ===");
console.log("  size    count    cumulative");
let cum = 0;
for (let i = 0; i < Math.min(20, sortedBuckets.length); i++) {
  const [sz, c] = sortedBuckets[i];
  cum += c;
  console.log(`  ${String(sz).padStart(5)}    ${String(c).padStart(5)}    ${cum} (${(cum/recs.length*100).toFixed(1)}%)`);
}
console.log(`\ndistinct sizes: ${sizeHist.size}`);

// Coarser bucket: round to nearest 16 bytes for "size class" view.
const coarseHist = new Map();
for (const r of recs) {
  const k = Math.floor(r.size / 16) * 16;
  coarseHist.set(k, (coarseHist.get(k)||0)+1);
}
const coarseSorted = [...coarseHist.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 12);
console.log("\n=== Coarse size buckets (rounded down to /16) ===");
for (const [k,c] of coarseSorted) console.log(`  ${k}..${k+15} : ${c}`);

// ---- 3. For top 3 EXACT size buckets, dump first 3 records each.
console.log("\n\n=== TOP 3 EXACT SIZE BUCKETS — record dumps ===");
for (let bi = 0; bi < 3 && bi < sortedBuckets.length; bi++) {
  const [size, count] = sortedBuckets[bi];
  console.log(`\n--- Bucket #${bi+1}: size=${size} count=${count} ---`);
  const matched = recs.filter(r => r.size === size);
  for (let k = 0; k < Math.min(3, matched.length); k++) {
    const r = matched[k];
    console.log(`\n  Record ${k+1}/${count}  off=0x${r.off.toString(16)}  size=${size}`);
    // Hex+ascii of the payload, up to 96 bytes.
    const dumpLen = Math.min(96, size);
    const pay = buf.slice(r.payStart, r.payStart + dumpLen);
    for (let row = 0; row < Math.ceil(dumpLen/16); row++) {
      const base = row*16;
      const hex = [];
      const ascii = [];
      for (let c = 0; c < 16 && base+c < dumpLen; c++) {
        const b = pay[base+c];
        hex.push(b.toString(16).padStart(2,"0"));
        ascii.push(b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".");
      }
      console.log(`    +${String(base).padStart(3)}  ${hex.join(" ").padEnd(48)}  |${ascii.join("")}|`);
    }
    // ASCII strings in this record
    const strs = [];
    let cur = "";
    let curS = -1;
    for (let i = 0; i < size; i++) {
      const b = pay[i];
      if (b >= 0x20 && b < 0x7f) { if (!cur) curS = i; cur += String.fromCharCode(b); }
      else { if (cur.length >= 4) strs.push(`+${curS}:"${cur}"`); cur = ""; }
    }
    if (cur.length >= 4) strs.push(`+${curS}:"${cur}"`);
    if (strs.length) console.log(`    strings: ${strs.join(", ")}`);
  }
}

// ---- 4. Faction-id scan. RIS imperial has 239 factions (0..238).
// Count u32 occurrences across all records that match 0..238 at 4-byte aligned offsets.
console.log("\n\n=== Faction-id (0..238) hit map per record offset (first 64 bytes) ===");
const offHits = new Array(64).fill(0);
const offHitsTotal = new Array(64).fill(0);
for (const r of recs) {
  for (let off = 0; off + 4 <= Math.min(64, r.size); off += 4) {
    const v = buf.readUInt32LE(r.payStart + off);
    offHitsTotal[off]++;
    if (v >= 0 && v <= 238) offHits[off]++;
  }
}
console.log("  payload_off   hit_count   pct (u32 in 0..238 range)");
for (let off = 0; off < 64; off += 4) {
  const pct = offHitsTotal[off] > 0 ? (offHits[off]/offHitsTotal[off]*100).toFixed(1) : "  -";
  console.log(`    +${String(off).padStart(2)}        ${String(offHits[off]).padStart(5)}    ${pct}%`);
}

// ---- 5. Count how many distinct values appear at offset 0 (and 4) — if faction-keyed,
// the count of distinct values in payload[0..3] should be near 239 across records.
const distOff0 = new Set();
const distOff4 = new Set();
const distOff8 = new Set();
for (const r of recs) {
  if (r.size >= 4) distOff0.add(buf.readUInt32LE(r.payStart));
  if (r.size >= 8) distOff4.add(buf.readUInt32LE(r.payStart + 4));
  if (r.size >= 12) distOff8.add(buf.readUInt32LE(r.payStart + 8));
}
console.log(`\n  distinct u32 @ payload+0: ${distOff0.size}`);
console.log(`  distinct u32 @ payload+4: ${distOff4.size}`);
console.log(`  distinct u32 @ payload+8: ${distOff8.size}`);

// ---- 6. The "header before payload" might actually be elsewhere. The session-54
// finding was self-pointer at offset 4 (u32 at p equals p, then size at p+4).
// But some taw conventions have the self-pointer AFTER the size, i.e.
// {u32 size, u32 self_ptr=pos+4}. Check the relationship at our first record.
console.log("\n=== Header-convention sanity at first 5 records ===");
for (let i = 0; i < 5 && i < recs.length; i++) {
  const r = recs[i];
  const before8 = r.off >= 8 ? buf.readUInt32LE(r.off - 8) : null;
  const before4 = r.off >= 4 ? buf.readUInt32LE(r.off - 4) : null;
  const at0 = buf.readUInt32LE(r.off);
  const at4 = buf.readUInt32LE(r.off + 4);
  console.log(`  rec[${i}] off=0x${r.off.toString(16)} size=${r.size}  before-8=${before8} before-4=${before4} at0=0x${at0.toString(16)} at+4=${at4}`);
}

// ---- 7. Are records back-to-back (no gaps)?
let lastEnd = ZC_START;
let gapBytes = 0;
let gapCount = 0;
let overlap = 0;
for (const r of recs) {
  if (r.off > lastEnd) { gapBytes += r.off - lastEnd; gapCount++; }
  if (r.off < lastEnd) { overlap++; }
  if (r.payEnd > lastEnd) lastEnd = r.payEnd;
}
const tailGap = ZC_END - lastEnd;
console.log(`\n=== Layout ===`);
console.log(`  records consume up to: 0x${lastEnd.toString(16)} (zone ends 0x${ZC_END.toString(16)})`);
console.log(`  tail gap: ${tailGap}`);
console.log(`  inter-record gaps: ${gapCount} totaling ${gapBytes} B (${(gapBytes/(ZC_END-ZC_START)*100).toFixed(1)}% of zone)`);
console.log(`  overlapping records: ${overlap}`);

// ---- 8. Look at the 8 bytes immediately preceding Zone C start (might be a count).
console.log("\n=== Bytes 0x${(ZC_START-16).toString(16)}..ZC_START ===");
for (let p = ZC_START - 16; p < ZC_START + 16; p += 16) {
  const hex = [];
  const ascii = [];
  for (let c = 0; c < 16; c++) {
    const b = buf[p+c];
    hex.push(b.toString(16).padStart(2,"0"));
    ascii.push(b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".");
  }
  console.log(`  0x${p.toString(16).padStart(8,"0")}  ${hex.join(" ")}  |${ascii.join("")}|`);
}
console.log(`  u32 @ ZC_START-4 = ${buf.readUInt32LE(ZC_START - 4)}`);
console.log(`  u32 @ ZC_START-8 = ${buf.readUInt32LE(ZC_START - 8)}`);
console.log(`  u32 @ ZC_START-12 = ${buf.readUInt32LE(ZC_START - 12)}`);
