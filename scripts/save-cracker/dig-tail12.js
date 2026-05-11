// dig-tail12.js — Decode the chunked tile-trail array.
//
// Pattern observed:
//   [u32 chunk_count (often 7)]
//   [chunk_count × records of the form:
//      [u32 self_ptr][u16 count][count × (u32 X, u32 Y)]
//   ]
// Then next chunk_count, then another batch of records.

const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);
const fileEnd = buf.length;

// Walk records using strict self-ptr-followed-by-count rule.
function decodeArray(start, maxLen) {
  const recs = [];
  let p = start;
  while (p + 6 <= start + maxLen && p + 6 <= fileEnd) {
    const sp = buf.readUInt32LE(p);
    if (sp !== p) return { recs, stopAt: p, reason: `non-self-ptr at 0x${p.toString(16)} (got 0x${sp.toString(16)})` };
    const cnt = buf.readUInt16LE(p + 4);
    if (cnt > 50 || p + 6 + cnt * 8 > start + maxLen) return { recs, stopAt: p, reason: `bad count ${cnt} at 0x${p.toString(16)}` };
    const pairs = [];
    for (let i = 0; i < cnt; i++) {
      pairs.push([buf.readUInt32LE(p + 6 + i * 8), buf.readUInt32LE(p + 6 + i * 8 + 4)]);
    }
    recs.push({ off: p, count: cnt, pairs });
    p += 6 + cnt * 8;
  }
  return { recs, stopAt: p, reason: "max-len" };
}

// Scan from 0x1f10c72 forward, find ALL chunks of this structure.
// Strategy: when a u32 at position p equals p, we might be in a chunk.
console.log("=== Find all chunks throughout the tail ===");
const tailStart = 0x1f10c72;

const chunks = [];
let p = tailStart;
while (p < fileEnd - 6) {
  // Try to start a chunk here. First u32 = chunk_count.
  const cc = buf.readUInt32LE(p);
  if (cc < 1 || cc > 1000) { p++; continue; }
  // Try decoding cc consecutive records starting at p+4.
  let q = p + 4;
  let valid = true;
  let total = 0;
  let recs = [];
  for (let i = 0; i < cc; i++) {
    if (q + 6 > fileEnd) { valid = false; break; }
    const sp = buf.readUInt32LE(q);
    if (sp !== q) { valid = false; break; }
    const ct = buf.readUInt16LE(q + 4);
    if (ct > 50) { valid = false; break; }
    if (q + 6 + ct * 8 > fileEnd) { valid = false; break; }
    recs.push({ off: q, count: ct });
    q += 6 + ct * 8;
    total++;
  }
  if (valid && total >= 2) {
    chunks.push({ chunkOff: p, count: cc, end: q, totalRecs: total, sampleRec: recs.slice(0, 2) });
    p = q;
  } else {
    p++;
  }
}
console.log(`Total chunks found: ${chunks.length}`);
console.log("First 5 chunks:");
for (let i = 0; i < Math.min(5, chunks.length); i++) {
  const c = chunks[i];
  console.log(`  [${i}] @0x${c.chunkOff.toString(16)} count=${c.count} ends@0x${c.end.toString(16)}`);
}
console.log("Last 5 chunks:");
for (let i = Math.max(0, chunks.length - 5); i < chunks.length; i++) {
  const c = chunks[i];
  console.log(`  [${i}] @0x${c.chunkOff.toString(16)} count=${c.count} ends@0x${c.end.toString(16)}`);
}

// Where does the BIGGEST chunk array live?
console.log("\nLargest 10 chunks by count:");
const sorted = [...chunks].sort((a, b) => b.count - a.count);
for (let i = 0; i < Math.min(10, sorted.length); i++) {
  const c = sorted[i];
  console.log(`  [${i}] @0x${c.chunkOff.toString(16)} count=${c.count} ends@0x${c.end.toString(16)}`);
}

// Sum total records across all chunks
const totalRecs = chunks.reduce((s, c) => s + c.totalRecs, 0);
console.log(`\nTotal records across all chunks: ${totalRecs}`);
console.log(`Coverage: 0x${tailStart.toString(16)} - 0x${fileEnd.toString(16)} = ${fileEnd - tailStart} bytes`);
const chunkBytes = chunks.reduce((s, c) => s + (c.end - c.chunkOff), 0);
console.log(`Bytes covered by chunks: ${chunkBytes} (${(100 * chunkBytes / (fileEnd - tailStart)).toFixed(1)}%)`);
