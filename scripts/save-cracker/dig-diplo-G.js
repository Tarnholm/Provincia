// dig-diplo-G.js — session 109 step G
//
// Session 108 found the diplomatic relation entries inside the 23 major-
// faction records at +(244 + 4N) (marker `05 00 24 39`, then u32 count,
// then count × 16B entries `<A><B><C><01 01 01 00>`).
//
// Open question: each entry's `A` is globally unique (NOT a packed pair).
// Where is the OTHER faction in the relation encoded?
//
// Session 108 noted that the 148-byte pre-marker zone (`+(96+4N)` ..
// `+(244+4N)`) contains "small u32 fields and self-pointer clusters".
//
// This script decodes that 148-byte zone for the largest major record in
// save_1.2 — major[3] (115 entries) — to find structure:
//   * is it an array of 22 u32 "other-faction" indices (one per other major)?
//   * is it a 148-byte personality/AI struct?
//   * are there embedded pointers into the major-record array?
//
// Plan: dump every u32 in the 148B zone with annotations:
//   * is the value a self-offset (== record.offset + N)?
//   * does it match another major[i].pos (== otherMajor.offset + K)?
//   * is the value < 23 (potential major-index)?
//   * is it small (< 1500) (could be a relationship-id matching A from
//     someone else's list)?
//
// We will also do the same for ALL 23 majors and compute correlation:
//   does major[i]'s 148B zone contain pointers to all 22 other majors'
//   record offsets? (the "diplomats" hypothesis)
//
// Usage: node dig-diplo-G.js
"use strict";

const fs = require("fs");
const path = require("path");

const SAVE = path.join(__dirname, "fixtures", "feral", "save_1.2.sav");
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
console.log(`Found ${majors.length} majors`);

// For each major, the layout (from session 108):
//   +0   i32 treasury
//   +8   u32 = 100  (class tag)
//   +12  u32 = 1    (version)
//   +24  u32 self-pointer
//   +40  u32 self-pointer
//   +44  u32 = 6
//   +48  u32 = N   (region count)
//   +52  N × u32 region IDs
//   +(92 + 4N)        i32 start-of-turn treasury snapshot     [4 bytes]
//   +(96 + 4N) .. +(244+4N)   148-byte zone we want to decode
//   +(244 + 4N)       u32 0x39240005  (marker)
//   +(248 + 4N)       u32 count
//   +(252 + 4N)       count × 16-byte entries
//
// Build a set of all major positions to test self-references.
const majorPosSet = new Set(majors.map((m) => m.pos));
const majorByOffsetWithin = (val) => {
  // returns { majorIdx, rel } if val falls inside any major's record range
  for (let i = 0; i < majors.length; i++) {
    const start = majors[i].pos;
    // We don't know exact size of each major record. Use a 64KB window
    // as upper bound (majors are typically < 16KB).
    const end = i + 1 < majors.length ? majors[i + 1].pos : start + 65536;
    if (val >= start && val < end) return { majorIdx: i, rel: val - start };
  }
  return null;
};

// Step 1: full dump of major[3]'s 148B pre-marker zone, annotating every u32.
function dumpPreMarker(m, label) {
  const zoneStart = m.pos + 96 + 4 * m.regions;
  const zoneEnd = m.pos + 244 + 4 * m.regions;
  console.log(`\n=== ${label} (pos=0x${m.pos.toString(16)}, regions=${m.regions}) — zone 0x${zoneStart.toString(16)}..0x${zoneEnd.toString(16)} (${zoneEnd - zoneStart} B) ===`);
  for (let off = zoneStart; off + 4 <= zoneEnd; off += 4) {
    const rel = off - m.pos;
    const u32 = buf.readUInt32LE(off);
    let note = "";
    if (u32 === off) note = "[self-pointer == off]";
    else if (u32 === m.pos) note = "[points to own record]";
    else if (u32 === m.pos + 24) note = "[== self_ptr_a]";
    else if (u32 === m.pos + 40) note = "[== self_ptr_b]";
    else if (u32 === 0) note = "[zero]";
    else if (u32 < 23) note = `[< 23, possible major-idx]`;
    else if (u32 < 100) note = `[small u32: ${u32}]`;
    else if (u32 < 1500) note = `[possible relation-id A: ${u32}]`;
    else {
      const hit = majorByOffsetWithin(u32);
      if (hit) note = `[points into major[${hit.majorIdx}] @rel +${hit.rel}]`;
      else if (u32 < buf.length) note = `[file offset 0x${u32.toString(16)}]`;
      else note = `[large constant ${u32}]`;
    }
    console.log(`  +${rel.toString().padStart(3)} (abs 0x${off.toString(16)}): 0x${u32.toString(16).padStart(8, "0")} ${u32.toString().padStart(10)}  ${note}`);
  }
}

dumpPreMarker(majors[3], "major[3] (largest, 115 entries)");
dumpPreMarker(majors[1], "major[1]");
dumpPreMarker(majors[20], "major[20] (smallest, 3 entries)");
dumpPreMarker(majors[0], "major[0] (only 1 entry)");

// Step 2: across all 23 majors, find u32 values in the 148B pre-marker zone
// that point INTO another major's record (this is the "diplomats/embassies"
// candidate). Build a graph: which majors reference which.
console.log("\n=== Pointer cross-references in the pre-marker 148B zone ===");
const refsByMajor = [];
for (let mi = 0; mi < majors.length; mi++) {
  const m = majors[mi];
  const zoneStart = m.pos + 96 + 4 * m.regions;
  const zoneEnd = m.pos + 244 + 4 * m.regions;
  const refs = []; // list of { otherMajorIdx, rel, srcRel }
  for (let off = zoneStart; off + 4 <= zoneEnd; off += 4) {
    const u32 = buf.readUInt32LE(off);
    if (u32 === 0) continue;
    if (u32 === m.pos || u32 === m.pos + 24 || u32 === m.pos + 40 || u32 === off) continue;
    const hit = majorByOffsetWithin(u32);
    if (hit && hit.majorIdx !== mi) refs.push({ otherMajorIdx: hit.majorIdx, rel: hit.rel, srcRel: off - m.pos });
  }
  refsByMajor.push(refs);
  console.log(`  major[${mi.toString().padStart(2)}] refs=${refs.length}: ${refs.slice(0, 10).map((r) => `m${r.otherMajorIdx}@+${r.rel}`).join(" ")}${refs.length > 10 ? " ..." : ""}`);
}

// Step 3: does each major have exactly 22 such refs (one per OTHER major)?
console.log("\n=== Cross-ref count by major ===");
const refCounts = refsByMajor.map((r) => r.length);
console.log(`  per major: [${refCounts.join(",")}]`);
console.log(`  distinct counts: [${[...new Set(refCounts)].sort((a, b) => a - b).join(",")}]`);

// Step 4: alternative hypothesis: maybe the 148B zone contains values that
// match the A field of relationship entries in OTHER majors' lists, i.e.
// "my view of relationship X (whose home is in some other major)". Test:
// for each u32 in major[i]'s 148B zone, does it match any A value across
// all majors' entries?
function getEntries(m) {
  const markerOff = m.pos + 244 + 4 * m.regions;
  if (buf[markerOff] !== 0x05 || buf[markerOff + 1] !== 0x00 || buf[markerOff + 2] !== 0x24 || buf[markerOff + 3] !== 0x39) return [];
  const count = buf.readUInt32LE(markerOff + 4);
  const out = [];
  for (let i = 0; i < count; i++) {
    const off = markerOff + 8 + i * 16;
    out.push({ A: buf.readUInt32LE(off), B: buf.readUInt32LE(off + 4), C: buf.readUInt32LE(off + 8), D: buf.readUInt32LE(off + 12), ownerMajor: undefined });
  }
  return out;
}
const allEntries = majors.map((m, i) => ({ majorIdx: i, entries: getEntries(m).map((e) => ({ ...e, ownerMajor: i })) }));
const allA = new Set();
allEntries.forEach((m) => m.entries.forEach((e) => allA.add(e.A)));
console.log(`\nTotal distinct A across all majors' entries: ${allA.size}`);

console.log("\n=== For each major: how many u32s in 148B zone match a relationship-A? ===");
for (let mi = 0; mi < majors.length; mi++) {
  const m = majors[mi];
  const zoneStart = m.pos + 96 + 4 * m.regions;
  const zoneEnd = m.pos + 244 + 4 * m.regions;
  let aHits = 0;
  for (let off = zoneStart; off + 4 <= zoneEnd; off += 4) {
    const u32 = buf.readUInt32LE(off);
    if (allA.has(u32)) aHits++;
  }
  console.log(`  major[${mi}] zone-u32s matching some A: ${aHits}`);
}
