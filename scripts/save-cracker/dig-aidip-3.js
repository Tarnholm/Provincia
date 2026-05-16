// dig-aidip-3.js — Session 103/C
// HYPOTHESIS (after sessions 103/A+B):
//   The 48.6 KB AI/diplo zone is NOT stride-3 packed records. It's stride-2:
//   pairs of <u8 a, u8 b>. The phase-divergence test scored stride-2 = 1.19,
//   stride-3 = 0.066. The "01 ff" pairs that recur thousands of times look
//   like RLE markers (run-length encoding).
//
//   Strongest hypothesis: <u8 value, u8 count> RLE encoding of a per-tile
//   binary grid (e.g. explored-tiles / line-of-sight / "has-this-faction-
//   ever-been-here" bitmap). Each save shows 24 occurrences of '01 ff 01 ff 01'
//   AT EXACTLY THE SAME RELATIVE OFFSETS — strong signal it's a grid that
//   spans long uniform stretches.
//
// Tests:
//  1. If it's <value, count> RLE, sum of all counts should equal the
//     total number of tiles in the campaign map.
//  2. Same RLE decoded across multiple saves should yield related grid sizes.
//  3. The byte-1 (count) histogram should look skewed toward high values
//     (long runs); byte-0 (value) should be a small enum (0..F).
//  4. Test alternative phase: maybe it's <count, value> instead.

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');

function loadPlayer(file) {
  const buf = fs.readFileSync(path.join(FIX, file));
  const recs = findFactionRecords(buf);
  let big = recs[0]; for (const r of recs) if (r.size > big.size) big = r;
  return { buf, recs, player: big, body: buf.slice(big.offset, big.offset + big.size), file };
}

const ZONE_START = 0x18;
const ZONE_END   = 0x0c264;

function rleDecode(zone, valueFirst) {
  // valueFirst=true: byte 0 = value, byte 1 = count
  // valueFirst=false: byte 0 = count, byte 1 = value
  let totalCount = 0;
  let pairs = 0;
  const valHist = new Array(256).fill(0);
  const cntHist = new Array(256).fill(0);
  for (let i = 0; i + 2 <= zone.length; i += 2) {
    const a = zone[i], b = zone[i+1];
    const value = valueFirst ? a : b;
    const count = valueFirst ? b : a;
    totalCount += count;
    pairs++;
    valHist[value]++;
    cntHist[count]++;
  }
  return { totalCount, pairs, valHist, cntHist };
}

function decodeAlt(zone) {
  // Alt: byte 0 = count, byte 1 = value, BUT count == 0 means a literal escape?
  // Skip — we'll just inspect both.
  return rleDecode(zone, false);
}

const saves = [
  'save_10_fresh.sav',
  'save_1.2.sav',
  'save_mp_before.sav',
  'save_mp_after.sav',
  'ror_t1e.sav',
  'ror_t2s.sav',
  'ror_t5.sav',
  'ror_t11e.sav',
  'ror_t11s.sav',
  'athens_t21.sav',
  'athens_t22e.sav',
];

console.log(`=== RLE total-count hypothesis ===`);
console.log(`(if stride-2 <value, count>: sum(count) = total tiles covered)`);
console.log(`(if stride-2 <count, value>: sum(count) = total tiles covered)`);
console.log(`\nMode A: <value:u8, count:u8>           Mode B: <count:u8, value:u8>`);
console.log(`  save                       pairs   sumA   modeBsumB`);
for (const s of saves) {
  const { body } = loadPlayer(s);
  const zone = body.slice(ZONE_START, ZONE_END);
  const a = rleDecode(zone, true);
  const b = rleDecode(zone, false);
  console.log(`  ${s.padEnd(24)}  ${a.pairs}  sumA=${a.totalCount}  sumB=${b.totalCount}`);
}

// Detailed look at one save
console.log(`\n=== Detail for save_1.2 (Mode A: value, count) ===`);
{
  const { body } = loadPlayer('save_1.2.sav');
  const zone = body.slice(ZONE_START, ZONE_END);
  const a = rleDecode(zone, true);
  console.log(`Pairs: ${a.pairs}  Sum-count: ${a.totalCount}`);
  // Top values
  const topV = a.valHist.map((c,b)=>[b,c]).sort((a,b)=>b[1]-a[1]).slice(0, 16);
  console.log(`Top byte-0 (value) counts:`);
  for (const [v, c] of topV) console.log(`  v=0x${v.toString(16).padStart(2,'0')} (${v})  count=${c}  (${(100*c/a.pairs).toFixed(1)}%)`);
  // Count distribution
  const topC = a.cntHist.map((c,b)=>[b,c]).sort((a,b)=>b[1]-a[1]).slice(0, 16);
  console.log(`Top byte-1 (count) values:`);
  for (const [v, c] of topC) console.log(`  c=${v}  occurrences=${c}  (${(100*c/a.pairs).toFixed(1)}%)`);
}

console.log(`\n=== Detail for save_1.2 (Mode B: count, value) ===`);
{
  const { body } = loadPlayer('save_1.2.sav');
  const zone = body.slice(ZONE_START, ZONE_END);
  const b = rleDecode(zone, false);
  console.log(`Pairs: ${b.pairs}  Sum-count: ${b.totalCount}`);
  const topV = b.valHist.map((c,b)=>[b,c]).sort((a,b)=>b[1]-a[1]).slice(0, 16);
  console.log(`Top byte-1 (value) counts:`);
  for (const [v, c] of topV) console.log(`  v=0x${v.toString(16).padStart(2,'0')} (${v})  occurrences=${c}  (${(100*c/b.pairs).toFixed(1)}%)`);
  const topC = b.cntHist.map((c,b)=>[b,c]).sort((a,b)=>b[1]-a[1]).slice(0, 16);
  console.log(`Top byte-0 (count) values:`);
  for (const [v, c] of topC) console.log(`  c=${v}  occurrences=${c}  (${(100*c/b.pairs).toFixed(1)}%)`);
}

// Map dimensions check: RIS imperial campaign uses what map size?
// From session 99 / public/map_regions_large.tga (mentioned in repo root) —
// the RIS large map is described as huge but let's compute from saves we have.
// Print sum-count alongside known campaign map sizes:
//   - Vanilla RTW: 350x230 = 80500 tiles
//   - BI: similar
//   - RIS large: likely 600x400 = 240000 or more
// Cross-check: if our totalCount lands near a likely tile-grid size, great.

// Lastly: visualize first 100 RLE pairs decoded as <value, count>
console.log(`\n=== First 60 RLE pairs decoded as <value, count> ===`);
{
  const { body } = loadPlayer('save_1.2.sav');
  const zone = body.slice(ZONE_START, ZONE_END);
  for (let i = 0; i < 60; i++) {
    const v = zone[i*2], c = zone[i*2+1];
    console.log(`  pair[${i.toString().padStart(2)}] rel=+0x${(i*2+ZONE_START).toString(16).padStart(4,'0')}  v=0x${v.toString(16).padStart(2,'0')}(${v.toString().padStart(3)})  c=0x${c.toString(16).padStart(2,'0')}(${c.toString().padStart(3)})`);
  }
}

// Look for repeated patterns that suggest a row-by-row grid structure.
// If it's an X×Y grid encoded row-by-row, each row's RLE should end on a
// run boundary, but for the simple case we expect total counts that map
// to map dimensions.
