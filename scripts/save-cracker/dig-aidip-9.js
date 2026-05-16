// dig-aidip-9.js — Session 103/I
// Verify the 855-byte excess in tile count is from an RLE sentinel mechanic.
// Hypothesis: count=255 (0xFF) is a continuation marker — it means "run
// continues into the next pair with the same value". This is common in
// byte-RLE schemes that need to encode runs > 255.
//
// Test:
//  - Decode with the sentinel rule (255 = continue). If sum becomes exactly
//    714,000, we have a proper decoder.

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

// Decoder A: naive — each pair (v, c) contributes c tiles of value v.
function decodeNaive(zone) {
  let count = 0;
  for (let i = 0; i + 2 <= zone.length; i += 2) count += zone[i+1];
  return count;
}

// Decoder B: <value, count> but value=1 with count=255 is a continuation token
// (since "01 ff" is the most frequent pair: 410 times in save_1.2)
function decodeB_oneFFContinue(zone) {
  let count = 0;
  for (let i = 0; i + 2 <= zone.length; i += 2) {
    const v = zone[i], c = zone[i+1];
    if (v === 1 && c === 0xff) continue; // skip; previous run extends
    count += c;
  }
  return count;
}

// Decoder C: <value, count> with count=255 as continuation (regardless of value)
function decodeC_FFContinue(zone) {
  let count = 0;
  for (let i = 0; i + 2 <= zone.length; i += 2) {
    const v = zone[i], c = zone[i+1];
    if (c === 0xff) {
      count += 255;
      continue;
    }
    count += c;
  }
  return count;
}

// Decoder D: <value, count> but skip pairs where v=0 and c=0 (potential
// padding/terminator)
function decodeD_skipZeros(zone) {
  let count = 0;
  for (let i = 0; i + 2 <= zone.length; i += 2) {
    const v = zone[i], c = zone[i+1];
    if (v === 0 && c === 0) continue;
    count += c;
  }
  return count;
}

// Decoder E: special case — count = 0 means "run of 256 of value v"?
function decodeE_zeroAs256(zone) {
  let count = 0;
  for (let i = 0; i + 2 <= zone.length; i += 2) {
    const v = zone[i], c = zone[i+1];
    count += (c === 0 ? 256 : c);
  }
  return count;
}

const saves = [
  'save_10_fresh.sav', 'save_1.2.sav', 'ror_t1e.sav', 'ror_t2s.sav', 'ror_t5.sav',
  'ror_t11e.sav', 'ror_t11s.sav', 'athens_t21.sav', 'athens_t22e.sav',
];

console.log(`Expected map tiles: 1020 × 700 = ${1020*700}`);
console.log(`save                       naive    1ffSkip   ffSkip    zeroOK   zeroAs256`);
for (const s of saves) {
  const { body } = loadPlayer(s);
  const zone = body.slice(ZONE_START, ZONE_END);
  const a = decodeNaive(zone);
  const b = decodeB_oneFFContinue(zone);
  const c = decodeC_FFContinue(zone);
  const d = decodeD_skipZeros(zone);
  const e = decodeE_zeroAs256(zone);
  console.log(`  ${s.padEnd(24)}  ${a}  ${b}  ${c}  ${d}  ${e}`);
}

// Count c=0 occurrences
console.log(`\n=== c=0 pair counts ===`);
for (const s of saves) {
  const { body } = loadPlayer(s);
  const zone = body.slice(ZONE_START, ZONE_END);
  let zeroC = 0, oneFF = 0, anyFF = 0;
  for (let i = 0; i + 2 <= zone.length; i += 2) {
    const v = zone[i], c = zone[i+1];
    if (c === 0) zeroC++;
    if (v === 1 && c === 0xff) oneFF++;
    if (c === 0xff) anyFF++;
  }
  console.log(`  ${s.padEnd(24)}  c=0:${zeroC}  c=ff:${anyFF}  v=1,c=ff:${oneFF}`);
}

// Test: how does the naive vs sum-1020*700 difference relate to count of 0x01 0xff?
// Saves with more 01ff pairs should have more excess.
console.log(`\n=== Naive count - expected (855 should correlate with 01ff count) ===`);
for (const s of saves) {
  const { body } = loadPlayer(s);
  const zone = body.slice(ZONE_START, ZONE_END);
  let oneFF = 0;
  for (let i = 0; i + 2 <= zone.length; i += 2) {
    if (zone[i] === 1 && zone[i+1] === 0xff) oneFF++;
  }
  const excess = decodeNaive(zone) - 1020 * 700;
  console.log(`  ${s.padEnd(24)}  excess=${excess}  01ff_pairs=${oneFF}  ratio=${excess && oneFF ? (excess/oneFF).toFixed(2) : 'n/a'}`);
}
