// dig-head-1.js — Session 107 / 1
// Goal: Confirm HEAD start = rec+0xc400 and HEAD end = firstBarbAbs.
// Report sizes across all saves. Verify 23 KB -> 1 MB monotonic growth.

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');
const SAVES = [
  'save_10_fresh.sav', 'save_1.2.sav',
  'save_mp_before.sav', 'save_mp_after.sav',
  'ror_t1e.sav', 'ror_t2s.sav', 'ror_t5.sav',
  'ror_t11s.sav', 'ror_t11e.sav',
  'athens_t21.sav', 'athens_t22s.sav', 'athens_t22mid.sav', 'athens_t22e.sav',
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

console.log('=== HEAD region (rec+0xc400 .. firstBarbAbs) per save ===');
console.log('save                            recOff  recSize  firstBarb-recOff   headSize  headKB');
for (const sv of SAVES) {
  const buf = fs.readFileSync(path.join(FIX, sv));
  const recs = findFactionRecords(buf);
  const player = recs[recs.length - 1];
  const REC = player.offset;
  const firstBarb = findFirstBarbarian(buf, REC, REC + player.size);
  const headStart = REC + 0xc400;
  const headEnd = firstBarb;
  const headSize = headEnd - headStart;
  console.log(`${sv.padEnd(32)} 0x${REC.toString(16).padStart(7,'0')}  ${player.size.toString().padStart(8)}  +0x${(firstBarb-REC).toString(16).padStart(7,'0')}  ${headSize.toString().padStart(8)}  ${(headSize/1024).toFixed(1)}`);
}
