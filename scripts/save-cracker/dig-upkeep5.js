// dig-upkeep5.js — session 9
//
// Found a candidate array in player record at +40719: 11 records of 354-byte stride,
// each with a gap=16 self-pointer pair and a small u32 after (292, 246, 289, ...).
//
// Strategy:
//   1. Dump one of these 354-byte records in detail.
//   2. Compare rome5 vs rome7 to see what changed.
//   3. Cross-compare with Carthage's record in same offsets - or find the equivalent
//      354-stride array there (may or may not exist).
//   4. The "small u32 after second self-ptr" could be unit/army upkeep cost.

const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function findMajorRecords(buf) {
  const hits = [];
  for (let i = 0; i + 64 < buf.length; i += 1) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 32) !== 0 || buf.readUInt32LE(i + 36) !== 0) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    const regionCount = buf.readUInt32LE(i + 48);
    if (regionCount > 200) continue;
    const treasury = buf.readInt32LE(i);
    hits.push({ pos: i, treasury, regionCount });
  }
  return hits;
}

function findSelfPointers(buf, start, end) {
  const out = [];
  for (let i = start; i + 4 <= end; i += 1) {
    if (buf.readUInt32LE(i) === i) out.push(i);
  }
  return out;
}

const r5 = fs.readFileSync(path.join(SAVES, "save_rome5..sav"));
const r6 = fs.readFileSync(path.join(SAVES, "save_rome6.sav"));
const r7 = fs.readFileSync(path.join(SAVES, "save_rome7.sav"));
const r10 = fs.readFileSync(path.join(SAVES, "save_rome10.sav"));
const r5recs = findMajorRecords(r5);
const r6recs = findMajorRecords(r6);
const r7recs = findMajorRecords(r7);
const r10recs = findMajorRecords(r10);

const p5 = r5recs[0], p6 = r6recs[0], p7 = r7recs[0], p10 = r10recs[0];

// The 354-byte stride array seems to start at +40719 in rome5.
// Let me find the equivalent in rome7 (where the player record has shifted).

// Locate by structural signature: look for gap=16 self-ptr pairs with sub_size 200..400 range.
function findStrideArray(buf, start, end) {
  const sp = findSelfPointers(buf, start, end);
  const arrays = [];
  // Group consecutive gap-16 pairs
  for (let i = 0; i < sp.length; i++) {
    if (i + 1 < sp.length && sp[i + 1] === sp[i] + 16) {
      // This is a gap=16 pair. Now look ahead for more pairs at +354 stride.
      const stride = 354;
      const startPair = sp[i];
      let n = 1;
      let next = sp[i] + stride;
      while (n < 25) {
        // Look for a self-pointer at `next` (or close to it)
        const found = sp.find(p => p === next);
        if (!found) break;
        n++;
        next += stride;
      }
      if (n >= 5) {
        arrays.push({ start: startPair, count: n, stride });
      }
    }
  }
  return arrays;
}

console.log("=== Stride arrays in player records ===");
for (const [label, buf, rec, recsNext] of [
  ["rome5", r5, p5, r5recs[1]],
  ["rome6", r6, p6, r6recs[1]],
  ["rome7", r7, p7, r7recs[1]],
  ["rome10", r10, p10, r10recs[1]],
]) {
  const arrays = findStrideArray(buf, rec.pos, recsNext.pos);
  console.log(`\n${label} player rec (0x${rec.pos.toString(16)}..0x${recsNext.pos.toString(16)}):`);
  for (const a of arrays) {
    console.log(`  ${a.count} records of ${a.stride} bytes starting at 0x${a.start.toString(16)} (rel +${a.start - rec.pos})`);
  }
}

// Now dump record content for the first 354-byte array in rome5 and rome7
function dumpArrayContent(buf, rec, recsNext, label) {
  const arrays = findStrideArray(buf, rec.pos, recsNext.pos);
  if (arrays.length === 0) { console.log(`${label}: no array found`); return null; }
  const a = arrays[0];
  console.log(`\n=== ${label}: ${a.count} records of ${a.stride} bytes from 0x${a.start.toString(16)} ===`);
  console.log("idx | rel    | first_u32 | sub_size | next u32s ...");
  for (let i = 0; i < a.count; i++) {
    const pos = a.start + i * a.stride;
    const sub_size = buf.readUInt32LE(pos + 20);  // after second self-pointer (pos+16)
    const u32_24 = buf.readUInt32LE(pos + 24);
    const u32_28 = buf.readUInt32LE(pos + 28);
    const u32_32 = buf.readUInt32LE(pos + 32);
    const u32_36 = buf.readUInt32LE(pos + 36);
    const u32_40 = buf.readUInt32LE(pos + 40);
    console.log(`${String(i).padStart(2)}  | +${(pos - rec.pos).toString().padStart(6)} | 0x${pos.toString(16)} | ${String(sub_size).padStart(7)} | ${String(u32_24).padStart(8)} ${String(u32_28).padStart(8)} ${String(u32_32).padStart(8)} ${String(u32_36).padStart(8)} ${String(u32_40).padStart(8)}`);
  }
  return a;
}

dumpArrayContent(r5, p5, r5recs[1], "rome5");
dumpArrayContent(r7, p7, r7recs[1], "rome7");

// Now: hex-dump one of the 354-byte records for visual inspection
const a5 = findStrideArray(r5, p5.pos, r5recs[1].pos)[0];
const a7 = findStrideArray(r7, p7.pos, r7recs[1].pos)[0];
if (a5 && a7) {
  console.log("\n\n=== rome5 record 0 hex dump (354 bytes) ===");
  for (let i = 0; i < 354; i += 16) {
    const slice = r5.slice(a5.start + i, a5.start + Math.min(i + 16, 354));
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(slice).map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
    console.log(`  +${i.toString().padStart(3)}: ${hex.padEnd(48)} | ${ascii}`);
  }
  console.log("\n=== rome7 record 0 hex dump (354 bytes) ===");
  for (let i = 0; i < 354; i += 16) {
    const slice = r7.slice(a7.start + i, a7.start + Math.min(i + 16, 354));
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(slice).map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
    console.log(`  +${i.toString().padStart(3)}: ${hex.padEnd(48)} | ${ascii}`);
  }
}
