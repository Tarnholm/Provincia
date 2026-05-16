// dig-aidip-A.js — Session 103/J
// Refine RLE interpretation. Earlier obs:
//   - 24,870 stride-2 pairs (zone fixed at 49,740 B)
//   - Naive sum-c varies 691k (ror_t2s) to 1,038k (athens_t22e)
//   - c=0 pairs grow 51 -> 3,184 alongside excess growth
//   - The encoding does NOT cleanly decode to 1020*700 = 714000 tiles
//     across all saves.
//
// Maybe what we're seeing is NOT a tile-grid RLE but a **packed sequence
// of (action_type, action_payload) AI decision records**, where:
//   - The byte stream is a serialized log of AI cell updates
//   - The "01 ff" pairs are markers
//   - c is not always a count; it's sometimes a payload byte
//
// Test: re-examine the assumption.
//  1. Skip every pair where v=1 AND c=ff (the marker pattern). Does this
//     give cleaner totals?
//  2. Look at pair counts directly: 24,870. Could this be the byte budget?
//  3. Look at the running offset of '01 ff 01 ff 01' delim runs from
//     dig-aidip-2 — those came in 24 clusters at fixed offsets.

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
const W = 1020;
const H = 700;

// New decoder: <value, count> with several special pairs:
//   - (1, 0xff): merge marker — combine next pair with current run
//   - (0, c): if c=0 then this is a no-op pair; else pure run
//   - (v, 0): no-op
function decodeWithSpecials(zone) {
  let count = 0;
  let i = 0;
  while (i + 2 <= zone.length) {
    const v = zone[i], c = zone[i+1];
    // Skip "01 ff" specifically (marker)
    if (v === 1 && c === 0xff) {
      i += 2;
      continue;
    }
    // Skip (v, 0) pairs (no-op)
    if (c === 0) {
      i += 2;
      continue;
    }
    count += c;
    i += 2;
  }
  return count;
}

// Yet another: what if pairs are <count, value> instead and v=1 is sentinel?
function decodeBA(zone) {
  let count = 0;
  for (let i = 0; i + 2 <= zone.length; i += 2) {
    const c = zone[i], v = zone[i+1];
    if (c === 1 && v === 0xff) continue;
    if (c === 0) continue;
    count += c;
  }
  return count;
}

const saves = [
  'save_10_fresh.sav', 'save_1.2.sav', 'save_mp_before.sav', 'save_mp_after.sav',
  'ror_t1e.sav', 'ror_t2s.sav', 'ror_t5.sav',
  'ror_t11e.sav', 'ror_t11s.sav', 'athens_t21.sav', 'athens_t22e.sav',
];

console.log(`Expected RIS map: 1020 × 700 = ${1020*700}`);
console.log(`save                       skipMarkerZero   modeB_skip`);
for (const s of saves) {
  const { body } = loadPlayer(s);
  const zone = body.slice(ZONE_START, ZONE_END);
  const a = decodeWithSpecials(zone);
  const b = decodeBA(zone);
  console.log(`  ${s.padEnd(24)}  ${a.toString().padStart(8)} (Δ${(a-714000).toString().padStart(6)})  ${b.toString().padStart(8)}`);
}

// Now check: are the 01ff pairs ALWAYS PAIRED (i.e. always two 01ff in a row)?
// If so, the marker is actually "01 ff 01 ff" (4 bytes) and our 248 count is
// in 124 pairs.
console.log(`\n=== Are 01ff pairs doubled? ===`);
{
  const { body } = loadPlayer('save_1.2.sav');
  const zone = body.slice(ZONE_START, ZONE_END);
  let consec = 0, single = 0, prev = false;
  for (let i = 0; i + 2 <= zone.length; i += 2) {
    const isMarker = zone[i] === 1 && zone[i+1] === 0xff;
    if (isMarker) {
      if (prev) consec++;
      else { single++; }
      prev = true;
    } else {
      prev = false;
    }
  }
  console.log(`  consecutive 01ff pairs (2nd of pair): ${consec}`);
  console.log(`  isolated 01ff (1st or alone):         ${single}`);
}

// Show all pair positions of 01ff in zone for save_1.2 — first 20
console.log(`\n=== 01ff pair positions in save_1.2 (first 30) ===`);
{
  const { body } = loadPlayer('save_1.2.sav');
  const zone = body.slice(ZONE_START, ZONE_END);
  const pairs = [];
  for (let i = 0; i + 2 <= zone.length; i += 2) {
    if (zone[i] === 1 && zone[i+1] === 0xff) pairs.push(i);
  }
  console.log(`Total 01ff pair offsets in stride-2 stream: ${pairs.length}`);
  console.log(`First 30 (and gaps to next):`);
  for (let k = 0; k < Math.min(30, pairs.length); k++) {
    const gap = k + 1 < pairs.length ? pairs[k+1] - pairs[k] : 0;
    console.log(`  pos[${k}] zone+0x${pairs[k].toString(16)}  (pair_idx=${pairs[k]/2})  gap_to_next=${gap}`);
  }
}

// HUGE TEST: maybe the 24 pairs of double-01ff markers split the zone into
// 24 sub-RLE sections, each one a complete tile-block. Or 12 if doubled.
// Let me sum up the tile-count contribution PER sub-section.
console.log(`\n=== Per-section tile-count when split at first-of-double 01ff ===`);
{
  const { body } = loadPlayer('save_1.2.sav');
  const zone = body.slice(ZONE_START, ZONE_END);
  // Find "double 01ff" pair positions
  const sections = [];
  let curStart = 0;
  let curCount = 0;
  let lastWasMarker = false;
  for (let i = 0; i + 2 <= zone.length; i += 2) {
    const v = zone[i], c = zone[i+1];
    const isMarker = (v === 1 && c === 0xff);
    if (isMarker && lastWasMarker) {
      // Start a new section here
      sections.push({ start: curStart, end: i, count: curCount });
      curStart = i + 2;
      curCount = 0;
      lastWasMarker = false;
    } else if (isMarker) {
      lastWasMarker = true;
    } else {
      lastWasMarker = false;
      curCount += c;
    }
  }
  // Final section
  if (curCount > 0) sections.push({ start: curStart, end: zone.length, count: curCount });
  console.log(`Found ${sections.length} sections (split at double-01ff markers)`);
  let totalCount = 0;
  for (let k = 0; k < Math.min(sections.length, 30); k++) {
    const s = sections[k];
    console.log(`  sec[${k.toString().padStart(2)}] zone+0x${s.start.toString(16).padStart(4,'0')}..0x${s.end.toString(16).padStart(4,'0')}  bytes=${s.end - s.start}  tileCount=${s.count}`);
    totalCount += s.count;
  }
  if (sections.length > 30) {
    for (const s of sections.slice(-5)) {
      console.log(`  sec[late] zone+0x${s.start.toString(16).padStart(4,'0')}..0x${s.end.toString(16).padStart(4,'0')}  bytes=${s.end - s.start}  tileCount=${s.count}`);
    }
  }
  for (const s of sections) totalCount += 0; // (already counted)
  let sumAll = 0;
  for (const s of sections) sumAll += s.count;
  console.log(`Total tile-count across all sections: ${sumAll}`);
}
