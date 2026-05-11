// dig-tail-tilegrid9.js — There are 239 records, exactly the RIS faction count.
// This is the per-faction tile-mask record array!
// Each record has a 1020 x 700 (or some scaled-down version) tile grid showing
// either: (a) what tiles this faction has DISCOVERED (shroud / fog-of-war state),
// or (b) what tiles this faction CONTROLS, or (c) some other per-faction map overlay.
//
// We saw 0x3fc=1020 and 0x2bc=700 as constant fields. These could be:
//   width=1020, height=700 = 714,000 cells = 1,428,000 bytes (close to median record size of 6002)
//   But 6002 bytes is too few for 714,000 cells.
//
// Actually each record's "tile data" is the variable-length payload. Each record
// has different payload sizes (5,868..7,811 typical) implying RLE compression or
// a sparse representation.
//
// Goal:
// 1. Cross-save BYTE-FOR-BYTE diff each record. Do they all match across rome10/RoR-T1?
//    That would show the data is static-per-campaign (e.g., the campaign-region
//    bitmap). If they DIFFER, then it's per-turn dynamic state (shroud).
// 2. What's the size correlation? Is record[i] size correlated to faction[i] historical
//    map area?
// 3. Look at the actual payload pattern.

const fs = require("fs");

const ROME10 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const ROR_T1 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav";

function load(savePath) {
  const buf = fs.readFileSync(savePath);
  // find records
  const records = [];
  for (let p = 0x1f00000; p < buf.length - 16; p++) {
    if (buf[p] === 0xf0 && buf[p+1] === 0x0a && buf[p+2] === 0xaf && buf[p+3] === 0xf0) {
      const a = buf.readUInt32LE(p + 4);
      const b = buf.readUInt32LE(p + 8);
      if (a === 0x3fc && b === 0x2bc) {
        records.push(p - 8); // p-8 is start of selfPtr pair
      }
    }
  }
  return { buf, records };
}

const r10 = load(ROME10);
const rT1 = load(ROR_T1);

console.log(`rome10 records: ${r10.records.length}`);
console.log(`RoR-T1 records: ${rT1.records.length}`);

// Build "records" with length (next record - this record)
function recordLengths(buf, records) {
  const out = [];
  for (let i = 0; i < records.length; i++) {
    const next = i + 1 < records.length ? records[i + 1] - 0 : buf.length;
    // Strip the preceding "header" bytes that belong to the NEXT record
    // (the model-name strings, etc.). But for spacing, just use next - this.
    out.push(next - records[i]);
  }
  return out;
}

const len10 = recordLengths(r10.buf, r10.records);
const lenT1 = recordLengths(rT1.buf, rT1.records);

// Are the record lengths matched 1:1 across saves?
let lenMatches = 0;
const mismatchSamples = [];
for (let i = 0; i < Math.min(len10.length, lenT1.length); i++) {
  if (len10[i] === lenT1[i]) lenMatches++;
  else if (mismatchSamples.length < 10) mismatchSamples.push({ i, len10: len10[i], lenT1: lenT1[i] });
}
console.log(`Record length matches: ${lenMatches} / ${Math.min(len10.length, lenT1.length)}`);
if (mismatchSamples.length > 0) {
  console.log(`Mismatches: ${JSON.stringify(mismatchSamples)}`);
}

// Now byte-diff each record (treating each rec as a slice of its own length)
let totalSame = 0, totalDiff = 0;
const perRecDiffs = [];
for (let i = 0; i < Math.min(len10.length, lenT1.length); i++) {
  const r10base = r10.records[i];
  const rT1base = rT1.records[i];
  const n = Math.min(len10[i], lenT1[i]);
  let same = 0, diff = 0;
  for (let k = 0; k < n; k++) {
    if (r10.buf[r10base + k] === rT1.buf[rT1base + k]) same++; else diff++;
  }
  perRecDiffs.push({ i, same, diff, len: n });
  totalSame += same; totalDiff += diff;
}
console.log(`Total byte diff: ${totalDiff} / ${totalSame + totalDiff}`);
const diffySamples = perRecDiffs.filter(r => r.diff > 0).sort((a, b) => b.diff - a.diff);
console.log(`Records with byte diffs: ${diffySamples.length}`);
console.log(`Top 15 most-changed records:`);
for (const r of diffySamples.slice(0, 15)) console.log(`  rec[${r.i}] len=${r.len}: same=${r.same} diff=${r.diff}`);

// Now: hypothesis A — these are per-faction records emitted in faction order.
// Session 7's faction-record array has 239 entries (RIS imperial has 23 majors + 216 minors).
// Let me cross-reference with the major-faction record list to confirm.
// Actually, since I don't have the faction record offsets pre-computed, let me just
// look at the size distribution: factions with bigger empires should have larger records.

console.log(`\nLength distribution (rome10):`);
const sorted = [...len10].sort((a, b) => a - b);
console.log(`  min=${sorted[0]}, p10=${sorted[Math.floor(sorted.length * 0.1)]}, p50=${sorted[Math.floor(sorted.length * 0.5)]}, p90=${sorted[Math.floor(sorted.length * 0.9)]}, p99=${sorted[Math.floor(sorted.length * 0.99)]}, max=${sorted[sorted.length - 1]}`);
console.log(`  largest 12 records' indices and sizes:`);
const indexed = len10.map((l, i) => ({ i, l }));
indexed.sort((a, b) => b.l - a.l);
for (let k = 0; k < 12; k++) console.log(`    rec[${indexed[k].i}]: ${indexed[k].l} bytes`);

console.log(`\nSmallest 5 records:`);
indexed.sort((a, b) => a.l - b.l);
for (let k = 0; k < 5; k++) console.log(`    rec[${indexed[k].i}]: ${indexed[k].l} bytes`);

// Look at record 0 (which had different header pattern — X=0, Y=50331648):
console.log(`\nRecord 0 (special) — first 96 bytes hex:`);
for (let row = 0; row < 6; row++) {
  const o = r10.records[0] + row * 16;
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 16; j++) {
    const b = r10.buf[o + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  console.log(`  0x${o.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
}

// Look at the payload structure: starting at p+20 (after the 5 u32s + magic), is there
// a recognizable u32 sequence?
console.log(`\nRecord 1 payload at +20..+96 (after the 20-byte header):`);
{
  const start = r10.records[1] + 20;
  for (let row = 0; row < 6; row++) {
    const o = start + row * 16;
    const hex = [];
    for (let j = 0; j < 16; j++) hex.push(r10.buf[o + j].toString(16).padStart(2, "0"));
    console.log(`  0x${o.toString(16)}: ${hex.join(" ")}`);
  }
}

// Critical question: 0x3fc = 1020, 0x2bc = 700. The product is 714000. Maybe this is
// the tile-grid dimension for each faction? The whole campaign map is 255×156 (vanilla),
// so why 1020×700? Maybe 4x scale = 1020/4 = 255, 700/4 = 175 ≈ 156. Not quite.
// Or: the strategic map is 1020 × 700 pixels in some texture representation.
// Or these are bytes that index a separate tile attribute table.
//
// 1020 × 700 = 714,000 bits = 89,250 bytes per record if RLE-compressed. The median
// record size is 6002 bytes, so for a typical empire, ~93% RLE compression.
console.log(`\nAnalysis: if each record encodes a 1020x700 mask, the cells / byte ratios:`);
console.log(`  1020 * 700 = ${1020 * 700} cells. At median 6002 bytes payload: ${(1020*700/6002).toFixed(2)} cells/byte`);

// Verify the consistent (1020, 700) values across all records
let f12_3fc = 0, f16_2bc = 0;
for (const p of r10.records) {
  if (r10.buf.readUInt32LE(p + 12) === 0x3fc) f12_3fc++;
  if (r10.buf.readUInt32LE(p + 16) === 0x2bc) f16_2bc++;
}
console.log(`  Records with +12 == 0x3fc (1020): ${f12_3fc} / ${r10.records.length}`);
console.log(`  Records with +16 == 0x2bc (700): ${f16_2bc} / ${r10.records.length}`);
