// dig-diplo-H.js — session 109 step H
//
// Big question: how do we identify the OTHER faction in each entry?
// G found: NOT in the 148B pre-marker zone.
//
// New angle: build a TABLE of relations per (ownerMajor, A, B, C) and look
// for cross-references:
//   * Does owner[i] entry A=X have a sister entry in owner[j]'s list with
//     the SAME B/C pattern? (symmetric two-sided diplomacy)
//   * Or: is the A value globally unique BUT one A per pair (one-sided)?
//   * If symmetric: pairs of (i, j) majors should share entries that
//     mirror each other in (B, C) but with different A values
//
// Test: for each major i, the count of entries should equal the number of
// "OTHER factions" i has a relation with (~22 typical). The actual counts
// in save_10_fresh are wildly different: [1, 34, 84, 115, 12, 1, 2, 5, 6,
// 2, 2, 3, 3, 1, 3, 4, 2, 1, 3, 2, 3, 1, 2]. The total is 292 entries
// across 23 majors.
//
// 23 × 22 / 2 = 253 unique unordered pairs. 23 × 22 = 506 ordered pairs.
// 292 is between these — so each pair MIGHT be stored once (253) plus
// some extras (39 — could be alliance treaties stored separately from war
// declarations?)
//
// Or — entries are events, not relations. Each diplomatic event creates
// a new entry. With ~292 events at T0, that's the initial setup.
//
// Hypothesis: A is the offset/index in a GLOBAL relations table that's
// stored elsewhere in the save. Each major stores a list of "indices into
// the global relations table that apply to me".
//
// Test: find a GLOBAL u32 array of 1317 entries somewhere in the save.
// Each element would be 16 bytes? 8 bytes? 4 bytes? The brief said the
// pre-marker zone was 148 B — could the relations be in the major-record
// HEAD instead?
//
// Approach: a) print full relations table; b) hunt for global table of
// 1317 elements anywhere in the save.
//
// Usage: node dig-diplo-H.js
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

function getEntries(buf, m) {
  const markerOff = m.pos + 244 + 4 * m.regions;
  if (buf[markerOff] !== 0x05 || buf[markerOff + 1] !== 0x00 || buf[markerOff + 2] !== 0x24 || buf[markerOff + 3] !== 0x39) return [];
  const count = buf.readUInt32LE(markerOff + 4);
  const out = [];
  for (let i = 0; i < count; i++) {
    const off = markerOff + 8 + i * 16;
    out.push({
      A: buf.readUInt32LE(off),
      B: buf.readUInt32LE(off + 4),
      C: buf.readUInt32LE(off + 8),
      D: buf.readUInt32LE(off + 12),
      pos: off,
    });
  }
  return out;
}

const majors = readMajor(buf);

// Step 1: build per-major entries, sort by A ascending
const allByMajor = majors.map((m, idx) => {
  const e = getEntries(buf, m);
  return { idx, regions: m.regions, pos: m.pos, count: e.length, entries: [...e].sort((a, b) => a.A - b.A) };
});

// Print compact view
console.log("=== save_10_fresh per-major entries (sorted by A ascending) ===");
for (const m of allByMajor) {
  console.log(`  major[${m.idx.toString().padStart(2)}] (regs=${m.regions.toString().padStart(2)}, count=${m.count.toString().padStart(3)}) A-range: ${m.count ? `${m.entries[0].A}..${m.entries[m.count - 1].A}` : "—"}`);
}

// Step 2: print ALL A values sorted and find gaps
const allA = [];
for (const m of allByMajor) for (const e of m.entries) allA.push({ A: e.A, owner: m.idx, B: e.B, C: e.C });
allA.sort((a, b) => a.A - b.A);
console.log(`\n=== Sorted A across all majors (${allA.length} entries) ===`);
console.log(`A range: ${allA[0].A}..${allA[allA.length - 1].A}`);
const gaps = [];
for (let i = 1; i < allA.length; i++) {
  const g = allA[i].A - allA[i - 1].A;
  if (g > 1) gaps.push({ from: allA[i - 1].A, to: allA[i].A, gap: g });
}
console.log(`Gaps in A: ${gaps.length} (max gap=${Math.max(...gaps.map((g) => g.gap))})`);
console.log(`First 10 gaps:`, gaps.slice(0, 10));

// Step 3: look for OWNER-MAJOR grouping. If A is monotonically assigned at
// world creation per OWNING major, then the sorted A values should cluster
// by owner. Print first 50 sorted entries with owner label.
console.log("\n=== First 60 sorted entries: A → owner ===");
allA.slice(0, 60).forEach((e) => console.log(`  A=${e.A.toString().padStart(5)} owner=major[${e.owner.toString().padStart(2)}] B=${e.B} C=${e.C}`));
console.log("\n=== Last 30 sorted entries ===");
allA.slice(-30).forEach((e) => console.log(`  A=${e.A.toString().padStart(5)} owner=major[${e.owner.toString().padStart(2)}] B=${e.B} C=${e.C}`));

// Step 4: PER-OWNER mod-pattern. If a major's entries are consecutive A
// values, that confirms A is monotonic-per-major. If they're spread out,
// A is monotonic-globally with owner shifting.
console.log("\n=== Per-major A delta distribution ===");
for (const m of allByMajor) {
  if (m.count < 2) continue;
  const deltas = [];
  for (let i = 1; i < m.count; i++) deltas.push(m.entries[i].A - m.entries[i - 1].A);
  const sum = deltas.reduce((a, b) => a + b, 0);
  const max = Math.max(...deltas);
  const min = Math.min(...deltas);
  console.log(`  major[${m.idx}] count=${m.count} A-range=[${m.entries[0].A}..${m.entries[m.count - 1].A}] avg-delta=${(sum / deltas.length).toFixed(1)} min=${min} max=${max}`);
}

// Step 5: hunt for a global table of 16-byte structs elsewhere in the
// save. If diplomacy is a global array indexed by A, we'd see 1317
// 16-byte entries somewhere (=21072 bytes), or some other size N.
// Look for a region of `01 01 01 00` D-marker patterns at stride 16.
console.log("\n=== Hunting for global 16B stride array with 01 01 01 00 markers ===");
const stride = 16;
const markerBytes = [0x01, 0x01, 0x01, 0x00];
const hits = [];
// Sliding scan: pick every offset where buf[i..i+4] matches and check
// adjacent +16/+32 etc.
for (let i = 12; i + stride * 4 < buf.length; i++) {
  if (buf[i] !== 0x01 || buf[i + 1] !== 0x01 || buf[i + 2] !== 0x01 || buf[i + 3] !== 0x00) continue;
  // Check if i+stride+0..3 is also 01 01 01 00
  if (buf[i + stride] !== 0x01 || buf[i + stride + 1] !== 0x01 || buf[i + stride + 2] !== 0x01 || buf[i + stride + 3] !== 0x00) continue;
  // Extend run
  let run = 1;
  let p = i;
  while (p + stride < buf.length && buf[p + stride] === 0x01 && buf[p + stride + 1] === 0x01 && buf[p + stride + 2] === 0x01 && buf[p + stride + 3] === 0x00) {
    p += stride;
    run++;
  }
  if (run >= 4) hits.push({ start: i, run, end: p + 4 });
  i = p + 4;
}
console.log(`Found ${hits.length} runs of ≥4 consecutive 01 01 01 00 markers at stride 16`);
hits.slice(0, 20).forEach((h) => console.log(`  start=0x${h.start.toString(16)} run=${h.run}`));

// Are any of these hits at offsets >= file_end - tail_size (in the major
// records' marker zones we already know about)?
const knownMarkerZones = majors.map((m) => ({ start: m.pos + 252 + 4 * m.regions, end: m.pos + 252 + 4 * m.regions + getEntries(buf, m).length * 16 }));
const knownZoneCovers = (off) => knownMarkerZones.some((z) => off >= z.start && off < z.end);
const novelHits = hits.filter((h) => !knownZoneCovers(h.start));
console.log(`\nHits OUTSIDE the known 23-major 0x39240005 zones: ${novelHits.length}`);
novelHits.slice(0, 20).forEach((h) => console.log(`  NEW: start=0x${h.start.toString(16)} run=${h.run}`));

// Decode each novel hit as 16-byte structs and report
for (const h of novelHits.slice(0, 5)) {
  console.log(`\n  === Hit at 0x${h.start.toString(16)} run=${h.run} ===`);
  // Step back: a 16B struct's marker is at +12 of struct → struct start at h.start - 12
  const recStart = h.start - 12;
  for (let k = 0; k < Math.min(h.run, 10); k++) {
    const off = recStart + k * 16;
    console.log(`    [${k}] A=${buf.readUInt32LE(off)} B=${buf.readUInt32LE(off + 4)} C=${buf.readUInt32LE(off + 8)} D=0x${buf.readUInt32LE(off + 12).toString(16).padStart(8, "0")}`);
  }
}
