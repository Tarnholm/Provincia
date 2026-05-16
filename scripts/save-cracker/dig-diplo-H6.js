// dig-diplo-H6.js — session 109 step H6
//
// H5 found 219 marker zones total (23 majors + 196 others). Test the
// hypothesis: each diplomatic relation A appears in TWO marker zones
// (one per faction), so the cross-reference IDENTIFIES the partner.
//
// If A is a UUID and each pair stores it twice, then:
//   * Total entries summed = 2 × distinct A
//   * 780 entries → 390 distinct A
//   * Each distinct A maps to 2 owner-zones
//
// Already know A in major records: 292 distinct values across major zones.
// If 488 outside-major entries contain the same A values (mirrored), then
// 292 distinct A overall.
//
// Test it!
//
// Usage: node dig-diplo-H6.js
"use strict";
const fs = require("fs");
const path = require("path");

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

// All valid markers
const markers = [];
for (let i = 0; i + 4 < buf.length; i++) {
  if (buf[i] === 0x05 && buf[i + 1] === 0x00 && buf[i + 2] === 0x24 && buf[i + 3] === 0x39) markers.push(i);
}
const valid = markers.filter((off) => {
  const count = buf.readUInt32LE(off + 4);
  if (count > 200 || count === 0) return false;
  for (let k = 0; k < count; k++) {
    const e = off + 8 + k * 16;
    if (e + 16 > buf.length) return false;
    if (buf[e + 12] !== 0x01 || buf[e + 13] !== 0x01 || buf[e + 14] !== 0x01 || buf[e + 15] !== 0x00) return false;
  }
  return true;
});
console.log(`Valid markers: ${valid.length}`);

// Build per-marker entry list and classify (major vs other)
const majorMarkerOffs = new Set(majors.map((m) => m.pos + 244 + 4 * m.regions));
const allEntries = []; // { ownerZoneIdx, ownerType, A, B, C, D, markerOff }
valid.forEach((off, zoneIdx) => {
  const count = buf.readUInt32LE(off + 4);
  const type = majorMarkerOffs.has(off) ? "major" : "other";
  for (let k = 0; k < count; k++) {
    const e = off + 8 + k * 16;
    allEntries.push({
      ownerZoneIdx: zoneIdx,
      ownerType: type,
      markerOff: off,
      A: buf.readUInt32LE(e),
      B: buf.readUInt32LE(e + 4),
      C: buf.readUInt32LE(e + 8),
      D: buf.readUInt32LE(e + 12),
    });
  }
});
console.log(`Total entries: ${allEntries.length}`);

// Group by A. Each A should appear in N zones.
const byA = new Map();
for (const e of allEntries) {
  if (!byA.has(e.A)) byA.set(e.A, []);
  byA.get(e.A).push(e);
}
console.log(`Distinct A values: ${byA.size}`);

// Count zone-ownership multiplicity
const histo = {};
for (const [a, owners] of byA) {
  histo[owners.length] = (histo[owners.length] || 0) + 1;
}
console.log(`Owner-count histogram:`);
Object.entries(histo).sort((a, b) => +a[0] - +b[0]).forEach(([k, v]) => console.log(`  A with ${k} owner(s): ${v}`));

// For A's with exactly 2 owners, are they typically major-major, major-other, or other-other?
let majorMajor = 0, majorOther = 0, otherOther = 0;
const pairExamples = [];
for (const [a, owners] of byA) {
  if (owners.length !== 2) continue;
  const types = owners.map((o) => o.ownerType).sort().join("-");
  if (types === "major-major") majorMajor++;
  else if (types === "major-other") majorOther++;
  else otherOther++;
  if (pairExamples.length < 30) pairExamples.push({ A: a, owners });
}
console.log(`\n=== A with 2 owners — type pairings ===`);
console.log(`  major-major: ${majorMajor}`);
console.log(`  major-other: ${majorOther}`);
console.log(`  other-other: ${otherOther}`);

console.log(`\n=== First 20 pair examples ===`);
pairExamples.slice(0, 20).forEach((p) => {
  console.log(`  A=${p.A}: ${p.owners.map((o) => `${o.ownerType}[zone ${o.ownerZoneIdx}]@0x${o.markerOff.toString(16)} (B=${o.B},C=${o.C})`).join("  ||  ")}`);
});

// Test SYMMETRY: when A appears in 2 owners, do they have the SAME B and C?
let symmetric = 0, asymmetric = 0;
const asymExamples = [];
for (const [a, owners] of byA) {
  if (owners.length !== 2) continue;
  const [o1, o2] = owners;
  if (o1.B === o2.B && o1.C === o2.C) symmetric++;
  else {
    asymmetric++;
    if (asymExamples.length < 10) asymExamples.push({ A: a, o1, o2 });
  }
}
console.log(`\n=== B/C symmetry for 2-owner A values ===`);
console.log(`  symmetric (both owners B,C identical): ${symmetric}`);
console.log(`  asymmetric (different B or C): ${asymmetric}`);
if (asymExamples.length > 0) {
  console.log(`  examples:`);
  asymExamples.forEach((e) => console.log(`    A=${e.A}: (B=${e.o1.B},C=${e.o1.C}) vs (B=${e.o2.B},C=${e.o2.C})`));
}

// For A's with 1 owner only, are they more often major or other?
let onlyMajor = 0, onlyOther = 0;
const singleMajors = [];
const singleOthers = [];
for (const [a, owners] of byA) {
  if (owners.length !== 1) continue;
  if (owners[0].ownerType === "major") { onlyMajor++; singleMajors.push(a); }
  else { onlyOther++; singleOthers.push(a); }
}
console.log(`\n=== A with single owner ===`);
console.log(`  only-in-major: ${onlyMajor}`);
console.log(`  only-in-other: ${onlyOther}`);

// Distribution: entries per zone
const perZoneCount = new Map();
for (const e of allEntries) {
  perZoneCount.set(e.ownerZoneIdx, (perZoneCount.get(e.ownerZoneIdx) || 0) + 1);
}
console.log(`\n=== Zone sizes (entries per marker zone) ===`);
const sizes = [...perZoneCount.values()].sort((a, b) => b - a);
console.log(`  top 10: [${sizes.slice(0, 10).join(",")}]`);
console.log(`  bottom 10: [${sizes.slice(-10).join(",")}]`);
console.log(`  total zones: ${perZoneCount.size}, total entries: ${[...perZoneCount.values()].reduce((s, c) => s + c, 0)}`);

// Total entries 780 — interesting: 23 + 196 = 219 zones, but only ~219 zones × avg entries
// Average per zone: 780 / 219 = ~3.56
// If diplomacy is full N×N (23×22 = 506 pairs × 2 sides = 1012 entries needed),
// we have only 780. Maybe minor factions also store their relations, partially.
