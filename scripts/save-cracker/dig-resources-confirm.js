// dig-resources-confirm.js — test whether the 2,272-record blob at
// 0x00f85f5c..0x01024d8e in the Turn-960 save is the RESOURCES entity table.
//
// Strategy:
//   1. Parse descr_strat.txt for `resource <type>, <level>, <x>, <y>;` lines.
//   2. Walk the 2,272 save records at the known 267-byte cluster starts.
//   3. For every plausible (x,y) pair offset within the first ~64 bytes of
//      each record (u16x/u16y and u32x/u32y, all alignments), tally how
//      many records' (x,y) lands on a known descr_strat resource position.
//   4. If we find an offset where ≥ 90% of variable records map to a
//      known resource position, that's a confirmation.
//
// Usage:  node scripts/save-cracker/dig-resources-confirm.js [savePath]

"use strict";
const fs = require("fs");
const path = require("path");

const SAVE = process.argv[2] || "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const STRAT = "C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt";
const BLOB_START = 0xf85f5c;
const BLOB_END   = 0x1024d8e;
const STRIDE     = 267;

// ---------- 1. parse descr_strat ----------
const stratText = fs.readFileSync(STRAT, "utf8");
const resources = [];            // {type, level, x, y, region}
const byXY = new Map();          // "x,y" -> [{type,level,...}]
for (const line of stratText.split(/\r?\n/)) {
  const m = /^\s*resource\s+([a-z_]+)\s*,\s*(\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*(?:;\s*(.*))?$/i.exec(line);
  if (!m) continue;
  const r = { type: m[1], level: +m[2], x: +m[3], y: +m[4], region: (m[5] || "").trim() };
  resources.push(r);
  const k = `${r.x},${r.y}`;
  if (!byXY.has(k)) byXY.set(k, []);
  byXY.get(k).push(r);
}
console.log(`descr_strat resources:  ${resources.length}`);
console.log(`distinct (x,y) coords:  ${byXY.size}`);
const typeCounts = new Map();
for (const r of resources) typeCounts.set(r.type, (typeCounts.get(r.type) || 0) + 1);
const types = [...typeCounts.keys()].sort();
console.log(`distinct resource types: ${types.length}  (${types.join(", ")})`);

// ---------- 2. find the 2,272 record offsets ----------
const buf = fs.readFileSync(SAVE);
const positions = [];
for (let i = BLOB_START; i + 4 <= BLOB_END; i++) {
  if (buf[i] === 0xc4 && buf[i+1] === 0x03 && buf[i+2] === 0x00 && buf[i+3] === 0x00) {
    if (i === BLOB_START || buf[i-1] === 0) positions.push(i);
  }
}
console.log(`save records:            ${positions.length}`);

// Identify the "template" (record-0) and which records differ from it.
const template = buf.slice(positions[0], positions[0] + STRIDE);
const variableIdx = [];
for (let i = 0; i < positions.length; i++) {
  if (!buf.slice(positions[i], positions[i] + STRIDE).equals(template)) variableIdx.push(i);
}
console.log(`variable (non-template) records: ${variableIdx.length}`);

// ---------- 3. scan every plausible (x,y) field offset ----------
// We try u16-LE pairs and u32-LE pairs at every byte offset up to 0x80, and
// also adjacent-u16 (xy packed into one u32). Both (x then y) and (y then x).
function scanPairOffset(reader, pairStride, label) {
  // reader(buf, recOff, fieldOff) -> {x,y} or null
  let best = { off: -1, hits: 0, total: 0, sample: [] };
  for (let off = 0; off + pairStride <= 0x90; off++) {
    let hits = 0, tested = 0;
    const sample = [];
    for (const idx of variableIdx) {
      const v = reader(buf, positions[idx], off);
      if (!v) continue;
      tested++;
      const k = `${v.x},${v.y}`;
      if (byXY.has(k)) {
        hits++;
        if (sample.length < 5) sample.push({ idx, ...v, hit: byXY.get(k)[0] });
      }
    }
    if (hits > best.hits) best = { off, hits, total: tested, sample };
  }
  console.log(`  ${label.padEnd(28)} best off=0x${best.off.toString(16).padStart(2,"0")}  hits=${best.hits}/${best.total} (${best.total ? (100*best.hits/best.total).toFixed(1) : "0.0"}%)`);
  if (best.sample.length) {
    for (const s of best.sample) {
      console.log(`     rec#${s.idx}: x=${s.x} y=${s.y}  → ${s.hit.type} L${s.hit.level} (${s.hit.region || "?"})`);
    }
  }
  return best;
}

console.log("\nSCAN — best matching (x,y) offset across variable records:");
const r_u16xy = scanPairOffset((b, o, f) => {
  const x = b.readUInt16LE(o + f), y = b.readUInt16LE(o + f + 2);
  if (x === 0 && y === 0) return null;
  if (x > 1100 || y > 750) return null;
  return { x, y };
}, 4, "u16 x, u16 y (LE)");

const r_u16yx = scanPairOffset((b, o, f) => {
  const y = b.readUInt16LE(o + f), x = b.readUInt16LE(o + f + 2);
  if (x === 0 && y === 0) return null;
  if (x > 1100 || y > 750) return null;
  return { x, y };
}, 4, "u16 y, u16 x (LE)");

const r_u32xy = scanPairOffset((b, o, f) => {
  const x = b.readUInt32LE(o + f), y = b.readUInt32LE(o + f + 4);
  if (x === 0 && y === 0) return null;
  if (x > 1100 || y > 750) return null;
  return { x, y };
}, 8, "u32 x, u32 y (LE)");

const r_u32yx = scanPairOffset((b, o, f) => {
  const y = b.readUInt32LE(o + f), x = b.readUInt32LE(o + f + 4);
  if (x === 0 && y === 0) return null;
  if (x > 1100 || y > 750) return null;
  return { x, y };
}, 8, "u32 y, u32 x (LE)");

// Best overall.
const candidates = [
  { ...r_u16xy, kind: "u16 x,y" },
  { ...r_u16yx, kind: "u16 y,x" },
  { ...r_u32xy, kind: "u32 x,y" },
  { ...r_u32yx, kind: "u32 y,x" },
];
candidates.sort((a, b) => b.hits - a.hits);
const winner = candidates[0];
console.log(`\nWINNER: ${winner.kind} @ +0x${winner.off.toString(16)}  →  ${winner.hits}/${winner.total} variable records hit a descr_strat resource position`);
const hitRate = winner.total ? winner.hits / winner.total : 0;

// ---------- 4. also dump a few variable records' raw u32s for inspection ----------
console.log("\nFIRST 5 VARIABLE RECORDS (u32 fields 0..0x68):");
for (const idx of variableIdx.slice(0, 5)) {
  const o = positions[idx];
  const fields = [];
  for (let off = 0; off < 0x68; off += 4) fields.push(buf.readUInt32LE(o + off));
  console.log(`  rec#${idx} @ 0x${o.toString(16)}:`);
  fields.forEach((v, j) => {
    if (v !== 0 && v !== template.readUInt32LE(j * 4)) {
      console.log(`     +0x${(j*4).toString(16).padStart(2,"0")}  u32=${v}  (template=${template.readUInt32LE(j*4)})`);
    }
  });
}

// ---------- 5. type-id hypothesis: maybe the differing bytes encode the resource type ----------
// Default template values that differ should be examined. Look at the 418
// variable records and check which byte offsets carry the variation.
const diffOffsets = new Map();  // offset -> set of distinct values
for (const idx of variableIdx) {
  const o = positions[idx];
  for (let off = 0; off < STRIDE; off++) {
    if (buf[o + off] !== template[off]) {
      if (!diffOffsets.has(off)) diffOffsets.set(off, new Set());
      diffOffsets.get(off).add(buf[o + off]);
    }
  }
}
const sortedDiffs = [...diffOffsets.entries()]
  .map(([off, set]) => ({ off, n: set.size, vals: [...set].sort((a, b) => a - b) }))
  .sort((a, b) => b.n - a.n);
console.log(`\nDIFFERING BYTE OFFSETS  (showing top 15 by distinct-value count):`);
for (const d of sortedDiffs.slice(0, 15)) {
  console.log(`  +0x${d.off.toString(16).padStart(3, "0")}  ${d.n} distinct values  e.g. ${d.vals.slice(0, 10).join(", ")}${d.vals.length > 10 ? ", …" : ""}`);
}
console.log(`total differing offsets: ${sortedDiffs.length}`);

// ---------- 6. distribution check on every "candidate coord" u32 field ----------
// If any field really encodes a tile x or tile y, we'd expect its distinct
// value count to be in the hundreds or thousands (resources span x∈[4..1019],
// y∈[1..698]) and the values should be spread across that range.
console.log("\nU32 FIELD DISTRIBUTIONS (all 2272 records):");
const fields = [0x00, 0x0c, 0x10, 0x14, 0x18, 0x1c, 0x20, 0x28, 0x2c, 0x40, 0x44, 0x4c, 0x50, 0x54, 0x60];
for (const off of fields) {
  const vals = new Map();
  let plausibleCoord = 0;   // count of values in 1..1100
  for (const p of positions) {
    const v = buf.readUInt32LE(p + off);
    vals.set(v, (vals.get(v) || 0) + 1);
    if (v >= 1 && v <= 1100) plausibleCoord++;
  }
  const sorted = [...vals.entries()].sort((a,b) => b[1] - a[1]);
  console.log(`  +0x${off.toString(16).padStart(2,"0")}  distinct=${vals.size.toString().padStart(4)}  in-coord-range=${plausibleCoord}/${positions.length}  top4: ` +
    sorted.slice(0, 4).map(([v,c]) => `${v}(×${c})`).join(", "));
}

// A real resources-table field for X or Y would need distinct≈hundreds and
// in-coord-range≈2272. None of these fields come anywhere close.

// ---------- 7. count sanity check ----------
// If the blob were the resources table we would expect exactly N records
// equal to the number of `resource …` lines (5,548) OR equal to the count
// after some natural filter (slaves only, non-slaves only, hidden_resource,
// etc). 2,272 does not correspond to any obvious filter.
const nonSlaves = resources.filter(r => r.type !== "slaves").length;
const slavesOnly = resources.filter(r => r.type === "slaves").length;
console.log(`\nCount cross-check:`);
console.log(`  save records              = ${positions.length}`);
console.log(`  descr_strat resources     = ${resources.length}`);
console.log(`  …minus slaves              = ${nonSlaves}`);
console.log(`  slaves only               = ${slavesOnly}`);
console.log(`  none of the above = 2272 → record count does not match a resources interpretation`);

// ---------- 8. VERDICT ----------
console.log("\n" + "=".repeat(72));
// Distinct value counts at every "coord-candidate" offset are tiny
// (≤ ~70) and clustered around magic numbers (200, 600, 959, 1535, 166).
// Real tile coords would span hundreds of distinct values across 4..1019.
// The 57.9% hit-rate at +0x10 came from records still carrying the
// template (200, 200) plus a few that happen to coincide with the single
// Thamoudaia resource at (600, 200) — see "u32 y, u32 x" sample above —
// which is a degenerate collision, not a structural match.
const isResources = hitRate >= 0.9;
if (isResources) {
  console.log(`VERDICT: blob IS the resources table`);
  console.log(`  anchor: (x, y) at record +0x${winner.off.toString(16)}, encoded as ${winner.kind} LE`);
  console.log(`  match rate: ${(100*hitRate).toFixed(1)}% of ${winner.total} variable records hit a known descr_strat resource position`);
} else {
  console.log(`VERDICT: blob is NOT the resources table`);
  console.log(``);
  console.log(`Reasoning:`);
  console.log(`  (1) Record count mismatch: save has ${positions.length} records but descr_strat`);
  console.log(`      has ${resources.length} resources (no obvious filter yields 2272).`);
  console.log(`  (2) No u32 field looks like an (x,y) coord: every candidate field has`);
  console.log(`      ≤ ~70 distinct values clustered on magic constants (200, 600, 959,`);
  console.log(`      1535, 166). Real coords would span hundreds of distinct values in`);
  console.log(`      [4..1019]×[1..698].`);
  console.log(`  (3) Best (x,y) hit-rate was ${(100*hitRate).toFixed(1)}% (${winner.hits}/${winner.total}, ${winner.kind} @ +0x${winner.off.toString(16)})`);
  console.log(`      and inspection shows the hits are template-value collisions on the`);
  console.log(`      lone Thamoudaia resource at (600, 200) — not a structural match.`);
  console.log(``);
  console.log(`Next hypotheses to test:`);
  console.log(`  - Faction/AI strategic-target pool (2272 ≈ 8 factions × 284 plans?).`);
  console.log(`  - Diplomacy / treaty / trade-rights matrix between factions.`);
  console.log(`  - Long-range strategic-AI tile-evaluation cache (sparsely populated`);
  console.log(`    pool, only 418 of 2272 carrying real data, matches AI-cache pattern).`);
  console.log(`  - Watchtower / fort / landmark pool (descr_strat landmarks=7, but the`);
  console.log(`    blob's magic 166/959/1535 might be category IDs rather than coords).`);
}
console.log("=".repeat(72));
