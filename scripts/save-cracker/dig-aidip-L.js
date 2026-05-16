// dig-aidip-L.js — Session 105/I
// Byte-identical round-trip verification on save_1.2:
//   - read player faction body
//   - decode auto-truncated RLE
//   - re-encode tiles back to bytes
//   - confirm bytes match (within the truncated range)
// This is per-session discipline. If round-trip fails, our decoder is wrong.

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');
const ZONE_START = 0x18;

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

const FIXED_END = 0x0c264;

console.log('=== Round-trip RLE encode/decode on full zone for several saves ===');
for (const file of ['save_10_fresh.sav', 'save_1.2.sav', 'ror_t1e.sav']) {
  const { body } = loadPlayer(file);
  const zone = body.slice(ZONE_START, FIXED_END);
  const tiles = decodeRle(zone);
  const reEncoded = encodeRle(tiles);
  const matchLen = Math.min(zone.length, reEncoded.length);
  let mismatch = -1;
  for (let i = 0; i < matchLen; i++) {
    if (zone[i] !== reEncoded[i]) { mismatch = i; break; }
  }
  console.log(`  ${file}  zoneLen=${zone.length}  reEncodedLen=${reEncoded.length}  mismatchAt=${mismatch}  (must be -1 + lengths equal for byte-identical)`);
}

// More interesting test: re-encoding the decoded tile stream from save_1.2
// should produce exactly the same bytes as the original.
console.log('\n=== save_1.2 detail ===');
{
  const { body } = loadPlayer('save_1.2.sav');
  const zone = body.slice(ZONE_START, FIXED_END);
  const tiles = decodeRle(zone);
  const reEncoded = encodeRle(tiles);
  const same = zone.length === reEncoded.length && Buffer.compare(zone, reEncoded) === 0;
  console.log(`  Byte-identical: ${same ? 'YES' : 'NO'}`);
  if (!same) {
    console.log(`  zoneLen=${zone.length}  reEncodedLen=${reEncoded.length}`);
    // Locate first mismatch
    const minLen = Math.min(zone.length, reEncoded.length);
    for (let i = 0; i < minLen; i++) {
      if (zone[i] !== reEncoded[i]) {
        console.log(`  First mismatch at offset ${i} (0x${i.toString(16)}): orig=0x${zone[i].toString(16)} reEnc=0x${reEncoded[i].toString(16)}`);
        const ctx = (b, lo, hi) => {
          let s = '';
          for (let j = lo; j < Math.min(hi, b.length); j++) {
            s += b[j].toString(16).padStart(2, '0') + ' ';
          }
          return s;
        };
        console.log(`  orig context [${i-8}..${i+24}]: ${ctx(zone, i-8, i+24)}`);
        console.log(`  reEnc context [${i-8}..${i+24}]: ${ctx(reEncoded, i-8, i+24)}`);
        break;
      }
    }
  }
}
