// dig-head-6.js — Session 107 / 6 (within budget; supplementary verification)
// Verify the HEAD layout = [event log] + [building-completion records?] + [23.6 KB stride-4 lookup tail]
//
// (a) Find where the building-completion zone ends and the UTF-16-message zone begins.
// (b) Confirm 1 record per ff0aaff0 magic per save.
// (c) Decode the per-msg-record format using the ff0aaff0 anchor.
// (d) Identify what's in the leading "building completion" zone -- if it's per-completion
//     records, the count should correlate with turns played.

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');
const SAVES = ['ror_t1e.sav', 'ror_t2s.sav', 'ror_t5.sav', 'ror_t11s.sav', 'ror_t11e.sav', 'athens_t21.sav', 'athens_t22s.sav', 'athens_t22e.sav'];

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

// Walk the "class-name" record zone and find when it ENDS.
// In ror_t11s, the records go from 0..~0x5983 (right where the magic appears).
// In ror_t5, much smaller zone. In athens_t21, much bigger.

function findClassNameRecords(head) {
  const records = [];
  let i = 0;
  while (i + 2 < head.length) {
    const len = head.readUInt16LE(i);
    if (len >= 8 && len <= 30) {
      let ok = true;
      for (let k = 0; k < len - 1; k++) {
        const c = head[i + 2 + k];
        if (c < 0x20 || c >= 0x7f) { ok = false; break; }
      }
      if (ok && head[i + 2 + len - 1] === 0x00) {
        const s = head.slice(i + 2, i + 2 + len - 1).toString('ascii');
        if (s[0] >= 'A' && s[0] <= 'Z' && /^[A-Za-z_]+$/.test(s) &&
            (s.includes('_Town') || s.includes('_City') || s.includes('_Village') || s.includes('_Polis') ||
             s.includes('Town') || s.includes('City') || s.includes('Capital'))) {
          records.push({ off: i, len, s });
          i += 2 + len;
          continue;
        }
      }
    }
    i++;
  }
  return records;
}

const MAGIC = Buffer.from([0xff, 0x0a, 0xaf, 0xf0]);

console.log(`save                         turns headLen growingZone classRecZone(0..magic)  classRecs  bldgPerTurn  utf16Zone(magic..tailStart)  msgPerTurn`);
const turnsMap = {
  'ror_t1e.sav': 1, 'ror_t2s.sav': 1, 'ror_t5.sav': 5,
  'ror_t11s.sav': 11, 'ror_t11e.sav': 11, 'athens_t21.sav': 21,
  'athens_t22s.sav': 22, 'athens_t22e.sav': 22,
};

for (const sv of SAVES) {
  const { head } = getHead(sv);
  const magicIdx = head.indexOf(MAGIC);
  const tailStart = head.length - 23608;
  const buildRecs = magicIdx > 0 ? findClassNameRecords(head.slice(0, magicIdx)) : [];
  const utf16Zone = magicIdx > 0 ? tailStart - magicIdx : 0;
  const turns = turnsMap[sv] || 0;
  const bldgPerTurn = turns > 0 ? (buildRecs.length / turns).toFixed(1) : '-';
  // Count "Settlement L/G" messages in utf16Zone -> divide by 2
  const lostN = Buffer.from('Settlement Lost', 'utf16le');
  const gainN = Buffer.from('Settlement Gained', 'utf16le');
  let lostCount = 0, gainCount = 0; let p = 0;
  while ((p = head.indexOf(lostN, p)) !== -1) { lostCount++; p++; }
  p = 0;
  while ((p = head.indexOf(gainN, p)) !== -1) { gainCount++; p++; }
  const msgPerTurn = turns > 0 ? ((lostCount + gainCount) / turns).toFixed(1) : '-';
  console.log(`${sv.padEnd(28)} ${turns.toString().padStart(2)}   ${head.length.toString().padStart(8)}  ${(head.length - 23608).toString().padStart(10)}  +0x0..+0x${magicIdx.toString(16).padStart(5,'0')} = ${magicIdx.toString().padStart(7)}  ${buildRecs.length.toString().padStart(7)}  ${bldgPerTurn.padStart(5)}  +0x${magicIdx.toString(16).padStart(5,'0')}..+0x${tailStart.toString(16).padStart(6,'0')} = ${utf16Zone.toString().padStart(8)}  ${msgPerTurn.padStart(5)}`);
}

// Now: walk the message-log zone for ror_t11s and decode each message-record.
// Anchor at the ff0aaff0 magic. From "Settlement msg 0" example:
//   ff 0a af f0  6e ec 45 02  72 ec 45 02  76 ec 45 02
//   3b 08 00 00  09 00 00 00  f2 fe ff ff  02 00 00 00
//   ee 00 00 00  04 00 [UTF16: A b a i]  0f 00 [UTF16: Settlement Lost...]
// Then immediately next msg's data starts.
//
// Structure hypothesis:
//   <ff0aaff0 magic ONCE at start of msg-log zone>
//   <3 x u32 uuids/pointers> <u32 type?> <u32 ???> <u32 0xfffffef2> <u32 02> <u32 enum>
//   <u16 strLen1> <UTF-16 settlement-name>
//   <u16 strLen2> <UTF-16 message-body>
// repeated for each message.

console.log(`\n=== Decoding message-log entries in ror_t11s ===`);
{
  const { head } = getHead('ror_t11s.sav');
  const magicIdx = head.indexOf(MAGIC);
  console.log(`  Magic at +0x${magicIdx.toString(16)}; tail starts +0x${(head.length - 23608).toString(16)}`);
  // Walk forward looking for `f2 fe ff ff` (the recurring marker = 0xfffffef2, looks like a record sub-magic)
  let p = magicIdx;
  const submagic = Buffer.from([0xf2, 0xfe, 0xff, 0xff]);
  let count = 0;
  while (p < head.length - 23608) {
    const next = head.indexOf(submagic, p);
    if (next < 0 || next >= head.length - 23608) break;
    count++;
    p = next + 1;
  }
  console.log(`  Sub-magic 0xfffffef2 count in msg-log zone: ${count}`);
  // Find ALL sub-magic positions and look at deltas
  const positions = [];
  let q = magicIdx;
  while (q < head.length - 23608) {
    const next = head.indexOf(submagic, q);
    if (next < 0 || next >= head.length - 23608) break;
    positions.push(next);
    q = next + 1;
  }
  console.log(`  Position deltas (first 10 deltas):`);
  for (let i = 1; i < 11 && i < positions.length; i++) {
    console.log(`    delta=${positions[i] - positions[i-1]}`);
  }
  // Show first 3 sub-records
  for (let k = 0; k < 3; k++) {
    const recStart = k === 0 ? magicIdx : positions[k - 1];
    const recEnd = positions[k] + 16;
    console.log(`\n  Msg record ${k}: +0x${recStart.toString(16)}..+0x${recEnd.toString(16)} (len=${recEnd - recStart}):`);
    for (let i = recStart; i < Math.min(recEnd, recStart + 128); i += 16) {
      process.stdout.write(`    +0x${i.toString(16).padStart(5,'0')}  `);
      for (let j = 0; j < 16 && i+j < recEnd; j++) process.stdout.write(head[i+j].toString(16).padStart(2,'0')+' ');
      for (let j = (recEnd - i); j < 16; j++) process.stdout.write('   ');
      process.stdout.write('  ');
      for (let j = 0; j < 16 && i+j < recEnd; j++) {
        const c = head[i+j];
        process.stdout.write(c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '.');
      }
      console.log();
    }
  }
}

// Look at the OTHER magics we may have missed - search for more ff0aaff0-similar patterns in HEAD
console.log(`\n=== Search for other 4-byte magics in ror_t11s HEAD ===`);
{
  const { head } = getHead('ror_t11s.sav');
  // Find any 4-byte sequence that starts with 0xff and has 0xf0 in pos 3 (factory pattern)
  // We know ff0aaff0 exists. Look for [ff XX YY f0] patterns
  const candidates = new Map();
  for (let i = 0; i + 4 <= head.length; i++) {
    if (head[i] === 0xff && head[i+3] === 0xf0) {
      const v = head.readUInt32LE(i);
      candidates.set(v, (candidates.get(v) || 0) + 1);
    }
  }
  const sorted = [...candidates.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 10);
  for (const [v, c] of sorted) {
    const b = Buffer.alloc(4); b.writeUInt32LE(v);
    console.log(`  hex=${b.toString('hex')}  count=${c}`);
  }
}

// Per-save building-completion record count vs settlement count (sanity).
// In RIS imperial there are ~240 regions. Each settlement upgrades thru roughly 5-6 tiers in 22 turns of play.
// Expected count of "town -> town_large" type transitions per save ~ 200-500 by mid-late game.
console.log(`\n=== Building-completion record contents (TOP class-name frequencies in ror_t11s 0..magic zone) ===`);
{
  const { head } = getHead('ror_t11s.sav');
  const magicIdx = head.indexOf(MAGIC);
  const recs = findClassNameRecords(head.slice(0, magicIdx));
  const hist = new Map();
  for (const r of recs) hist.set(r.s, (hist.get(r.s) || 0) + 1);
  const sorted = [...hist.entries()].sort((a,b)=>b[1]-a[1]);
  console.log(`  Total records: ${recs.length}`);
  console.log(`  Distinct class-names: ${sorted.length}`);
  for (const [k, v] of sorted) console.log(`    ${k.padEnd(28)}  ${v}`);
}
