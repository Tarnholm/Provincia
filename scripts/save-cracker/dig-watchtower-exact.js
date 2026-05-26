// dig-watchtower-exact.js — crack the EXACT watchtower count in the post-grid
// 267-stride array. The current parser counts all "non-template" records
// (byte +0x20 != 0xc8); that bundles watchtowers + ports + forts + other
// entity types together, yielding 347-351 (close but inexact vs dev=363).
//
// Methodology — try in order:
//   1. Diff Turn 1017 vs Turn 1018 (one turn apart). New records in T1018
//      are entities BUILT that turn; their +0x20 byte is the type-tag for
//      whatever entity-class was constructed. Cross-check with type counts.
//   2. Enumerate +0x20 value distribution and look at the structural pattern
//      of each "type cluster" record (look for ports vs watchtowers).
//   3. Cross-correlate with descr_strat watchtowers (22 starting) — coords
//      in the records may match descr_strat coords.
//   4. Confirm using settlement zone bounds: ports live in settlements,
//      watchtowers live on the map. The +0x20 record bodies may carry a
//      lookup we can verify.
//
// References:
//   - bundled-mod/.../descr_strat.txt has 22 starting watchtowers (uncommented)
//   - dev image: ports=1276, watchtowers=363, forts=0
//   - 0xe8 (232) is the dominant non-template tag (216 records) — close to
//     dev forts? But dev says forts=0, so it's not forts. Test: ports=1276,
//     way too many for the array — so the array isn't ports either.
//   - Total non-template (T1017/T1018): 351 - matches roughly 363 watchtowers
//     but the byte+0x20 enum has many values, suggesting a tagged subset.
//
// Output: per-save, the count + chosen discriminator.

"use strict";
const fs = require("fs");
const path = require("path");

const SAVES = [
  ["t960-start",     "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav"],
  ["t1017",          "C:/Users/vtarn/Downloads/save_item limit bug.sav"],
  ["t1018-start",    "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 1018 Start.sav"],
];

// Re-use the post-grid array detector from src/mapEntityParser.js
const { findPostGridArray } = require(path.resolve(__dirname, "../../src/mapEntityParser.js"));

// Walk records and return [{idx, off, bytes, v20, v21, x, y, ...}]
function readRecords(buf) {
  const arr = findPostGridArray(buf);
  if (!arr) return null;
  const recs = [];
  let p = arr.start, idx = 0;
  while (p + 267 <= arr.end && buf.readUInt32LE(p) === arr.magic) {
    const rec = {
      idx,
      off: p,
      v20: buf[p + 0x20],
      v21: buf[p + 0x21],
      v22: buf[p + 0x22],
      v23: buf[p + 0x23],
      // Some payload candidates
      pay24: buf.readUInt32LE(p + 0x24),  // record-type / next-id
      pay28: buf.readUInt32LE(p + 0x28),  // coord? generation?
      pay2C: buf.readUInt32LE(p + 0x2c),
      pay30: buf.readUInt32LE(p + 0x30),
      // raw 64-byte slice for fingerprinting
      head64: buf.slice(p, p + 64).toString("hex"),
      body64: buf.slice(p + 0x10, p + 0x50).toString("hex"),
    };
    recs.push(rec);
    idx++;
    let next = -1;
    for (let k = 1; k <= 6; k++) {
      const cand = p + k * 267;
      if (cand + 4 > arr.end) break;
      if (buf.readUInt32LE(cand) === arr.magic) { next = cand; break; }
    }
    if (next < 0) break;
    p = next;
  }
  return { arr, recs };
}

function loadAll() {
  const out = {};
  for (const [tag, p] of SAVES) {
    const buf = fs.readFileSync(p);
    const r = readRecords(buf);
    if (!r) { console.log(`${tag}: post-grid not found`); continue; }
    out[tag] = { ...r, buf };
    console.log(`${tag}: ${r.recs.length} records @ 0x${r.arr.start.toString(16)} magic=0x${r.arr.magic.toString(16)}`);
  }
  return out;
}

const data = loadAll();

// ----------------------------------------------------------------------------
// Step 1: Diff Turn 1017 vs Turn 1018 — one turn apart.
// Compare records by IDX (same array position) to see which records changed.
// ----------------------------------------------------------------------------
console.log("\n=== Step 1: Diff T1017 vs T1018 (by record idx) ===");
{
  const a = data["t1017"], b = data["t1018-start"];
  if (a && b) {
    // The arrays may be different lengths (records added that turn).
    console.log(`T1017 recs: ${a.recs.length}, T1018 recs: ${b.recs.length}, delta: ${b.recs.length - a.recs.length}`);

    // Same record index but different content (in the 0x10..0x40 body window)
    let same = 0, diff = 0;
    const diffSamples = [];
    for (let i = 0; i < Math.min(a.recs.length, b.recs.length); i++) {
      if (a.recs[i].body64 !== b.recs[i].body64) {
        diff++;
        if (diffSamples.length < 10) diffSamples.push({ i, a: a.recs[i], b: b.recs[i] });
      } else same++;
    }
    console.log(`Same body: ${same}, Different body: ${diff}`);
    console.log(`First ${diffSamples.length} diffs:`);
    for (const { i, a, b } of diffSamples) {
      console.log(`  idx ${i}: A.v20=0x${a.v20.toString(16)} B.v20=0x${b.v20.toString(16)} A.body=${a.body64.slice(0, 40)} B.body=${b.body64.slice(0, 40)}`);
    }

    // Records present in T1018 but not T1017 (by idx > a.recs.length)
    if (b.recs.length > a.recs.length) {
      console.log(`\nNew records in T1018 (idx ${a.recs.length}..${b.recs.length - 1}):`);
      for (let i = a.recs.length; i < b.recs.length; i++) {
        const r = b.recs[i];
        console.log(`  idx ${i}: v20=0x${r.v20.toString(16)} v21=0x${r.v21.toString(16)} pay24=${r.pay24} pay28=${r.pay28}`);
      }
    }
  }
}

// ----------------------------------------------------------------------------
// Step 2: Group records by v20 (type-tag enum) and inspect each cluster
// ----------------------------------------------------------------------------
console.log("\n=== Step 2: Group by v20 (type-tag enum) ===");
for (const tag of Object.keys(data)) {
  const { recs } = data[tag];
  console.log(`\n  -- ${tag} --`);
  const groups = {};
  for (const r of recs) {
    const k = `0x${r.v20.toString(16)}`;
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  }
  // Sort by frequency descending
  const sorted = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  for (const [k, list] of sorted) {
    if (list.length < 1) continue;
    // Show v21 distribution within cluster
    const v21Hist = {};
    for (const r of list) v21Hist[r.v21] = (v21Hist[r.v21] || 0) + 1;
    const v21Str = Object.entries(v21Hist).sort((a, b) => b[1] - a[1])
      .map(([v, c]) => `0x${(+v).toString(16)}=${c}`).join(",");
    console.log(`    v20=${k}: ${list.length} recs  | v21 dist: ${v21Str}`);
  }
}

// ----------------------------------------------------------------------------
// Step 3: Cross-reference with descr_strat watchtower coords.
// descr_strat has 22 uncommented `watchtower X Y` lines. Read them and see if
// any post-grid record's coordinates (likely at +0x14/+0x18 or similar) match.
// ----------------------------------------------------------------------------
console.log("\n=== Step 3: Cross-reference with descr_strat watchtower coords ===");
{
  const DS = "C:/dev/Provincia/bundled-mod/data/world/maps/campaign/imperial_campaign/descr_strat.txt";
  if (fs.existsSync(DS)) {
    const lines = fs.readFileSync(DS, "utf8").split(/\r?\n/);
    const wtCoords = [];
    for (const line of lines) {
      const m = line.match(/^watchtower\s+(\d+)\s+(\d+)/);
      if (m) wtCoords.push({ x: parseInt(m[1]), y: parseInt(m[2]) });
    }
    console.log(`descr_strat watchtowers (uncommented): ${wtCoords.length}`);
    // Show first 5 coords
    console.log(`  coords sample: ${wtCoords.slice(0, 8).map(c => `(${c.x},${c.y})`).join(" ")}`);

    // For T1017, search the post-grid records for ANY u32 LE pair matching
    // those coords in the first 64 bytes of each record.
    const { recs, buf } = data["t1017"] || data["t1018-start"] || {};
    if (recs) {
      console.log(`\n  Searching record bodies for coord pairs from descr_strat:`);
      let matched = 0;
      const matches = [];
      for (const r of recs) {
        const slice = buf.slice(r.off, r.off + 200);
        for (const c of wtCoords) {
          // Try every 4-byte aligned offset
          for (let o = 0; o < slice.length - 8; o += 1) {
            const x = slice.readUInt32LE(o);
            const y = slice.readUInt32LE(o + 4);
            if (x === c.x && y === c.y) {
              matched++;
              matches.push({ rec: r.idx, off: o, x, y, v20: r.v20 });
              break;
            }
          }
        }
      }
      console.log(`  Total coord-pair matches: ${matched}`);
      // Show distribution of v20 for matched records
      if (matches.length > 0) {
        const v20Hist = {};
        for (const m of matches) v20Hist[m.v20] = (v20Hist[m.v20] || 0) + 1;
        console.log(`  v20 of matched recs: ${Object.entries(v20Hist).sort((a,b)=>b[1]-a[1]).map(([v,c])=>`0x${(+v).toString(16)}=${c}`).join(", ")}`);
        const offHist = {};
        for (const m of matches) offHist[m.off] = (offHist[m.off] || 0) + 1;
        console.log(`  off of matched: ${Object.entries(offHist).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([v,c])=>`+${v}=${c}`).join(", ")}`);
        console.log(`  First 8 matches:`, matches.slice(0, 8));
      }
    }
  }
}

// ----------------------------------------------------------------------------
// Step 4: Look at ALL byte values across the record bodies to find the
// "obviously watchtower" discriminator. Tally each byte position's distinct
// values across all records.
// ----------------------------------------------------------------------------
console.log("\n=== Step 4: Per-column distinct-value tally (T1017) ===");
{
  const { recs, buf } = data["t1017"] || data["t1018-start"] || {};
  if (recs) {
    // For each column (0..266), tally distinct values across all records.
    const distinct = new Array(267).fill(0).map(() => new Set());
    for (const r of recs) {
      const slice = buf.slice(r.off, r.off + 267);
      for (let c = 0; c < 267; c++) distinct[c].add(slice[c]);
    }
    // Show columns with 2..6 distinct values (these are tag/type candidates)
    console.log(`Columns with 2..8 distinct values (good enum candidates):`);
    for (let c = 0; c < 267; c++) {
      const n = distinct[c].size;
      if (n >= 2 && n <= 8) {
        const vals = [...distinct[c]].sort((a, b) => a - b).map(v => `0x${v.toString(16)}`).join(",");
        console.log(`  +0x${c.toString(16).padStart(2, "0")}  distinct=${n}  vals=${vals}`);
      }
    }
  }
}
