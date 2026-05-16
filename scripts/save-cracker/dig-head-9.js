// dig-head-9.js — Session 107 / 9 (verification of tail-lookup stability)
// Verify: the 23.6 KB tail lookup is the SAME across all saves, or does it vary?

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

const SAVES = ['save_10_fresh.sav', 'save_mp_before.sav', 'save_mp_after.sav', 'ror_t1e.sav', 'ror_t2s.sav', 'ror_t11s.sav', 'athens_t21.sav', 'athens_t22e.sav'];

console.log(`=== Tail-lookup byte-identity check ===`);
const tails = {};
for (const sv of SAVES) {
  const { head } = getHead(sv);
  const tail = head.slice(head.length - 23608);
  tails[sv] = tail;
}

// Cross-compare all
console.log(`Hash (first 8 bytes hex + length):`);
for (const sv of SAVES) {
  const t = tails[sv];
  const head8 = t.slice(0, 8).toString('hex');
  // compute byte sum as cheap hash
  let s = 0;
  for (const b of t) s = (s + b) & 0xffffffff;
  console.log(`  ${sv.padEnd(28)} len=${t.length}  firstBytes=${head8}  byteSum=${s}`);
}

console.log(`\nPairwise byte-identity (count of mismatching bytes):`);
const base = tails['save_10_fresh.sav'];
for (const sv of SAVES) {
  const t = tails[sv];
  if (t.length !== base.length) {
    console.log(`  ${sv.padEnd(28)} length differs (${t.length} vs ${base.length})`);
    continue;
  }
  let mm = 0;
  for (let i = 0; i < t.length; i++) if (t[i] !== base[i]) mm++;
  console.log(`  ${sv.padEnd(28)} mismatches=${mm} / ${t.length}`);
}

// Top u32 values in the lookup tail: confirm they're values [0..479]
console.log(`\n=== Tail-lookup u32 distribution (save_10_fresh) ===`);
{
  const t = tails['save_10_fresh.sav'];
  const u32Freq = new Map();
  let maxV = 0;
  for (let i = 0; i + 4 <= t.length; i += 4) {
    const v = t.readUInt32LE(i);
    u32Freq.set(v, (u32Freq.get(v) || 0) + 1);
    if (v > maxV) maxV = v;
  }
  console.log(`  Total slots: ${Math.floor(t.length / 4)}`);
  console.log(`  Distinct u32 values: ${u32Freq.size}`);
  console.log(`  Max value: ${maxV}`);
  const sorted = [...u32Freq.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`  Top 15 most frequent values:`);
  for (const [v, c] of sorted.slice(0, 15)) console.log(`    ${v}  count=${c}`);
  console.log(`  Frequency histogram:`);
  const freqHist = new Map();
  for (const [v, c] of u32Freq) freqHist.set(c, (freqHist.get(c) || 0) + 1);
  for (const [c, n] of [...freqHist.entries()].sort((a,b)=>b[0]-a[0])) {
    console.log(`    values appearing ${c}× : ${n}`);
  }
}

// LAST: compare the lookup tail between save_10_fresh and save_mp_after - they should both be
// "same campaign different moments". And between save_10_fresh and ror_t1e (different campaigns?).
// If they DIFFER, the lookup encodes per-faction or per-campaign data.

console.log(`\n=== Per-pair tail byte-identity diff ===`);
const pairs = [
  ['save_10_fresh.sav', 'save_mp_before.sav'],
  ['save_10_fresh.sav', 'save_mp_after.sav'],
  ['save_mp_before.sav', 'save_mp_after.sav'],
  ['save_10_fresh.sav', 'ror_t1e.sav'],
  ['save_10_fresh.sav', 'ror_t11s.sav'],
  ['ror_t1e.sav', 'ror_t11s.sav'],
  ['ror_t1e.sav', 'athens_t21.sav'],
  ['athens_t21.sav', 'athens_t22e.sav'],
];
for (const [a, b] of pairs) {
  const ta = tails[a], tb = tails[b];
  let mm = 0;
  const n = Math.min(ta.length, tb.length);
  for (let i = 0; i < n; i++) if (ta[i] !== tb[i]) mm++;
  console.log(`  ${a.padEnd(28)} vs ${b.padEnd(28)}  mismatches=${mm}/${n}`);
}
