// dig-head-8.js — Session 107 / 8
// Verify hypotheses:
//  (a) t11s -> t11e: what records get APPENDED in the building-completion zone?
//      The growing zone goes from 5983 -> 5a68 (+229 bytes, ~4 new records).
//  (b) Does HEAD survive a turn-end save -> turn-start save (clear / preserve)?
//      Test: ror_t11e -> any next start save? We don't have ror_t12s.
//      Best surrogate: athens_t22s -> athens_t22e (same turn 22, t22e=end of turn 22).
//      Compare to athens_t21 -> athens_t22s (full turn end-to-end-then-start).
//  (c) Confirm the message-zone f2fefffff submagic pattern is "Settlement Lost+Gained" pair.

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');

function findFirstBarbarian(buf, recStart, recEnd) {
  const needle = Buffer.from([0x0a, 0x00, 0x62, 0x61, 0x72, 0x62, 0x61, 0x72, 0x69, 0x61, 0x6e, 0x00]);
  for (let i = recStart; i + needle.length < recEnd; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) if (buf[i + j] !== needle[j]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}

function getHead(savFile) {
  const buf = fs.readFileSync(path.join(FIX, savFile));
  const recs = findFactionRecords(buf);
  const player = recs[recs.length - 1];
  const REC = player.offset;
  const firstBarb = findFirstBarbarian(buf, REC, REC + player.size);
  return { head: buf.slice(REC + 0xc400, firstBarb), file: savFile };
}

const MAGIC = Buffer.from([0xff, 0x0a, 0xaf, 0xf0]);

function walkBuildingRecs(head, magicIdx) {
  const out = [];
  let i = 0;
  while (i < magicIdx - 2) {
    const len = head.readUInt16LE(i);
    if (len < 8 || len > 30) { i++; continue; }
    let ok = true;
    for (let k = 0; k < len - 1; k++) {
      const c = head[i + 2 + k];
      if (c < 0x20 || c >= 0x7f) { ok = false; break; }
    }
    if (!ok || head[i + 2 + len - 1] !== 0) { i++; continue; }
    const s = head.slice(i + 2, i + 2 + len - 1).toString('ascii');
    if (!(s[0] >= 'A' && s[0] <= 'Z') || !/^[A-Za-z_]+$/.test(s)) { i++; continue; }
    out.push({ off: i, len, s });
    i += 2 + len;
  }
  return out;
}

// Compare ror_t11s vs ror_t11e: list building-completion records added during T11
console.log(`=== Building-zone diff ror_t11s -> ror_t11e ===`);
{
  const t11s = getHead('ror_t11s.sav');
  const t11e = getHead('ror_t11e.sav');
  const m11s = t11s.head.indexOf(MAGIC);
  const m11e = t11e.head.indexOf(MAGIC);
  const recs11s = walkBuildingRecs(t11s.head, m11s);
  const recs11e = walkBuildingRecs(t11e.head, m11e);
  console.log(`  t11s nRecs=${recs11s.length}, magic=+0x${m11s.toString(16)}`);
  console.log(`  t11e nRecs=${recs11e.length}, magic=+0x${m11e.toString(16)}`);
  // Are records appended at end or scattered?
  // Compare class-name sequences from end
  let common = 0;
  while (common < Math.min(recs11s.length, recs11e.length)) {
    const a = recs11s[recs11s.length - 1 - common];
    const b = recs11e[recs11e.length - 1 - common];
    if (a.s !== b.s) break;
    common++;
  }
  console.log(`  Common suffix records: ${common}`);
  let commonPrefix = 0;
  while (commonPrefix < Math.min(recs11s.length, recs11e.length)) {
    if (recs11s[commonPrefix].s !== recs11e[commonPrefix].s) break;
    commonPrefix++;
  }
  console.log(`  Common prefix records: ${commonPrefix}`);
  // Show the records that t11e has but t11s doesn't, focusing on the diff region.
  console.log(`  Records t11e but not t11s (by suffix-of-t11e):`);
  const added = recs11e.slice(commonPrefix, recs11e.length - common);
  for (const r of added.slice(0, 10)) console.log(`    +0x${r.off.toString(16)}  ${JSON.stringify(r.s)}`);
}

// Compare athens_t21 -> athens_t22s: full turn 21->22 transition
console.log(`\n=== Building-zone diff athens_t21 -> athens_t22s ===`);
{
  const t21 = getHead('athens_t21.sav');
  const t22s = getHead('athens_t22s.sav');
  const mt21 = t21.head.indexOf(MAGIC);
  const mt22s = t22s.head.indexOf(MAGIC);
  const recs21 = walkBuildingRecs(t21.head, mt21);
  const recs22s = walkBuildingRecs(t22s.head, mt22s);
  console.log(`  athens_t21  nRecs=${recs21.length}, magic=+0x${mt21.toString(16)}, headLen=${t21.head.length}`);
  console.log(`  athens_t22s nRecs=${recs22s.length}, magic=+0x${mt22s.toString(16)}, headLen=${t22s.head.length}`);
  let common = 0;
  while (common < Math.min(recs21.length, recs22s.length)) {
    const a = recs21[recs21.length - 1 - common];
    const b = recs22s[recs22s.length - 1 - common];
    if (a.s !== b.s) break;
    common++;
  }
  let commonPrefix = 0;
  while (commonPrefix < Math.min(recs21.length, recs22s.length)) {
    if (recs21[commonPrefix].s !== recs22s[commonPrefix].s) break;
    commonPrefix++;
  }
  console.log(`  Common prefix records: ${commonPrefix}`);
  console.log(`  Common suffix records: ${common}`);
}

// Verify "Settlement Lost" / "Settlement Gained" pair counts and decoding
console.log(`\n=== Settlement Lost/Gained message-record decoding (ror_t11s) ===`);
{
  const { head } = getHead('ror_t11s.sav');
  // Find sub-magic positions
  const submagic = Buffer.from([0xf2, 0xfe, 0xff, 0xff]);
  const positions = [];
  let p = 0;
  while (p < head.length) {
    const next = head.indexOf(submagic, p);
    if (next < 0) break;
    positions.push(next);
    p = next + 1;
  }
  console.log(`  Total submagic positions: ${positions.length}`);
  // Tail-only positions
  const magicIdx = head.indexOf(MAGIC);
  const msgZoneEnd = head.length - 23608;
  const inMsgZone = positions.filter(p => p > magicIdx && p < msgZoneEnd);
  console.log(`  In msg zone (between ff0aaff0 magic and tail): ${inMsgZone.length}`);

  // Show pair-of-pairs structure: each "Settlement Lost" event has a corresponding "Settlement Gained" event.
  // Decode the first 4 sub-records' fields starting at submagic.
  // From dig-head-6 we saw:
  //   Msg record 2: f2 fe ff ff 02 00 00 00 [01 1c c1 03 (some pointer) 24 07 00 00 (some count?)] 00 [ee 00 00 00] [5f ed 45 02] 0a 00 00 00 ...
  // So submagic + u32(2) + u32(stuff) + u32(stuff) + ... then 0a 00 -> next sub-record's start?
  // Let me look at one message in full.

  // Find "Settlement Lost" UTF-16LE
  const lostN = Buffer.from('Settlement Lost', 'utf16le');
  let lostP = head.indexOf(lostN, magicIdx);
  console.log(`\n  First "Settlement Lost" UTF-16 at +0x${lostP.toString(16)}`);
  // Print the 256 bytes BEFORE and 256 bytes AFTER
  const ctxStart = Math.max(magicIdx, lostP - 96);
  const ctxEnd = Math.min(msgZoneEnd, lostP + 256);
  for (let i = ctxStart; i < ctxEnd; i += 16) {
    process.stdout.write(`    +0x${i.toString(16).padStart(5,'0')}  `);
    for (let j = 0; j < 16 && i+j < ctxEnd; j++) process.stdout.write(head[i+j].toString(16).padStart(2,'0')+' ');
    for (let j = (ctxEnd - i); j < 16; j++) process.stdout.write('   ');
    process.stdout.write('  ');
    for (let j = 0; j < 16 && i+j < ctxEnd; j++) {
      const c = head[i+j];
      process.stdout.write(c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '.');
    }
    console.log();
  }
}

// Check: HEAD-of-athens_t22s vs HEAD-of-athens_t22e: what changes WITHIN a turn?
console.log(`\n=== athens_t22s -> athens_t22e (within-turn) message-record changes ===`);
{
  const A = getHead('athens_t22s.sav');
  const B = getHead('athens_t22e.sav');
  // Building zones (0..magic) -- should be identical (already saw they are)
  const mA = A.head.indexOf(MAGIC);
  const mB = B.head.indexOf(MAGIC);
  console.log(`  athens_t22s magic at +0x${mA.toString(16)}; t22e magic at +0x${mB.toString(16)}`);
  const bldgEqual = mA === mB && Buffer.compare(A.head.slice(0, mA), B.head.slice(0, mB)) === 0;
  console.log(`  Building zone identical (0..magic): ${bldgEqual}`);
  // Message zone
  const tailA = A.head.length - 23608;
  const tailB = B.head.length - 23608;
  console.log(`  Msg-zone size diff: t22s=${tailA-mA}, t22e=${tailB-mB}, delta=${(tailB-mB)-(tailA-mA)}`);
  // Tail of head equal?
  const tA = A.head.slice(tailA);
  const tB = B.head.slice(tailB);
  console.log(`  Tail (last 23608 bytes) identical: ${Buffer.compare(tA, tB) === 0}`);
}

// Final summary: ratio of building-completion vs UTF-16 message growth per save
console.log(`\n=== Summary: HEAD zone sizes per save ===`);
const SAVES = ['save_10_fresh.sav', 'ror_t1e.sav', 'ror_t2s.sav', 'ror_t5.sav', 'ror_t11s.sav', 'ror_t11e.sav', 'athens_t21.sav', 'athens_t22s.sav', 'athens_t22e.sav'];
console.log(`save                    headLen   bldgZone  msgZone  lookupTail`);
for (const sv of SAVES) {
  const { head } = getHead(sv);
  const m = head.indexOf(MAGIC);
  const tailStart = head.length - 23608;
  const bldg = m > 0 ? m : Math.max(0, head.length - 23608);
  const msg = m > 0 ? tailStart - m : 0;
  console.log(`${sv.padEnd(24)} ${head.length.toString().padStart(8)}  ${bldg.toString().padStart(8)}  ${msg.toString().padStart(7)}   ${(head.length >= 23608 ? 23608 : head.length).toString().padStart(8)}`);
}
