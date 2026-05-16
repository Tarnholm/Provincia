// dig-cpool-3.js — Session 106 / 3
// Two main goals:
// (1) Locate the culture/name-pool zone in late-game saves by anchoring on the FIRST "barbarian" string
//     rather than the static +0x0c400 offset. Late saves have a grown Lua zone, but the name-pool
//     zone should still exist between AI-diplo grid end and Lua zone start.
// (2) Once located, walk each pool record and:
//       - Find the structure: <u16 strLen> <ASCII strLen bytes> then <u32 count?> <u32[] indices>
//       - Compare values between turns to see what's "consumed" (a name pool being drained)

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');
const SAVES = [
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

// In the player faction record, find the FIRST occurrence of the byte sequence
// <u16 strLen=10> <"barbarian\0"> = 0a 00 62 61 72 62 61 72 69 61 6e 00
function findFirstBarbarian(buf, recStart, recEnd) {
  const needle = Buffer.from([0x0a, 0x00, 0x62, 0x61, 0x72, 0x62, 0x61, 0x72, 0x69, 0x61, 0x6e, 0x00]);
  for (let i = recStart; i + needle.length < recEnd; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (buf[i + j] !== needle[j]) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}

// Walk pool records starting from a given offset; for each `<u16 strLen> <ASCII strLen bytes>`
// (terminator nul allowed), record its position and content. Stops on a sentinel or out-of-bounds.
function walkPoolRecords(buf, start, end) {
  const found = [];
  let i = start;
  while (i + 3 < end) {
    const strLen = buf.readUInt16LE(i);
    if (strLen < 3 || strLen > 30) { i++; continue; }
    if (i + 2 + strLen > end) break;
    // Check ASCII
    let ok = true;
    let txt = '';
    for (let j = 0; j < strLen; j++) {
      const b = buf[i + 2 + j];
      if (b === 0 && j === strLen - 1) break;
      if (b < 0x20 || b >= 0x7f) { ok = false; break; }
      txt += String.fromCharCode(b);
    }
    if (!ok || !/[a-zA-Z]/.test(txt)) { i++; continue; }
    // Match pool keys
    if (!/_men$|_women$|_surnames$/.test(txt) && !['barbarian','greek','eastern','egyptian','roman','carthaginian','nomad','parthian','blank'].includes(txt)) {
      i++; continue;
    }
    found.push({ off: i, strLen, text: txt });
    // Advance by 2+strLen (we'll re-scan; intervening data may contain false matches in the table)
    i += 2 + strLen;
  }
  return found;
}

const allResults = {};

for (const saveName of SAVES) {
  console.log(`\n=== ${saveName} ===`);
  const buf = fs.readFileSync(path.join(FIX, saveName));
  const recs = findFactionRecords(buf);
  const player = recs[recs.length - 1];
  const REC = player.offset;
  const recEnd = REC + player.size;

  // Find FIRST barbarian in the player record (whole record - more robust to zone shifts)
  const firstBarbAbs = findFirstBarbarian(buf, REC, recEnd);
  if (firstBarbAbs < 0) {
    console.log(`  No "barbarian" string found in player record!`);
    continue;
  }
  console.log(`  Player rec abs=0x${REC.toString(16)} size=${player.size}`);
  console.log(`  First "barbarian" abs=0x${firstBarbAbs.toString(16)} (rel +0x${(firstBarbAbs - REC).toString(16)})`);

  // Walk forward from firstBarbAbs - estimate zone end as start of Lua zone
  // Lua zone starts with magic UTF-16 'd' (0x64 0x00) or simply find "RIS_Campaign_Script" string
  // Or just walk until we hit a clear sentinel (e.g. <u32 magic == 53 = 0x35>)
  // For now use 500 KB or end of player record, whichever first
  const walkEnd = Math.min(firstBarbAbs + 500 * 1024, recEnd);
  const records = walkPoolRecords(buf, firstBarbAbs, walkEnd);
  console.log(`  Pool records found: ${records.length}`);

  // Show first 5 and last 5
  for (const r of records.slice(0, 5)) {
    console.log(`    abs=0x${r.off.toString(16)}  strLen=${r.strLen}  "${r.text}"`);
  }
  if (records.length > 10) {
    console.log(`    ...`);
    for (const r of records.slice(-5)) {
      console.log(`    abs=0x${r.off.toString(16)}  strLen=${r.strLen}  "${r.text}"`);
    }
  }

  // Compute sizes
  console.log(`  Record sizes (first 8):`);
  for (let k = 1; k < Math.min(records.length, 9); k++) {
    console.log(`    ${records[k-1].text.padEnd(14)} -> ${records[k].text.padEnd(14)}: delta=${records[k].off - records[k-1].off}`);
  }

  // Look at the BARBARIAN records — how do their u32 indices change between turns?
  // Get the contents of the first barbarian record
  if (records.length >= 2) {
    const r0 = records[0];
    const r1 = records[1];
    const bodyStart = r0.off + 2 + r0.strLen; // after string
    const bodyEnd = r1.off;
    const body = buf.slice(bodyStart, bodyEnd);
    // First several u32 values
    const firstU32s = [];
    for (let i = 0; i + 4 <= body.length && firstU32s.length < 16; i += 4) {
      firstU32s.push(body.readUInt32LE(i));
    }
    console.log(`  First barbarian body: ${body.length} B, first 16 u32 = ${firstU32s.join(',')}`);
  }

  allResults[saveName] = {
    recordOffset: REC,
    recordSize: player.size,
    firstBarbAbs,
    firstBarbRel: firstBarbAbs - REC,
    poolRecordsCount: records.length,
    records: records.map(r => ({ off: r.off, rel: r.off - REC, strLen: r.strLen, text: r.text })),
  };
}

// Cross-save comparison
console.log('\n=== Cross-save comparison ===');
console.log('save                              poolRecs  firstBarbRel');
for (const sv of SAVES) {
  const r = allResults[sv];
  if (!r) { console.log(`${sv.padEnd(35)} ABSENT`); continue; }
  console.log(`${sv.padEnd(35)} ${String(r.poolRecordsCount).padStart(4)}   +0x${r.firstBarbRel.toString(16)}`);
}

// Save JSON
fs.writeFileSync(path.join(__dirname, 'out-cpool-3.json'), JSON.stringify(allResults, null, 2));
console.log('\nWrote out-cpool-3.json');
