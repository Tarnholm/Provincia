// dig-upkeep6.js — session 9
//
// Fix stride detection: I want records where adjacent records start 354 bytes apart,
// each record carrying two self-pointers 16 bytes apart (positions p and p+16).
// In rome5 these are at offsets +40719, +41073, +41427, +41781, +42135, +42489, +42843,
// +43197, +43551, +43905, +44259 (relative to player record start).

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

// Build a run of gap-16 pairs whose first ptr advances by `stride`
function findStrideRuns(sp, stride, minLen = 4) {
  const pairs = [];
  for (let i = 0; i < sp.length - 1; i++) {
    if (sp[i + 1] === sp[i] + 16) pairs.push(sp[i]);
  }
  // Find runs of pairs separated by exactly `stride`
  const runs = [];
  let i = 0;
  while (i < pairs.length) {
    let j = i;
    while (j + 1 < pairs.length && pairs[j + 1] - pairs[j] === stride) j++;
    if (j - i + 1 >= minLen) {
      runs.push({ start: pairs[i], end: pairs[j], count: j - i + 1, stride });
    }
    i = j + 1;
  }
  return runs;
}

function findAllStrideRuns(sp) {
  const pairs = [];
  for (let i = 0; i < sp.length - 1; i++) {
    if (sp[i + 1] === sp[i] + 16) pairs.push(sp[i]);
  }
  // For every pair, check if there's another pair at +N for various N
  // Collect strides
  const strideCounts = {};
  for (let i = 0; i < pairs.length - 1; i++) {
    const s = pairs[i + 1] - pairs[i];
    if (s > 16 && s < 5000) {
      strideCounts[s] = (strideCounts[s] || 0) + 1;
    }
  }
  // Top strides
  const topStrides = Object.entries(strideCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  return { topStrides, pairs };
}

const r5 = fs.readFileSync(path.join(SAVES, "save_rome5..sav"));
const r6 = fs.readFileSync(path.join(SAVES, "save_rome6.sav"));
const r7 = fs.readFileSync(path.join(SAVES, "save_rome7.sav"));
const r10 = fs.readFileSync(path.join(SAVES, "save_rome10.sav"));

for (const [label, buf] of [["rome5", r5], ["rome6", r6], ["rome7", r7], ["rome10", r10]]) {
  const recs = findMajorRecords(buf);
  const p = recs[0];
  const next = recs[1];
  const sp = findSelfPointers(buf, p.pos, next.pos);
  const { topStrides, pairs } = findAllStrideRuns(sp);
  console.log(`\n=== ${label} player rec (0x${p.pos.toString(16)}..0x${next.pos.toString(16)}, ${sp.length} self-ptrs, ${pairs.length} gap-16 pairs) ===`);
  console.log("Top strides between consecutive gap-16 pairs:");
  for (const [s, c] of topStrides) console.log(`  stride=${s}: ${c} occurrences`);

  // Look for stride=354 runs
  const runs354 = findStrideRuns(sp, 354, 4);
  console.log(`Stride-354 runs (≥4 records):`);
  for (const r of runs354) {
    console.log(`  ${r.count} records from 0x${r.start.toString(16)} (rel +${r.start - p.pos}) to 0x${r.end.toString(16)} (rel +${r.end - p.pos})`);
  }
}

// Now, in rome5, dump rec interior for first stride-354 run
const recs5 = findMajorRecords(r5);
const recs7 = findMajorRecords(r7);
const recs10 = findMajorRecords(r10);
const p5 = recs5[0], p7 = recs7[0], p10 = recs10[0];
const sp5 = findSelfPointers(r5, p5.pos, recs5[1].pos);
const sp7 = findSelfPointers(r7, p7.pos, recs7[1].pos);
const sp10 = findSelfPointers(r10, p10.pos, recs10[1].pos);
const runs5 = findStrideRuns(sp5, 354, 4);
const runs7 = findStrideRuns(sp7, 354, 4);
const runs10 = findStrideRuns(sp10, 354, 4);

console.log(`\n\n=== rome5 stride-354 run records ===`);
if (runs5.length > 0) {
  const run = runs5[0];
  console.log(`Records: ${run.count}`);
  for (let i = 0; i < run.count; i++) {
    const pos = run.start + i * 354;
    const u_sub_size = r5.readUInt32LE(pos + 20);
    // After two self-pointers and the sub_size, look at u32s in payload
    console.log(`Rec ${i} at 0x${pos.toString(16)} (rel +${pos - p5.pos}):`);
    const dwords = [];
    for (let d = 0; d < 30; d++) dwords.push(r5.readUInt32LE(pos + d * 4));
    console.log(`  u32s: ${dwords.map(d => d > 1e9 ? "PTR" : String(d)).join(' ')}`);
  }
}

console.log(`\n\n=== rome7 stride-354 run records ===`);
if (runs7.length > 0) {
  const run = runs7[0];
  for (let i = 0; i < run.count; i++) {
    const pos = run.start + i * 354;
    const dwords = [];
    for (let d = 0; d < 30; d++) dwords.push(r7.readUInt32LE(pos + d * 4));
    console.log(`Rec ${i} at 0x${pos.toString(16)} (rel +${pos - p7.pos}):`);
    console.log(`  u32s: ${dwords.map(d => d > 1e9 ? "PTR" : String(d)).join(' ')}`);
  }
}

console.log(`\n\n=== rome10 stride-354 run records (different session) ===`);
if (runs10.length > 0) {
  const run = runs10[0];
  for (let i = 0; i < run.count; i++) {
    const pos = run.start + i * 354;
    const dwords = [];
    for (let d = 0; d < 30; d++) dwords.push(r10.readUInt32LE(pos + d * 4));
    console.log(`Rec ${i} at 0x${pos.toString(16)} (rel +${pos - p10.pos}):`);
    console.log(`  u32s: ${dwords.map(d => d > 1e9 ? "PTR" : String(d)).join(' ')}`);
  }
}
