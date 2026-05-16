// dig-diplo-D.js — session 108 step D
//
// The `05 00 24 39` marker is at +244+4*regions in every major record;
// the u32 count immediately after is the number of 16-byte entries that
// follow. Entry format: `<u32 A> <u32 B> <u32 C> 01 01 01 00`.
//
// Hypothesis: each entry is a DIPLOMATIC AGREEMENT between THIS faction and
// faction A (or treaty ID A). B and C are agreement attributes.
//
// Validation:
//   * Counts grow over turns → diplomatic events accumulate
//   * If A is a faction-pair-id (e.g., 22 other majors × something), the
//     distinct A values should be ≤ 22 per major. Let's check.
//   * If A is an UUID, distinct A values would be unique per entry.
//
// Plan:
//   1. For every major in save_1.2, dump all entries.
//   2. Per-major: distinct A values (set size). If small (~22), A is a
//      faction reference.
//   3. Per-major: distinct (A, B, C) triples.
//   4. Look for SYMMETRY across major[i] and major[j]: does i's entry for
//      "A=j" mirror j's entry for "A=i"?
//
// Also: look at WHAT'S BEFORE the marker — that's where the actual
// diplomatic state matrix might be.
//
// Usage: node dig-diplo-D.js
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

// For each major, find the marker, count, and dump entries.
function findMarkerEntries(m, idx) {
  const start = m.pos;
  const markerOff = start + 244 + 4 * m.regions;
  if (buf[markerOff] !== 0x05 || buf[markerOff + 1] !== 0x00 || buf[markerOff + 2] !== 0x24 || buf[markerOff + 3] !== 0x39) {
    return { error: "no marker", markerOff };
  }
  const count = buf.readUInt32LE(markerOff + 4);
  const entriesStart = markerOff + 8;
  const entries = [];
  for (let i = 0; i < count; i++) {
    const off = entriesStart + i * 16;
    entries.push({
      A: buf.readUInt32LE(off),
      B: buf.readUInt32LE(off + 4),
      C: buf.readUInt32LE(off + 8),
      D: buf.readUInt32LE(off + 12),
    });
  }
  return { markerOff, count, entries };
}

const allEntries = majors.map((m, i) => ({ idx: i, regions: m.regions, ...findMarkerEntries(m, i) }));

console.log("Per-major entry distinct counts and ranges:");
console.log("idx | regions | count | distinct A | A min | A max | distinct B | distinct C");
for (const e of allEntries) {
  if (!e.entries) continue;
  const distinctA = new Set(e.entries.map((x) => x.A));
  const distinctB = new Set(e.entries.map((x) => x.B));
  const distinctC = new Set(e.entries.map((x) => x.C));
  const aMin = e.entries.reduce((m, x) => Math.min(m, x.A), Infinity);
  const aMax = e.entries.reduce((m, x) => Math.max(m, x.A), 0);
  console.log(`  ${e.idx.toString().padStart(2)} | ${e.regions.toString().padStart(3)} | ${e.count.toString().padStart(5)} | ${distinctA.size.toString().padStart(5)} | ${aMin.toString().padStart(5)} | ${aMax.toString().padStart(5)} | ${distinctB.size.toString().padStart(5)} | ${distinctC.size.toString().padStart(5)}`);
}

// Dump major[3] (115 entries) entries
console.log("\n=== major[3] entries (115) — full dump ===");
const m3 = allEntries[3];
console.log(`  marker at 0x${m3.markerOff.toString(16)} count=${m3.count}`);
m3.entries.forEach((e, i) => {
  console.log(`    [${i.toString().padStart(3)}] A=${e.A.toString().padStart(10)} B=${e.B.toString().padStart(5)} C=${e.C.toString().padStart(5)} D=0x${e.D.toString(16).padStart(8, "0")}`);
});

// Check: do major[i] and major[j] have entries referring to each other?
// If A field is a "factionId" of the OTHER faction, then for every (i, j)
// pair, major[i] entries containing A==j should match major[j] entries
// containing A==i (symmetric for war/alliance).
//
// But A values are 600-1200 not 0-22, so they're not direct major-indices.
// Maybe they're encoded as some 16-bit pair?

// Look at distinct A values across ALL majors — is A discrete (small set)?
const globalA = new Set();
allEntries.forEach((e) => {
  if (!e.entries) return;
  e.entries.forEach((x) => globalA.add(x.A));
});
console.log(`\nGlobal distinct A values: ${globalA.size}`);
const sortedA = [...globalA].sort((a, b) => a - b);
console.log(`A range: ${sortedA[0]} .. ${sortedA[sortedA.length - 1]}`);
console.log(`First 20 distinct A: ${sortedA.slice(0, 20).join(", ")}`);
console.log(`Last 10 distinct A: ${sortedA.slice(-10).join(", ")}`);

// Compute: for each pair (i, j), how often does an A value appear in BOTH
// major[i] and major[j]? If A is a SHARED EVENT ID (e.g. event of "Romans
// betrayed Carthaginians"), then both factions log the same event ID.
const sharedAcross = [];
for (let i = 0; i < allEntries.length; i++) {
  for (let j = i + 1; j < allEntries.length; j++) {
    if (!allEntries[i].entries || !allEntries[j].entries) continue;
    const aSetI = new Set(allEntries[i].entries.map((x) => x.A));
    const aSetJ = new Set(allEntries[j].entries.map((x) => x.A));
    const shared = [...aSetI].filter((a) => aSetJ.has(a));
    if (shared.length > 0) {
      sharedAcross.push({ i, j, sharedCount: shared.length, shared: shared.slice(0, 5) });
    }
  }
}
console.log(`\nFaction pairs sharing at least one A value:`);
sharedAcross.slice(0, 30).forEach((s) => {
  console.log(`  major[${s.i}] ∩ major[${s.j}] = ${s.sharedCount} shared A values [${s.shared.join(",")}${s.sharedCount > 5 ? "..." : ""}]`);
});

// Also: look at what's IMMEDIATELY BEFORE the marker.
// markerOff = +244 + 4*regions
// So zones: +0..+92 (header), +92..+(92+4*N) region list,
// +(92+4N)..+(92+4N+4) start-of-turn treasury,
// +(92+4N+4)..+244+4*N = some zone of (244-92-4) = 148 bytes
// Then marker at +244+4*N, then count, then entries.
console.log("\n=== Before marker: zone +96..+244 (148 bytes after region list) — major[1] ===");
const m1pos = majors[1].pos;
const beforeMarkerStart = m1pos + 92 + 4 * majors[1].regions + 4;
const beforeMarkerEnd = m1pos + 244 + 4 * majors[1].regions;
console.log(`  range: 0x${beforeMarkerStart.toString(16)} .. 0x${beforeMarkerEnd.toString(16)} (${beforeMarkerEnd - beforeMarkerStart} B)`);
for (let i = beforeMarkerStart; i < beforeMarkerEnd; i += 16) {
  let h = "  ", a = "  ";
  for (let j = 0; j < 16 && i + j < beforeMarkerEnd; j++) {
    h += buf[i + j].toString(16).padStart(2, "0") + " ";
    a += (buf[i + j] >= 32 && buf[i + j] < 127 ? String.fromCharCode(buf[i + j]) : ".");
  }
  console.log(`  +${(i - m1pos).toString().padStart(3)}: ${h}  ${a}`);
}
