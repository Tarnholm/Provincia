// dig-aidip-I.js — Session 105/F
// CRITICAL DISCOVERY in 105/E: late-game saves have ASCII strings
// (building types: "Eastern_Large_Town", "Carthaginian_Town" etc.)
// embedded inside the supposed "exploration grid" zone. Session 103's
// fixed zone-end at +0xc264 is WRONG for late saves — there's a separate
// data section that follows the RLE block.
//
// The first ASCII run in each save:
//   save_10_fresh.sav: none (RLE fills the zone)
//   ror_t1e.sav:       none
//   ror_t2s.sav:       none
//   ror_t5.sav:        +0xb870 (start of ASCII section)
//   ror_t11s.sav:      +0xa04a
//   athens_t21.sav:    +0x90a6
//   athens_t22e.sav:   +0x8ec0
//
// So the RLE-exploration-grid is variable length, and the rest of the
// 49,740 bytes is some OTHER data structure (looks like building/region
// records). The grid SHRINKS as more region/building data is recorded.
//
// Tests:
//   1. If I decode RLE only up to the FIRST ASCII run, what's the decoded
//      tile count?
//   2. If it's stride-2 the boundary must be at an even offset. Confirm.
//   3. Decode with the proper truncated zone end and recompute v=2..7
//      counts — the "v≥5 explosion" should DISAPPEAR.
//   4. What separates RLE from non-RLE? Is there a structural marker?

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');
const ZONE_START = 0x18;
const FIXED_ZONE_END = 0x0c264;

function loadPlayer(file) {
  const buf = fs.readFileSync(path.join(FIX, file));
  const recs = findFactionRecords(buf);
  let big = recs[0]; for (const r of recs) if (r.size > big.size) big = r;
  return { buf, recs, player: big, body: buf.slice(big.offset, big.offset + big.size), file };
}

function findAsciiRuns(zone, minLen = 6) {
  const runs = [];
  let start = -1;
  for (let i = 0; i < zone.length; i++) {
    const b = zone[i];
    const isPrint = b >= 0x20 && b <= 0x7e;
    if (isPrint) {
      if (start < 0) start = i;
    } else {
      if (start >= 0 && i - start >= minLen) {
        runs.push({ start, end: i, text: zone.slice(start, i).toString('ascii') });
      }
      start = -1;
    }
  }
  return runs;
}

function decodeRle(zone) {
  const tiles = [];
  for (let i = 0; i + 2 <= zone.length; i += 2) {
    const v = zone[i], c = zone[i+1];
    for (let k = 0; k < c; k++) tiles.push(v);
  }
  return tiles;
}

function hist(tiles) {
  const h = new Array(256).fill(0);
  for (const v of tiles) h[v]++;
  return h;
}

// 1. For each save, find an automatic "RLE end" by scanning backwards
// from the first ASCII run. The grid should end at an even offset
// (stride-2) and possibly with a structural marker.
function detectRleEnd(zone) {
  const runs = findAsciiRuns(zone, 6);
  if (runs.length === 0) return zone.length;

  // Scan back from first ASCII run for a non-RLE-like pattern boundary.
  // The bytes before should look like RLE; right at the boundary, there
  // might be a u32 count or a structural marker.
  const at = runs[0].start;
  // Find the largest even offset E ≤ at such that bytes [E..at] don't look
  // like RLE pairs (which means we can identify where RLE actually ends).
  // For now just round down to even.
  return at - (at % 2);
}

console.log('=== Auto-detected RLE end vs first ASCII run start ===');
const saves = [
  'save_10_fresh.sav',
  'save_1.2.sav',
  'ror_t1e.sav',
  'ror_t2s.sav',
  'ror_t5.sav',
  'ror_t11s.sav',
  'ror_t11e.sav',
  'athens_t21.sav',
  'athens_t22e.sav',
];
for (const file of saves) {
  const { body } = loadPlayer(file);
  const zone = body.slice(ZONE_START, FIXED_ZONE_END);
  const runs = findAsciiRuns(zone, 6);
  const firstAscii = runs.length > 0 ? runs[0].start : zone.length;
  const rleEnd = detectRleEnd(zone);
  const decodedFull = decodeRle(zone);
  const decodedRleOnly = decodeRle(zone.slice(0, rleEnd));
  const ratio = decodedRleOnly.length / 714000;
  console.log(`  ${file.padEnd(24)}  rleEnd=0x${rleEnd.toString(16).padStart(5,'0')}  decFull=${decodedFull.length}  decRleOnly=${decodedRleOnly.length}  /714k=${ratio.toFixed(3)}`);
}

// 2. Histograms with TRUNCATED zone — should kill the "v≥5 explosion".
console.log('\n=== Histograms with auto-truncated RLE zone (only RLE part) ===');
console.log('save                       v=0      v=1      v=2      v=3     v=4    v=5  v=6  v=7  v=8+');
for (const file of saves) {
  const { body } = loadPlayer(file);
  const zone = body.slice(ZONE_START, FIXED_ZONE_END);
  const rleEnd = detectRleEnd(zone);
  const tiles = decodeRle(zone.slice(0, rleEnd));
  const h = hist(tiles);
  const v8plus = h.slice(8).reduce((a,b)=>a+b, 0);
  console.log(`  ${file.padEnd(24)}  ${h[0].toString().padStart(6)}  ${h[1].toString().padStart(6)}  ${h[2].toString().padStart(6)}  ${h[3].toString().padStart(6)}  ${h[4].toString().padStart(5)}  ${h[5].toString().padStart(3)}  ${h[6].toString().padStart(3)}  ${h[7].toString().padStart(3)}  ${v8plus}`);
}

// 3. What's at the boundary? Hex around rleEnd in athens_t22e
console.log('\n=== Hexdump 64 bytes around RLE-end boundary, athens_t22e ===');
{
  const { body } = loadPlayer('athens_t22e.sav');
  const zone = body.slice(ZONE_START, FIXED_ZONE_END);
  const rleEnd = detectRleEnd(zone);
  const ctx = zone.slice(Math.max(0, rleEnd - 32), Math.min(zone.length, rleEnd + 64));
  let hexStr = '';
  for (let i = 0; i < ctx.length; i++) {
    hexStr += ctx[i].toString(16).padStart(2, '0') + ' ';
    if ((i + 1) % 16 === 0) hexStr += '\n';
  }
  console.log(`Bytes around offset 0x${rleEnd.toString(16)}:\n${hexStr}`);
}

// 4. Verify decoded grid still matches 510*1400=714000 for early saves
console.log('\n=== Decoded grid count, divided by 510 (rows) ===');
for (const file of saves) {
  const { body } = loadPlayer(file);
  const zone = body.slice(ZONE_START, FIXED_ZONE_END);
  const rleEnd = detectRleEnd(zone);
  const tiles = decodeRle(zone.slice(0, rleEnd));
  console.log(`  ${file.padEnd(24)}  rleEnd=0x${rleEnd.toString(16)}  decoded=${tiles.length}  /510=${(tiles.length/510).toFixed(2)}  mod510=${tiles.length%510}`);
}
