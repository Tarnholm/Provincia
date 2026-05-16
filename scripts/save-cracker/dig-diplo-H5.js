// dig-diplo-H5.js — session 109 step H5
//
// Crucial structural map: list each major's marker offset alongside ALL
// valid 0x39240005 markers in file order. Identify which majors own which
// markers, and what's between them.
//
// Usage: node dig-diplo-H5.js
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
const majorMarkerOffs = majors.map((m, i) => ({ majorIdx: i, regions: m.regions, recOff: m.pos, markerOff: m.pos + 244 + 4 * m.regions, expectedCount: buf.readUInt32LE(m.pos + 244 + 4 * m.regions + 4) }));
console.log("=== Major record marker offsets ===");
majorMarkerOffs.forEach((m) => console.log(`  major[${m.majorIdx.toString().padStart(2)}] recOff=0x${m.recOff.toString(16)} regions=${m.regions} markerOff=0x${m.markerOff.toString(16)} count=${m.expectedCount}`));

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
console.log(`\nTotal valid markers: ${valid.length}`);

// List all markers in file order, tagging which is in a major
const majorMarkerSet = new Set(majorMarkerOffs.map((m) => m.markerOff));
const majorByMarker = new Map();
for (const m of majorMarkerOffs) majorByMarker.set(m.markerOff, m.majorIdx);

console.log(`\n=== First 50 valid markers (with major-tag) ===`);
for (let i = 0; i < Math.min(valid.length, 50); i++) {
  const off = valid[i];
  const count = buf.readUInt32LE(off + 4);
  const tag = majorByMarker.has(off) ? `MAJOR[${majorByMarker.get(off)}]` : "outside";
  console.log(`  m[${i.toString().padStart(3)}] @0x${off.toString(16)} count=${count.toString().padStart(3)}  ${tag}`);
}

// Find any "outside" markers BEFORE/BETWEEN/AFTER each major
console.log(`\n=== Outside markers, classified ===`);
const beforeFirstMajor = [];
const afterLastMajor = [];
const betweenMajors = [];
const firstMajorOff = majorMarkerOffs[0].markerOff;
const lastMajorOff = majorMarkerOffs[majorMarkerOffs.length - 1].markerOff;
const lastMajorEnd = lastMajorOff + 8 + majorMarkerOffs[majorMarkerOffs.length - 1].expectedCount * 16;
for (const off of valid) {
  if (majorByMarker.has(off)) continue;
  if (off < firstMajorOff) beforeFirstMajor.push(off);
  else if (off > lastMajorEnd) afterLastMajor.push(off);
  else betweenMajors.push(off);
}
console.log(`  before first major (0x${firstMajorOff.toString(16)}): ${beforeFirstMajor.length}`);
console.log(`  between majors: ${betweenMajors.length}`);
console.log(`  after last major (0x${lastMajorEnd.toString(16)}): ${afterLastMajor.length}`);

// Show the after-major markers (these are the "global" diplomacy zone)
console.log(`\n=== After-major markers: ${afterLastMajor.length} ===`);
const counts = afterLastMajor.map((off) => buf.readUInt32LE(off + 4));
const sum = counts.reduce((s, c) => s + c, 0);
console.log(`  Total entries: ${sum}`);
console.log(`  Counts: [${counts.join(",")}]`);

// CRUCIAL: are these 196 "outside" markers spread evenly OR co-located
// with a specific section of the file?
if (afterLastMajor.length > 0) {
  const firstAfter = afterLastMajor[0];
  const lastAfter = afterLastMajor[afterLastMajor.length - 1];
  console.log(`  First: 0x${firstAfter.toString(16)}, Last: 0x${lastAfter.toString(16)}, span: ${((lastAfter - firstAfter) / 1024).toFixed(0)} KB`);
}

// What's the relation between # of after-major markers and # of NPC ff0aaff0
// records?
console.log(`\n# NPC records (ff0aaff0): 238`);
console.log(`# after-major markers: ${afterLastMajor.length}`);
console.log(`# between-major markers: ${betweenMajors.length}`);

// Look at between-major markers: do they belong to majors as additional sub-zones?
console.log(`\n=== Between-major markers, classified by which major they're near ===`);
for (const off of betweenMajors) {
  let nearestMajor = -1, nearestDist = Infinity;
  for (let mi = 0; mi < majors.length; mi++) {
    const d = Math.abs(off - majors[mi].pos);
    if (d < nearestDist) { nearestDist = d; nearestMajor = mi; }
  }
  const count = buf.readUInt32LE(off + 4);
  // Is the marker BEFORE or AFTER the major's record?
  const majorMarker = majorMarkerOffs[nearestMajor].markerOff;
  const direction = off < majorMarker ? "before" : "after";
  console.log(`  @0x${off.toString(16)} count=${count}  nearest major=${nearestMajor} dist=${nearestDist} direction=${direction}`);
}
