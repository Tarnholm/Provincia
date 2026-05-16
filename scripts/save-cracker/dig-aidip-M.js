// dig-aidip-M.js — Session 105/J
// Round-trip on save_1.2 broke at offset 0xc1b2 (zone-relative). The
// RLE block ends BEFORE 0xc264 even in save_1.2 (which has no ASCII
// strings). Investigate where the real end of RLE is.

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');
const ZONE_START = 0x18;
const FIXED_END = 0x0c264;

function loadPlayer(file) {
  const buf = fs.readFileSync(path.join(FIX, file));
  const recs = findFactionRecords(buf);
  let big = recs[0]; for (const r of recs) if (r.size > big.size) big = r;
  return { buf, recs, player: big, body: buf.slice(big.offset, big.offset + big.size), file };
}

function decodeRle(bytes) {
  const tiles = [];
  for (let i = 0; i + 2 <= bytes.length; i += 2) {
    const v = bytes[i], c = bytes[i+1];
    for (let k = 0; k < c; k++) tiles.push(v);
  }
  return tiles;
}

function encodeRle(tiles) {
  const pairs = [];
  let i = 0;
  while (i < tiles.length) {
    const v = tiles[i];
    let c = 0;
    while (i < tiles.length && tiles[i] === v && c < 255) { c++; i++; }
    pairs.push(v, c);
  }
  return Buffer.from(pairs);
}

// Strategy: find the longest prefix where RLE round-trip works.
function findRleEnd(zone) {
  // Walk the RLE pairs. Mismatch happens when a pair has count=0 (illegal
  // in our encoder which always uses count >= 1), or when consecutive
  // pairs share the same value (which a maximal encoder would merge).
  // The real engine encoding might not be maximal — it might split runs
  // at 255 even when more could be fit. But pair[i]=<v,0> can never come
  // from valid RLE.
  let lastGood = 0;
  for (let i = 0; i + 2 <= zone.length; i += 2) {
    const v = zone[i], c = zone[i+1];
    if (c === 0) break; // illegal RLE pair = end of block
    // also detect a sudden value spike inconsistent with tile values: most
    // tile values are 0..11; a value >= 64 is suspicious (and likely a
    // u32 length prefix or ASCII)
    lastGood = i + 2;
  }
  return lastGood;
}

console.log('=== Find true RLE-block length by round-trip ===');
for (const file of ['save_10_fresh.sav', 'save_1.2.sav', 'ror_t1e.sav', 'ror_t2s.sav', 'ror_t5.sav', 'ror_t11s.sav', 'athens_t22e.sav']) {
  const { body } = loadPlayer(file);
  const zone = body.slice(ZONE_START, FIXED_END);
  const trueEnd = findRleEnd(zone);
  const tiles = decodeRle(zone.slice(0, trueEnd));
  console.log(`  ${file.padEnd(24)}  trueRleEnd=0x${trueEnd.toString(16)}  decoded=${tiles.length}  decoded/510=${(tiles.length/510).toFixed(2)}`);
}

console.log('\n=== Hexdump 64 bytes after true RLE end, save_1.2 ===');
{
  const { body } = loadPlayer('save_1.2.sav');
  const zone = body.slice(ZONE_START, FIXED_END);
  const trueEnd = findRleEnd(zone);
  console.log(`trueRleEnd in zone: 0x${trueEnd.toString(16)}`);
  const tail = zone.slice(trueEnd, trueEnd + 64);
  let hex = '';
  for (let i = 0; i < tail.length; i++) {
    hex += tail[i].toString(16).padStart(2, '0') + ' ';
    if ((i + 1) % 16 === 0) hex += '\n';
  }
  console.log(hex);
}

console.log('\n=== Hexdump 64 bytes after true RLE end, save_10_fresh ===');
{
  const { body } = loadPlayer('save_10_fresh.sav');
  const zone = body.slice(ZONE_START, FIXED_END);
  const trueEnd = findRleEnd(zone);
  console.log(`trueRleEnd in zone: 0x${trueEnd.toString(16)}`);
  const tail = zone.slice(trueEnd, trueEnd + 64);
  let hex = '';
  for (let i = 0; i < tail.length; i++) {
    hex += tail[i].toString(16).padStart(2, '0') + ' ';
    if ((i + 1) % 16 === 0) hex += '\n';
  }
  console.log(hex);
}

// Verify final round-trip: encode tiles + concat with trailing bytes equals
// original zone exactly.
console.log('\n=== Final round-trip with proper RLE end ===');
for (const file of ['save_1.2.sav', 'save_10_fresh.sav']) {
  const { body } = loadPlayer(file);
  const zone = body.slice(ZONE_START, FIXED_END);
  const trueEnd = findRleEnd(zone);
  const tiles = decodeRle(zone.slice(0, trueEnd));
  const reRle = encodeRle(tiles);
  const trailing = zone.slice(trueEnd);
  const reBuilt = Buffer.concat([reRle, trailing]);
  const same = Buffer.compare(reBuilt, zone) === 0;
  console.log(`  ${file}: round-trip identical: ${same ? 'YES' : 'NO'}  reBuiltLen=${reBuilt.length} origLen=${zone.length}`);
}
