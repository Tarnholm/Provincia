// dig-blob-0x02027c75.js — investigate the 4th-largest unknown blob found
// by cover.js on the Turn-960 dummies save:
//   0x02027c75 .. 0x0206e766 (289,521 B = 0.41 %).
//
// This blob sits in the body region between settlement-detail records and
// the merc-pool-table / army-trail zone. Neighbours and structure are
// determined empirically below.
//
// Approach:
//  1. Byte histogram.
//  2. Probe immediate neighbour claims (32 B before / 64 B head / 32 B
//     mid / 32 B tail / 32 B after).
//  3. Cluster detection via multiple candidate magics (looking for
//     repeating record signatures); search for zero-preceded magic
//     pairs that recur on a fixed stride.
//  4. Stride histogram for the dominant magic; record-count vs the dev-
//     team cardinality table (factions 112, settlements 1831, ports 1276,
//     watchtowers 363, characters 2197, armies 2581, units 12768,
//     resources 2926, roads 3957, sieges 26, character records 12692,
//     buildings 24834).
//  5. ASCII tokens ≥ 5 chars — record-type names, path strings, names.
//  6. Distinct-value count per u32 offset over the first N records (low
//     count = magic constants; high = real data).
//  7. Try common stride hypotheses (8, 12, 16, 20, 24, 32, 40, 48, 64)
//     and report which one gives the best (zero-trailer-density × record
//     -count) score.
//
// Usage:  node dig-blob-0x02027c75.js [savePath]

"use strict";
const fs   = require("fs");
const SAVE = process.argv[2] || "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const BLOB_START = 0x02027c75;
const BLOB_END   = 0x0206e766;

const buf  = fs.readFileSync(SAVE);
const span = buf.slice(BLOB_START, BLOB_END);
const N = span.length;
console.log(`save:    ${SAVE}`);
console.log(`size:    ${buf.length} B`);
console.log(`blob:    0x${BLOB_START.toString(16)}..0x${BLOB_END.toString(16)} (${N} B = ${(N/1024).toFixed(1)} KB)`);
console.log();

// ---------------------------------------------------------------------------
// (1) Byte histogram.
// ---------------------------------------------------------------------------
{
  const hist = new Uint32Array(256);
  for (let i = 0; i < N; i++) hist[span[i]]++;
  const z = hist[0], f = hist[0xff], other = N - z - f;
  console.log(`== byte freq ==`);
  console.log(`  0x00 : ${z}  (${(100*z/N).toFixed(2)}%)`);
  console.log(`  0xff : ${f}  (${(100*f/N).toFixed(2)}%)`);
  console.log(`  other: ${other}  (${(100*other/N).toFixed(2)}%)`);
  // Top non-zero bytes.
  const ix = Array.from(hist.keys()).filter(i => i !== 0).sort((a, b) => hist[b] - hist[a]).slice(0, 10);
  console.log(`  top non-zero bytes:`);
  for (const i of ix) {
    console.log(`    0x${i.toString(16).padStart(2,"0")} = ${hist[i]} (${(100*hist[i]/N).toFixed(2)}%)`);
  }
  console.log();
}

// ---------------------------------------------------------------------------
// (2) Boundary bytes.
// ---------------------------------------------------------------------------
function hexDump(b, off, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(b[off + i].toString(16).padStart(2, "0"));
  }
  return out.join(" ");
}
{
  console.log(`== boundary bytes ==`);
  console.log(`  32 B BEFORE  : ${hexDump(buf, BLOB_START - 32, 32)}`);
  console.log(`  64 B at HEAD : ${hexDump(buf, BLOB_START, 64)}`);
  console.log(`  32 B at MID  : ${hexDump(buf, BLOB_START + Math.floor(N/2), 32)}`);
  console.log(`  32 B at TAIL : ${hexDump(buf, BLOB_END - 32, 32)}`);
  console.log(`  32 B AFTER   : ${hexDump(buf, BLOB_END, 32)}`);
  console.log();
}

// ---------------------------------------------------------------------------
// (3) ASCII tokens of >= 5 printable chars.
// ---------------------------------------------------------------------------
{
  console.log(`== ASCII tokens (>=5 chars) ==`);
  const toks = new Map();
  let cur = "";
  for (let i = 0; i < N; i++) {
    const c = span[i];
    const printable = c >= 0x20 && c < 0x7f;
    if (printable) {
      cur += String.fromCharCode(c);
    } else {
      if (cur.length >= 5) toks.set(cur, (toks.get(cur) || 0) + 1);
      cur = "";
    }
  }
  if (cur.length >= 5) toks.set(cur, (toks.get(cur) || 0) + 1);
  const top = [...toks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  console.log(`  distinct tokens: ${toks.size}`);
  for (const [t, n] of top) {
    const shown = t.length > 60 ? t.slice(0, 60) + "..." : t;
    console.log(`    ${String(n).padStart(5)} × ${JSON.stringify(shown)}`);
  }
  console.log();
}

// ---------------------------------------------------------------------------
// (4) Cluster / magic detection.
//   Find 4-byte sequences that recur many times preceded by a zero byte
//   (a common marker convention in this engine).
// ---------------------------------------------------------------------------
let dominantMagic = null;
{
  console.log(`== zero-preceded 4-byte magic candidates ==`);
  const tally = new Map();
  for (let i = 1; i + 4 <= N; i++) {
    if (span[i - 1] !== 0) continue;
    const v = span.readUInt32LE(i);
    if (v === 0 || v === 0xffffffff) continue;
    tally.set(v, (tally.get(v) || 0) + 1);
  }
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [v, n] of ranked) {
    const bytes = Buffer.alloc(4); bytes.writeUInt32LE(v, 0);
    console.log(`    ${String(n).padStart(6)} × 0x${v.toString(16).padStart(8, "0")}  (${[...bytes].map(x=>x.toString(16).padStart(2,"0")).join(" ")})`);
  }
  if (ranked.length) dominantMagic = ranked[0][0];
  console.log();
}

// ---------------------------------------------------------------------------
// (5) Stride histogram for the top magic.
// ---------------------------------------------------------------------------
let positions = [];
if (dominantMagic != null) {
  const bytes = Buffer.alloc(4); bytes.writeUInt32LE(dominantMagic, 0);
  for (let i = 0; i + 4 <= N; i++) {
    if (i > 0 && span[i - 1] !== 0) continue;
    if (span[i] === bytes[0] && span[i+1] === bytes[1] && span[i+2] === bytes[2] && span[i+3] === bytes[3]) {
      positions.push(i);
    }
  }
  console.log(`== stride histogram for top magic 0x${dominantMagic.toString(16)} ==`);
  console.log(`  records: ${positions.length}`);
  const t = new Map();
  for (let i = 1; i < positions.length; i++) {
    const s = positions[i] - positions[i-1];
    t.set(s, (t.get(s) || 0) + 1);
  }
  const tr = [...t.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  for (const [s, n] of tr) {
    console.log(`  ${String(n).padStart(5)} × ${s} B`);
  }
  console.log();
}

// ---------------------------------------------------------------------------
// (6) "Constant trailing 4 zero bytes" stride detection.
//   For each candidate stride S in {6,7,8,9,10,12,14,16,20,24,28,32,40,48,
//   64}, find the alignment that maximises records with all-zero trailing
//   4 bytes (a typical "u32 padding" marker).
// ---------------------------------------------------------------------------
{
  console.log(`== stride-with-zero-trailer scan ==`);
  const RES = [];
  for (const S of [6, 7, 8, 9, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 64]) {
    let best = { off: -1, ok: 0, total: 0 };
    for (let off = 0; off < S; off++) {
      let total = 0, ok = 0;
      for (let p = off; p + S <= N; p += S) {
        total++;
        if (S >= 4) {
          let z = 0;
          for (let k = S - 4; k < S; k++) if (span[p + k] === 0) z++;
          if (z === 4) ok++;
        }
      }
      if (ok > best.ok) best = { off, ok, total };
    }
    RES.push({ S, best });
  }
  for (const r of RES) {
    const pct = (100 * r.best.ok / r.best.total).toFixed(1);
    console.log(`  S=${String(r.S).padStart(3)} off=${r.best.off}  ${r.best.ok}/${r.best.total} = ${pct}%`);
  }
  console.log();
}

// ---------------------------------------------------------------------------
// (7) Distinct-value counts per u32 offset.
//   Use the dominant-magic positions if found; otherwise use a fixed stride
//   of N / 240 (just as a probe).
// ---------------------------------------------------------------------------
function distinctU32PerOffset(stride, baseList) {
  console.log(`== distinct u32 values per offset (stride=${stride}, records=${baseList.length}) ==`);
  if (baseList.length < 8) { console.log(`  (insufficient records)`); return; }
  const limit = Math.min(stride - 3, 256);
  // Limit to offsets every 4 bytes.
  const headerCounts = {};
  for (let off = 0; off + 4 <= stride && off < 96; off += 4) {
    const set = new Set();
    let sampleVals = [];
    for (let i = 0; i < baseList.length; i++) {
      const o = baseList[i] + off;
      if (o + 4 > N) continue;
      const v = span.readUInt32LE(o);
      set.add(v);
      if (sampleVals.length < 3) sampleVals.push(v);
    }
    headerCounts[off] = { distinct: set.size, sample: sampleVals };
  }
  for (const off of Object.keys(headerCounts)) {
    const h = headerCounts[off];
    const sample = h.sample.map(v => `0x${v.toString(16)}`).join(", ");
    console.log(`  +0x${Number(off).toString(16).padStart(2,"0")}  distinct=${String(h.distinct).padStart(5)}  sample=${sample}`);
  }
  console.log();
}

if (positions.length >= 8) {
  // Find dominant stride.
  const t = new Map();
  for (let i = 1; i < positions.length; i++) {
    const s = positions[i] - positions[i-1];
    t.set(s, (t.get(s) || 0) + 1);
  }
  const sorted = [...t.entries()].sort((a, b) => b[1] - a[1]);
  const domStride = sorted[0][0];
  // Filter positions where the next gap == domStride for a clean stride slice.
  const cleanPositions = [];
  for (let i = 0; i < positions.length - 1; i++) {
    if (positions[i+1] - positions[i] === domStride) cleanPositions.push(positions[i]);
  }
  distinctU32PerOffset(domStride, cleanPositions);
}

// ---------------------------------------------------------------------------
// (8) Cardinality fitting.
// ---------------------------------------------------------------------------
{
  console.log(`== cardinality candidates ==`);
  const ENTITIES = {
    factions: 238, // observed in this save
    settlements: 1234, // observed in this save
    forts: 0,
    ports: 1276,
    watchtowers: 363,
    characters: 2053, // observed
    armies: 2581,
    units: 7273, // observed
    resources: 2926,
    roads: 3957,
    sieges: 26,
    character_records: 12692,
    buildings: 24834,
  };
  console.log(`  blob = ${N} B`);
  console.log(`  if N = entityCount × stride, stride = blob / count`);
  for (const [k, count] of Object.entries(ENTITIES)) {
    if (count <= 0) continue;
    const s = N / count;
    console.log(`    ${k.padEnd(20)} count=${count}  →  stride = ${s.toFixed(2)} B`);
  }
  console.log();
}

// ---------------------------------------------------------------------------
// (9) Pre-blob context: what's the previous claimed section's tail look like?
// ---------------------------------------------------------------------------
{
  console.log(`== broader pre-blob context (256 B before) ==`);
  console.log(hexDump(buf, BLOB_START - 256, 256));
  console.log();
  console.log(`== broader post-blob context (256 B after) ==`);
  console.log(hexDump(buf, BLOB_END, 256));
  console.log();
}
