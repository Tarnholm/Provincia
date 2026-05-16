// dig-cpool-A.js — Session 106 / A
// (1) Map out the GAP between AI-diplo zone (record-rel +0xc400) and the first pool record.
// (2) Confirm this gap is the "character record zone" - growing dramatically with campaign progression.

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');
const SAVES = [
  'save_10_fresh.sav', 'save_1.2.sav', 'ror_t1e.sav',
  'ror_t2s.sav', 'ror_t5.sav', 'ror_t11s.sav',
  'ror_t11e.sav', 'athens_t21.sav', 'athens_t22e.sav',
];

function findFirstBarbarian(buf, recStart, recEnd) {
  const needle = Buffer.from([0x0a, 0x00, 0x62, 0x61, 0x72, 0x62, 0x61, 0x72, 0x69, 0x61, 0x6e, 0x00]);
  for (let i = recStart; i + needle.length < recEnd; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) if (buf[i + j] !== needle[j]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}

// Look at the GAP from rec+0xc400 to firstBarb
console.log('=== Gap from +0xc400 to firstBarbarian per save ===');
console.log('save                              gap_rel_start  gap_rel_end  gap_len  nonzero%  uniqueU32');
for (const sv of SAVES) {
  const buf = fs.readFileSync(path.join(FIX, sv));
  const recs = findFactionRecords(buf);
  const player = recs[recs.length - 1];
  const REC = player.offset;
  const firstBarb = findFirstBarbarian(buf, REC, REC + player.size);
  const gapStart = REC + 0xc400;
  const gapEnd = firstBarb;
  const gap = buf.slice(gapStart, gapEnd);
  let nz = 0;
  for (const b of gap) if (b !== 0) nz++;
  // u32 unique-value count
  const u32s = new Set();
  for (let i = 0; i + 4 <= gap.length; i += 4) u32s.add(gap.readUInt32LE(i));
  console.log(`${sv.padEnd(35)} +0xc400  +0x${(gapEnd-REC).toString(16)}  ${String(gap.length).padStart(7)}  ${(100*nz/gap.length).toFixed(1).padStart(5)}%  ${u32s.size}`);
}

// Look at the structure of the gap in save_1.2 (mid-campaign, ~23.5 KB gap)
console.log('\n=== Gap structure analysis for save_1.2 ===');
{
  const sv = 'save_1.2.sav';
  const buf = fs.readFileSync(path.join(FIX, sv));
  const recs = findFactionRecords(buf);
  const player = recs[recs.length - 1];
  const REC = player.offset;
  const firstBarb = findFirstBarbarian(buf, REC, REC + player.size);
  const gap = buf.slice(REC + 0xc400, firstBarb);

  // First 256 u32 values
  console.log(`Gap length: ${gap.length} bytes`);
  console.log(`First 64 u32:`);
  for (let i = 0; i < 64; i++) {
    const v = gap.readUInt32LE(i*4);
    process.stdout.write(String(v).padStart(5)+' ');
    if ((i+1) % 8 === 0) console.log();
  }

  // Look for inner structure: stride autocorrelation
  console.log('\n  Stride autocorrelation:');
  for (let stride = 4; stride <= 64; stride += 4) {
    let m = 0, t = 0;
    for (let i = 0; i + stride < gap.length; i++) {
      t++;
      if (gap[i] === gap[i + stride]) m++;
    }
    if (100*m/t > 30) {
      console.log(`    stride=${stride}: ${(100*m/t).toFixed(1)}%`);
    }
  }

  // Look for potential record markers - clusters of consecutive non-zero stride-4 u32s
  // Walk in 4-byte steps, find "blocks" of size N stride-4 values
  let blockStart = -1, lastNonZero = -2;
  const blocks = [];
  for (let i = 0; i + 4 <= gap.length; i += 4) {
    const v = gap.readUInt32LE(i);
    if (v !== 0) {
      if (blockStart < 0) blockStart = i;
      lastNonZero = i;
    } else {
      if (blockStart >= 0 && i - lastNonZero >= 16) {
        blocks.push({ s: blockStart, e: lastNonZero + 4, len: lastNonZero + 4 - blockStart });
        blockStart = -1;
      }
    }
  }
  if (blockStart >= 0) blocks.push({ s: blockStart, e: gap.length, len: gap.length - blockStart });
  console.log(`\n  Blocks (>=16 zero u32 separation): ${blocks.length}`);
  const blockSizes = {};
  for (const b of blocks) blockSizes[b.len] = (blockSizes[b.len] || 0) + 1;
  console.log(`  Block-size histogram:`, Object.entries(blockSizes).sort((a,b)=>b[1]-a[1]).slice(0, 10));
  console.log(`  First 10 blocks:`);
  for (const b of blocks.slice(0, 10)) {
    console.log(`    gap+0x${b.s.toString(16).padStart(4)}  len=${b.len}  first_u32s=${[0,1,2,3].map(k=>gap.readUInt32LE(b.s + k*4)).join(',')}`);
  }
}

// Also examine the START of the zone (record +0x18..+0xc400, the AI-diplo grid)
// We already know this is RLE stride-2 (session 103). But what's at the boundary +0xc400 exactly?
console.log('\n=== Bytes around the boundary at rec+0xc400 (save_1.2) ===');
{
  const sv = 'save_1.2.sav';
  const buf = fs.readFileSync(path.join(FIX, sv));
  const recs = findFactionRecords(buf);
  const player = recs[recs.length - 1];
  const REC = player.offset;
  console.log(`  bytes at rec+0xc3f0 to rec+0xc450:`);
  for (let i = 0xc3f0; i < 0xc450; i += 16) {
    process.stdout.write(`    +0x${i.toString(16)}  `);
    for (let j = 0; j < 16; j++) process.stdout.write(buf[REC + i + j].toString(16).padStart(2,'0')+' ');
    process.stdout.write('  ');
    for (let j = 0; j < 16; j++) {
      const c = buf[REC + i + j];
      process.stdout.write(c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '.');
    }
    console.log();
  }
}

// Where does the AI grid actually END? In session 103 it was claimed 0..0xc400 is the diplo grid.
// Find the last non-zero stride-2 RLE-style byte: scan backward from 0xc400.
console.log('\n=== Where does the diplo zone end? (save_1.2) ===');
{
  const sv = 'save_1.2.sav';
  const buf = fs.readFileSync(path.join(FIX, sv));
  const recs = findFactionRecords(buf);
  const player = recs[recs.length - 1];
  const REC = player.offset;
  // Look for the last byte that's not 0x00 in the range [0..0xc400]
  for (let i = 0xc400 - 1; i >= 0xc000; i--) {
    if (buf[REC + i] !== 0) {
      console.log(`  Last non-zero byte before +0xc400: at +0x${i.toString(16)} = 0x${buf[REC + i].toString(16)}`);
      // Show a few bytes around it
      console.log(`  Context: rec+0x${(i-12).toString(16)}..+0x${(i+4).toString(16)} = ${buf.slice(REC + i - 12, REC + i + 5).toString('hex')}`);
      break;
    }
  }
}
