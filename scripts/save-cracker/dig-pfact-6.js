// dig-pfact-6.js — Session 102/F
// Two targets:
// (1) Find the "turn_number" Lua counter and read its value across all saves.
//     This is the strongest cross-validation — Lua state is in known UTF-16
//     format and we already see "turn_number" at +0x04bde1 in save_1.2.
// (2) Pin the back-pointer index structure at +0x00c2XX.
//     The structure looks like:
//       - 238 × 4-byte pointers (or fewer) to each faction record in the file
//       - terminated/separated by 0xef000000 (= 239) and 4 × 239 (faction count)
//       - then a "tail" entry with self-pointer + ASCII "roman"
//
// Confirm by: dumping the entire +0x00c000..+0x00cA00 range as 4-byte words.

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');

function loadPlayer(file) {
  const buf = fs.readFileSync(path.join(FIX, file));
  const recs = findFactionRecords(buf);
  let big = recs[0];
  for (const r of recs) if (r.size > big.size) big = r;
  return { buf, recs, big, body: buf.slice(big.offset, big.offset + big.size) };
}

const samples = [
  { label: 'save_10_fresh', file: 'save_10_fresh.sav' },
  { label: 'ror_t1e',       file: 'ror_t1e.sav' },
  { label: 'ror_t2s',       file: 'ror_t2s.sav' },
  { label: 'ror_t5',        file: 'ror_t5.sav' },
  { label: 'ror_t11s',      file: 'ror_t11s.sav' },
  { label: 'ror_t11e',      file: 'ror_t11e.sav' },
  { label: 'save_1.2',      file: 'save_1.2.sav' },
];
for (const s of samples) s.s = loadPlayer(s.file);

// ===== (1) Find "turn_number" in the Lua state section and read the value next to it =====
console.log(`=== "turn_number" Lua-counter value across saves ===`);
function findUtf16(body, str) {
  // Build UTF-16LE bytes for str
  const u = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) {
    u.writeUInt16LE(str.charCodeAt(i), i * 2);
  }
  // Scan
  const hits = [];
  let i = 0;
  while ((i = body.indexOf(u, i)) >= 0) {
    hits.push(i);
    i += 1;
  }
  return hits;
}

for (const s of samples) {
  const hits = findUtf16(s.s.body, 'turn_number');
  console.log(`  ${s.label.padEnd(20)} "turn_number" at ${hits.length === 0 ? 'NOT FOUND' : '+0x' + hits[0].toString(16)}`);
  for (const h of hits) {
    // Look at bytes following "turn_number" (length = 22 bytes for UTF-16)
    const after = h + 22;
    if (after + 16 <= s.s.body.length) {
      const u1 = s.s.body.readUInt32LE(after);
      const u2 = s.s.body.readUInt32LE(after + 4);
      const u3 = s.s.body.readUInt32LE(after + 8);
      const u4 = s.s.body.readUInt32LE(after + 12);
      console.log(`     at offset +0x${after.toString(16)}: u32 ${u1} ${u2} ${u3} ${u4}`);
    }
    // Look at bytes BEFORE the string (4 bytes length prefix is typical)
    const before = h - 4;
    if (before >= 0) {
      const u = s.s.body.readUInt32LE(before);
      console.log(`     u32 before: ${u}`);
    }
  }
}

// ===== (2) Dump the +0x00bf00..+0x00cb00 region of save_1.2 player record =====
console.log(`\n=== Dump +0x00bf00..+0x00cb00 as u32 words (save_1.2 player record) ===`);
{
  const s12 = samples.find(s => s.label === 'save_1.2').s;
  const body = s12.body;
  const REC_ABS = s12.big.offset;
  const start = 0x00bf00;
  const end = 0x00cb00;
  for (let off = start; off + 4 <= end; off += 4) {
    const u = body.readUInt32LE(off);
    let annot = '';
    // Is u plausibly a file pointer?
    if (u > 0x10000 && u < s12.buf.length) {
      // Show first 16 bytes at the destination
      const hex = s12.buf.slice(u, u + 16).toString('hex');
      annot = ` -> abs=0x${u.toString(16)} ${hex}`;
    } else if (u === 0xef) {
      annot = '  (0xef = 239 = faction count)';
    } else if (u >= 0xff_00_00_00) {
      annot = '  (sentinel/magic)';
    } else if (u === 239) {
      annot = '  (239 = faction count)';
    } else if (u === 0) {
      annot = '  (zero)';
    }
    console.log(`  +0x${off.toString(16).padStart(6,'0')} (abs=0x${(REC_ABS+off).toString(16)})  u32=0x${u.toString(16).padStart(8,'0')} (${u})${annot}`);
    if (off - start > 200 && annot === '') {
      // truncate vast spans
      let zeroRun = 0;
      while (off + 4 <= end && body.readUInt32LE(off + 4) === 0) {
        off += 4;
        zeroRun++;
        if (zeroRun > 1000) break;
      }
      if (zeroRun > 4) {
        console.log(`  ... ${zeroRun} consecutive u32 zeros ...`);
      }
    }
  }
}
