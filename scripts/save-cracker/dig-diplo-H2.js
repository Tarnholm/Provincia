// dig-diplo-H2.js — session 109 step H2
//
// H discovered there are MANY 16B-stride arrays with `01 01 01 00` markers
// OUTSIDE the 23 known major records. These could be:
//   a) inside NPC faction records (also store diplomacy)
//   b) inside a separate global diplomacy section
//
// Test: locate each novel hit and tell if it lives inside an NPC faction
// record (ff 0a af f0 magic). Also: are there exactly 23 + 238 = 261 such
// arrays? (i.e., every faction including NPCs has one.)
//
// Also: re-examine the 0x39240005 marker scan. Is it present in NPC records
// too? Session 108 said NO (0/231 hits). But there were 33 novel hits in
// the global stride-16 scan — what marker precedes them?
//
// Usage: node dig-diplo-H2.js
"use strict";

const fs = require("fs");
const path = require("path");
const { findFactionRecords } = require("../../src/factionRecordParser");

const SAVE = path.join(__dirname, "fixtures", "feral", "save_10_fresh.sav");
const buf = fs.readFileSync(SAVE);

function readMajor(b) {
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

const majors = readMajor(buf);
const npcRecs = findFactionRecords(buf);
console.log(`Majors: ${majors.length}, NPC ff0aaff0 records: ${npcRecs.length}`);

// Find every run-of-4+ of "01 01 01 00" at stride 16 (as in H)
const hits = [];
for (let i = 12; i + 64 < buf.length; i++) {
  if (buf[i] !== 0x01 || buf[i + 1] !== 0x01 || buf[i + 2] !== 0x01 || buf[i + 3] !== 0x00) continue;
  if (buf[i + 16] !== 0x01 || buf[i + 17] !== 0x01 || buf[i + 18] !== 0x01 || buf[i + 19] !== 0x00) continue;
  let run = 1;
  let p = i;
  while (p + 16 < buf.length && buf[p + 16] === 0x01 && buf[p + 17] === 0x01 && buf[p + 18] === 0x01 && buf[p + 19] === 0x00) {
    p += 16;
    run++;
  }
  if (run >= 4) hits.push({ start: i, run, end: p + 4, structStart: i - 12 });
  i = p + 4;
}
console.log(`Total hits: ${hits.length}`);

// Locate each hit: inside major / inside NPC ?
const majorPosSet = new Set(majors.map((m) => m.pos));
function findOwner(off) {
  // Check majors first
  for (let i = 0; i < majors.length; i++) {
    const m = majors[i];
    // Major record can be up to 16KB
    const start = m.pos;
    const end = i + 1 < majors.length ? majors[i + 1].pos : m.pos + 16384;
    if (off >= start && off < end) return { type: "major", idx: i, recOffset: m.pos };
  }
  // Then NPCs
  for (let i = 0; i < npcRecs.length; i++) {
    const r = npcRecs[i];
    if (off >= r.offset && off < r.offset + r.size) return { type: "npc", idx: i, recOffset: r.offset, size: r.size };
  }
  return { type: "other" };
}

const counts = { major: 0, npc: 0, other: 0 };
const otherHits = [];
const npcHits = [];
for (const h of hits) {
  const owner = findOwner(h.structStart);
  counts[owner.type]++;
  if (owner.type === "other") otherHits.push({ ...h, owner });
  if (owner.type === "npc") npcHits.push({ ...h, owner });
}
console.log(`\nHits by container: major=${counts.major} npc=${counts.npc} other=${counts.other}`);

console.log(`\n=== First 10 NPC hits ===`);
npcHits.slice(0, 10).forEach((h) => {
  console.log(`  hit at 0x${h.structStart.toString(16)} run=${h.run} npc[${h.owner.idx}] (rec@0x${h.owner.recOffset.toString(16)} size=${h.owner.size}) rel=${h.structStart - h.owner.recOffset}`);
});

console.log(`\n=== First 10 OTHER hits (outside any faction record) ===`);
otherHits.slice(0, 10).forEach((h) => {
  console.log(`  hit at 0x${h.structStart.toString(16)} run=${h.run}`);
});

// Compute marker preceding NPC hits (the 8 bytes BEFORE structStart of run-1)
console.log(`\n=== Marker preceding NPC hits ===`);
const markerMap = {};
for (const h of npcHits) {
  const mOff = h.structStart - 4; // u32 count
  const m2Off = mOff - 4; // u32 marker
  const marker = buf.readUInt32LE(m2Off);
  const count = buf.readUInt32LE(mOff);
  const key = marker.toString(16).padStart(8, "0");
  markerMap[key] = (markerMap[key] || 0) + 1;
}
Object.entries(markerMap).forEach(([k, v]) => console.log(`  marker=0x${k} count=${v}`));

// Same for "other" hits
console.log(`\n=== Marker preceding OTHER hits ===`);
const otherMarkerMap = {};
for (const h of otherHits) {
  const m2Off = h.structStart - 8;
  if (m2Off < 0) continue;
  const marker = buf.readUInt32LE(m2Off);
  const count = buf.readUInt32LE(m2Off + 4);
  const key = marker.toString(16).padStart(8, "0");
  otherMarkerMap[key] = (otherMarkerMap[key] || 0) + 1;
}
Object.entries(otherMarkerMap).forEach(([k, v]) => console.log(`  marker=0x${k} count=${v}`));

// For each NPC record, check if it has a 0x39240005 marker (session 108
// scanned only the first hit; let's redo it properly).
console.log(`\n=== NPC records containing 0x39240005 marker ===`);
let npcMarkerHits = 0;
const npcMarkerSamples = [];
for (let r = 0; r < npcRecs.length; r++) {
  const rec = npcRecs[r];
  for (let i = rec.offset; i + 4 <= rec.offset + rec.size; i++) {
    if (buf[i] === 0x05 && buf[i + 1] === 0x00 && buf[i + 2] === 0x24 && buf[i + 3] === 0x39) {
      npcMarkerHits++;
      if (npcMarkerSamples.length < 5) {
        const count = buf.readUInt32LE(i + 4);
        npcMarkerSamples.push({ recIdx: r, rel: i - rec.offset, recSize: rec.size, count });
      }
      break;
    }
  }
}
console.log(`  hits: ${npcMarkerHits}/${npcRecs.length}`);
console.log(`  samples:`, npcMarkerSamples);

// DEEPER: for the npcMarkerHits, dump first few entries
if (npcMarkerSamples.length > 0) {
  for (const s of npcMarkerSamples.slice(0, 3)) {
    const rec = npcRecs[s.recIdx];
    const markerAbs = rec.offset + s.rel;
    console.log(`\n  NPC[${s.recIdx}] (rec@0x${rec.offset.toString(16)} size=${rec.size}) marker@+${s.rel} count=${s.count}`);
    for (let i = 0; i < Math.min(s.count, 6); i++) {
      const off = markerAbs + 8 + i * 16;
      console.log(`    [${i}] A=${buf.readUInt32LE(off)} B=${buf.readUInt32LE(off + 4)} C=${buf.readUInt32LE(off + 8)} D=0x${buf.readUInt32LE(off + 12).toString(16).padStart(8, "0")}`);
    }
  }
}

// HYPOTHESIS: if relations live in BOTH major AND NPC records, the same
// A value (relation UUID) should appear in TWO faction records (one per
// side of the pair). Test this!
function collectAFromMajor(m) {
  const markerOff = m.pos + 244 + 4 * m.regions;
  if (buf[markerOff] !== 0x05 || buf[markerOff + 1] !== 0x00 || buf[markerOff + 2] !== 0x24 || buf[markerOff + 3] !== 0x39) return [];
  const count = buf.readUInt32LE(markerOff + 4);
  const out = [];
  for (let i = 0; i < count; i++) {
    const off = markerOff + 8 + i * 16;
    out.push({ A: buf.readUInt32LE(off), B: buf.readUInt32LE(off + 4), C: buf.readUInt32LE(off + 8) });
  }
  return out;
}

function collectAFromNpc(r) {
  for (let i = r.offset; i + 4 <= r.offset + r.size; i++) {
    if (buf[i] === 0x05 && buf[i + 1] === 0x00 && buf[i + 2] === 0x24 && buf[i + 3] === 0x39) {
      const count = buf.readUInt32LE(i + 4);
      const out = [];
      for (let k = 0; k < count; k++) {
        const off = i + 8 + k * 16;
        out.push({ A: buf.readUInt32LE(off), B: buf.readUInt32LE(off + 4), C: buf.readUInt32LE(off + 8) });
      }
      return { rel: i - r.offset, count, entries: out };
    }
  }
  return null;
}

const majorEntries = majors.map((m, i) => ({ idx: i, type: "major", entries: collectAFromMajor(m) }));
const npcEntries = npcRecs.map((r, i) => ({ idx: i, type: "npc", recOffset: r.offset, recSize: r.size, ...(collectAFromNpc(r) || { count: 0, entries: [] }) }));

const totalMajor = majorEntries.reduce((s, m) => s + m.entries.length, 0);
const totalNpc = npcEntries.reduce((s, m) => s + m.entries.length, 0);
console.log(`\nTotal A entries: major=${totalMajor}  npc=${totalNpc}`);

// Build A → owners
const aOwners = new Map();
for (const m of majorEntries) for (const e of m.entries) {
  if (!aOwners.has(e.A)) aOwners.set(e.A, []);
  aOwners.get(e.A).push({ type: "major", idx: m.idx, B: e.B, C: e.C });
}
for (const n of npcEntries) for (const e of n.entries) {
  if (!aOwners.has(e.A)) aOwners.set(e.A, []);
  aOwners.get(e.A).push({ type: "npc", idx: n.idx, B: e.B, C: e.C });
}

console.log(`\nDistinct A values: ${aOwners.size}`);
let pairCount = 0, singleCount = 0, multiCount = 0;
for (const [a, owners] of aOwners) {
  if (owners.length === 2) pairCount++;
  else if (owners.length === 1) singleCount++;
  else multiCount++;
}
console.log(`A with 1 owner: ${singleCount}, 2 owners: ${pairCount}, 3+ owners: ${multiCount}`);

// Show some pair examples
console.log(`\n=== Examples of A with 2 owners (potential pair-relations) ===`);
let shown = 0;
for (const [a, owners] of aOwners) {
  if (owners.length === 2 && shown < 20) {
    console.log(`  A=${a}: ${owners.map((o) => `${o.type}[${o.idx}](B=${o.B},C=${o.C})`).join(" + ")}`);
    shown++;
  }
}
