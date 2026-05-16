// dig-aidip-B.js — Session 103/K
// Final encoding figure-out:
//   - Stride-2 <value, count> RLE
//   - First 24 "sections" (delimited by consec 01ff pairs) each sum to 510
//   - Pure 01ff = run of value=1 length 255 (no special meaning)
//   - Total decoded count grows over campaign — so the encoding is NOT a
//     fixed grid that always sums to 1020*700. The grid is variable!
//
// New hypothesis: the structure is NOT a tile-grid bitmap. It's a
// **per-region exploration record** with multiple sub-streams. The 510 = 510
// "discovered tiles per region" or per-row.
//
// Test: compute the rolling sum of c. Where do the round numbers 510, 1020,
// 510*k land in the stream? That'll show if there's structural periodicity.

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

// Build cumulative count at each pair index
function cumsum(zone) {
  const out = new Array(zone.length / 2 + 1).fill(0);
  let s = 0;
  for (let i = 0; i + 2 <= zone.length; i += 2) {
    s += zone[i+1];
    out[i/2 + 1] = s;
  }
  return out;
}

const { body } = loadPlayer('save_1.2.sav');
const zone = body.slice(ZONE_START, ZONE_END);
const cum = cumsum(zone);

// Find indices where cum is a multiple of 510
console.log(`=== Pair indices where cumulative count hits a multiple of 510 ===`);
const hits = [];
for (let k = 1; k < cum.length; k++) {
  if (cum[k] % 510 === 0 && cum[k] !== cum[k-1]) {
    hits.push({ pairIdx: k, byteOff: k*2, cum: cum[k] });
  }
}
console.log(`Total hits: ${hits.length}`);
for (const h of hits.slice(0, 40)) {
  console.log(`  pair ${h.pairIdx.toString().padStart(5)}  byte+0x${h.byteOff.toString(16).padStart(4,'0')}  cumCount=${h.cum}  (= ${h.cum/510} × 510)`);
}
if (hits.length > 40) console.log(`  ... and ${hits.length - 40} more`);

// Check intra-pair density: how many cumulative-510 boundaries fall within
// the 24-double-01ff sections?
console.log(`\n=== First 24 row-end byte positions ===`);
for (let k = 1; k <= 25 && k <= hits.length; k++) {
  const h = hits[k-1];
  console.log(`  row ${k.toString().padStart(2)} ends at pair ${h.pairIdx.toString().padStart(5)}  byteOff+0x${h.byteOff.toString(16)}  cumCount=${h.cum}`);
}

// Now: is 510 actually = (1020/2), the strategic tile grid width?
// Check by counting how many times the cumulative reaches a row boundary.
// If the grid is 510-wide, then cumulative tile count at end-of-file should
// be ~510 × H for some H.

// Final cumulative count vs hypotheses:
console.log(`\n=== Final cum vs hypotheses (save_1.2) ===`);
const final = cum[cum.length - 1];
console.log(`final = ${final}`);
console.log(`  / 510 = ${(final/510).toFixed(2)}  (H if W=510)`);
console.log(`  / 700 = ${(final/700).toFixed(2)}  (W if H=700)`);
console.log(`  / 350 = ${(final/350).toFixed(2)}  (W if H=350)`);
console.log(`  / 1020 = ${(final/1020).toFixed(2)}`);

// Try all saves
console.log(`\n=== Final cumulative count / 510 across saves ===`);
const saves = [
  'save_10_fresh.sav', 'save_1.2.sav', 'ror_t1e.sav', 'ror_t2s.sav', 'ror_t5.sav',
  'ror_t11e.sav', 'ror_t11s.sav', 'athens_t21.sav', 'athens_t22e.sav',
];
for (const s of saves) {
  const z = loadPlayer(s).body.slice(ZONE_START, ZONE_END);
  const c = cumsum(z);
  const f = c[c.length - 1];
  console.log(`  ${s.padEnd(24)}  final=${f}  /510=${(f/510).toFixed(3)}  mod510=${f % 510}`);
}

// Look at gaps between 510-aligned cumulative hits
console.log(`\n=== Spacing between 510-aligned hits in save_1.2 ===`);
{
  const gaps = [];
  for (let k = 1; k < hits.length; k++) {
    gaps.push(hits[k].pairIdx - hits[k-1].pairIdx);
  }
  // Histogram of gaps
  const histGap = new Map();
  for (const g of gaps) histGap.set(g, (histGap.get(g) || 0) + 1);
  const top = [...histGap.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 10);
  console.log(`Total gaps: ${gaps.length}`);
  console.log(`Top gap sizes (in pair-units): ${top.map(([g,c])=>`${g}×${c}`).join(', ')}`);
  console.log(`Avg gap: ${(gaps.reduce((a,b)=>a+b,0)/gaps.length).toFixed(1)} pairs`);
}

// IMPORTANT alternative: maybe the grid is FREEFORM and 510 row size is
// coincidental. Let me try GRID dim = (350 rows × varying widths) or similar.
// Total dec = 714k. 714k / 350 = 2040 = 2 × 1020. Maybe each tile is 2 bytes wide?
// That'd be a (1020×350) grid encoded with each "tile" repeating? Too speculative.

// SIMPLER check: how many times does cumcount land on a multiple of W=1020?
console.log(`\n=== Cumulative count multiple of 1020 across saves ===`);
for (const s of saves.slice(0, 3)) {
  const z = loadPlayer(s).body.slice(ZONE_START, ZONE_END);
  const c = cumsum(z);
  let hits = 0;
  for (let k = 1; k < c.length; k++) {
    if (c[k] % 1020 === 0 && c[k] !== c[k-1]) hits++;
  }
  console.log(`  ${s}  multiples-of-1020 hits: ${hits}`);
}

// And multiple of 700
console.log(`\n=== Cumulative count multiple of 700 across saves ===`);
for (const s of saves.slice(0, 3)) {
  const z = loadPlayer(s).body.slice(ZONE_START, ZONE_END);
  const c = cumsum(z);
  let hits = 0;
  for (let k = 1; k < c.length; k++) {
    if (c[k] % 700 === 0 && c[k] !== c[k-1]) hits++;
  }
  console.log(`  ${s}  multiples-of-700 hits: ${hits}`);
}
