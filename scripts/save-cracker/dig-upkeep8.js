// dig-upkeep8.js — properly detect stride-354 runs by checking BOTH ptrs at p and p+16.
//
// Each record at relative +rel has the structure:
//   p+0  u32 = p+0  (self-ptr 1)
//   p+4  u32 = p+4  (self-ptr 2 from gap=4 — could be different shape)
//   p+16 u32 = p+16 (self-ptr 3, "inner section start")
//   p+20 ... payload

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

// Find any positions where the byte pattern looks like a triple self-ptr (at p, p+4, p+16)
function findTripleAnchors(buf, start, end) {
  const out = [];
  for (let i = start; i + 20 < end; i++) {
    if (buf.readUInt32LE(i) !== i) continue;
    if (buf.readUInt32LE(i + 4) !== i + 4) continue;
    if (buf.readUInt32LE(i + 16) !== i + 16) continue;
    out.push(i);
  }
  return out;
}

const r5 = fs.readFileSync(path.join(SAVES, "save_rome5..sav"));
const r6 = fs.readFileSync(path.join(SAVES, "save_rome6.sav"));
const r7 = fs.readFileSync(path.join(SAVES, "save_rome7.sav"));
const r10 = fs.readFileSync(path.join(SAVES, "save_rome10.sav"));

for (const [label, buf] of [["rome5", r5], ["rome6", r6], ["rome7", r7], ["rome10", r10]]) {
  const recs = findMajorRecords(buf);
  const p = recs[0];
  const next = recs[1];
  const anchors = findTripleAnchors(buf, p.pos, next.pos);
  // Find stride-354 runs
  const runs = [];
  let i = 0;
  while (i < anchors.length) {
    let j = i;
    while (j + 1 < anchors.length && anchors[j + 1] - anchors[j] === 354) j++;
    if (j - i + 1 >= 4) {
      runs.push({ start: anchors[i], end: anchors[j], count: j - i + 1 });
    }
    i = j + 1;
  }
  console.log(`\n${label} player rec: ${anchors.length} triple-anchors`);
  for (const r of runs) {
    console.log(`  Stride-354 run: ${r.count} records from 0x${r.start.toString(16)} (rel +${r.start - p.pos}) to 0x${r.end.toString(16)}`);
  }
}

// Now dump the rome5 run records
const recs5 = findMajorRecords(r5);
const recs7 = findMajorRecords(r7);
const recs10 = findMajorRecords(r10);
const p5 = recs5[0], p7 = recs7[0], p10 = recs10[0];
const anchors5 = findTripleAnchors(r5, p5.pos, recs5[1].pos);
const anchors7 = findTripleAnchors(r7, p7.pos, recs7[1].pos);
const anchors10 = findTripleAnchors(r10, p10.pos, recs10[1].pos);

function getStrideRun(anchors, stride, minLen) {
  let i = 0;
  while (i < anchors.length) {
    let j = i;
    while (j + 1 < anchors.length && anchors[j + 1] - anchors[j] === stride) j++;
    if (j - i + 1 >= minLen) return { start: anchors[i], end: anchors[j], count: j - i + 1 };
    i = j + 1;
  }
  return null;
}

const run5 = getStrideRun(anchors5, 354, 4);
const run7 = getStrideRun(anchors7, 354, 4);
const run10 = getStrideRun(anchors10, 354, 4);

function dumpRun(buf, run, label, pStart) {
  if (!run) return;
  console.log(`\n=== ${label}: ${run.count} records from 0x${run.start.toString(16)} (rel +${run.start - pStart}) ===`);
  for (let i = 0; i < run.count; i++) {
    const pos = run.start + i * 354;
    const u32s = [];
    for (let d = 0; d < 30; d++) u32s.push(buf.readUInt32LE(pos + d * 4));
    const formatted = u32s.map((v, idx) => {
      const off = idx * 4;
      if (v === pos + off) return "SELF";  // self-pointer
      if (v > 1e9) return "PTR";
      const s = v > 2 ** 31 ? v - 2 ** 32 : v;
      return String(s);
    });
    console.log(`  Rec ${i} @ 0x${pos.toString(16)}: ${formatted.join(' ')}`);
  }
}

dumpRun(r5, run5, "rome5", p5.pos);
dumpRun(r7, run7, "rome7", p7.pos);
dumpRun(r10, run10, "rome10", p10.pos);

// Now hex-dump rec 0 in rome5 and rome7 to see the structure
function hex(buf, pos, len) {
  const out = [];
  for (let i = 0; i < len; i += 16) {
    const slice = buf.slice(pos + i, pos + Math.min(i + 16, len));
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(slice).map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
    out.push(`  +${i.toString().padStart(3)}: ${hex.padEnd(48)} | ${ascii}`);
  }
  return out.join('\n');
}

if (run5) {
  console.log("\n=== rome5 rec 0 hex dump (full 354 bytes) ===");
  console.log(hex(r5, run5.start, 354));
}
if (run7) {
  console.log("\n=== rome7 rec 0 hex dump (full 354 bytes) ===");
  console.log(hex(r7, run7.start, 354));
}
