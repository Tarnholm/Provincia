// dig-cpool-7.js — Session 106 / 7
// Verify: across all 9 saves, are the COUNTS (u32[0]) identical for all 178 records?
// If yes: counts are static (preallocated capacity).
// If no: which records' counts changed (these are the actively-consumed name pools).

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

function findFirstBarbarian(buf, recStart, recEnd) {
  const needle = Buffer.from([0x0a, 0x00, 0x62, 0x61, 0x72, 0x62, 0x61, 0x72, 0x69, 0x61, 0x6e, 0x00]);
  for (let i = recStart; i + needle.length < recEnd; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) if (buf[i + j] !== needle[j]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}

function walkPoolRecords(buf, start, end) {
  const found = [];
  let i = start;
  while (i + 3 < end) {
    const strLen = buf.readUInt16LE(i);
    if (strLen < 3 || strLen > 30) { i++; continue; }
    if (i + 2 + strLen > end) break;
    let ok = true;
    let txt = '';
    for (let j = 0; j < strLen; j++) {
      const b = buf[i + 2 + j];
      if (b === 0 && j === strLen - 1) break;
      if (b < 0x20 || b >= 0x7f) { ok = false; break; }
      txt += String.fromCharCode(b);
    }
    if (!ok || !/[a-zA-Z]/.test(txt)) { i++; continue; }
    if (!/_men$|_women$|_surnames$/.test(txt) && !['barbarian','greek','eastern','egyptian','roman','carthaginian','nomad','parthian','blank'].includes(txt)) {
      i++; continue;
    }
    found.push({ off: i, strLen, text: txt });
    i += 2 + strLen;
  }
  return found;
}

const perSave = {};
for (const sv of SAVES) {
  const buf = fs.readFileSync(path.join(FIX, sv));
  const recs = findFactionRecords(buf);
  const player = recs[recs.length - 1];
  const REC = player.offset;
  const firstBarbAbs = findFirstBarbarian(buf, REC, REC + player.size);
  const walkEnd = Math.min(firstBarbAbs + 500*1024, REC + player.size);
  const records = walkPoolRecords(buf, firstBarbAbs, walkEnd);
  // For each record, read count
  const counts = records.map(r => ({ text: r.text, count: buf.readUInt32LE(r.off + 2 + r.strLen) }));
  perSave[sv] = { records, counts, buf, firstBarbAbs };
}

// Compare counts across saves per index
const ref = SAVES[0];
const N = perSave[ref].records.length;

let countMismatches = 0;
const mismatchRecords = [];
for (let k = 0; k < N; k++) {
  const refText = perSave[ref].records[k].text;
  const refCount = perSave[ref].counts[k].count;
  let mismatch = false;
  const counts = { [ref]: refCount };
  for (const sv of SAVES) {
    if (sv === ref) continue;
    if (k >= perSave[sv].records.length) { mismatch = true; counts[sv] = 'MISSING'; continue; }
    if (perSave[sv].records[k].text !== refText) { mismatch = true; counts[sv] = `TEXT_${perSave[sv].records[k].text}`; continue; }
    counts[sv] = perSave[sv].counts[k].count;
    if (perSave[sv].counts[k].count !== refCount) mismatch = true;
  }
  if (mismatch) {
    countMismatches++;
    mismatchRecords.push({ idx: k, text: refText, counts });
  }
}

console.log(`Records with count mismatch across saves: ${countMismatches} / ${N}`);
if (countMismatches > 0) {
  console.log('\nMismatched records:');
  for (const m of mismatchRecords.slice(0, 50)) {
    console.log(`  idx=${m.idx} "${m.text}"`);
    for (const sv of SAVES) console.log(`    ${sv.padEnd(35)} ${m.counts[sv]}`);
  }
}

// Now: the COUNTS are static but the BODIES differ. So the permutation INDICES are being shuffled.
// Let's see if the perm at record idx=20 (last large culture pool, which differs from save_1.2 onwards)
// has a different ordering between saves.
console.log('\n=== Pool record idx=1 (barbarian, differs between saves) perm comparison ===');
const idx = 1;
for (const sv of SAVES) {
  const r = perSave[sv].records[idx];
  const buf = perSave[sv].buf;
  const bs = r.off + 2 + r.strLen;
  const count = buf.readUInt32LE(bs);
  const perm = [];
  for (let i = 0; i < count; i++) perm.push(buf.readUInt32LE(bs + 8 + i * 4));
  const isPerm = new Set(perm).size === count && Math.max(...perm) === count - 1 && Math.min(...perm) === 0;
  console.log(`  ${sv.padEnd(35)} count=${count} isPerm=${isPerm} first10=${perm.slice(0,10).join(',')}`);
}

// Same for idx=21 (african_men, small record, no body padding)
console.log('\n=== Pool record idx=21 (african_men) perm comparison ===');
const idx2 = 21;
for (const sv of SAVES) {
  const r = perSave[sv].records[idx2];
  const buf = perSave[sv].buf;
  const bs = r.off + 2 + r.strLen;
  const count = buf.readUInt32LE(bs);
  const perm = [];
  for (let i = 0; i < count; i++) perm.push(buf.readUInt32LE(bs + 8 + i * 4));
  const isPerm = new Set(perm).size === count && Math.max(...perm) === count - 1 && Math.min(...perm) === 0;
  console.log(`  ${sv.padEnd(35)} count=${count} isPerm=${isPerm} perm=${perm.join(',')}`);
}

// Let me look at idx=0 vs idx=1 (both barbarian, both count=42).
// If both are the SAME permutation in T0, they probably both represent the same "first-barb-faction" state.
// If they differ across saves but stay identical to each other in a given save, that's interesting.
console.log('\n=== Pool record idx=0 vs idx=1 (both barbarian) perm comparison ===');
for (const sv of SAVES.slice(0, 3)) {
  const buf = perSave[sv].buf;
  const r0 = perSave[sv].records[0], r1 = perSave[sv].records[1];
  const p0 = [], p1 = [];
  const c = 42;
  for (let i = 0; i < c; i++) {
    p0.push(buf.readUInt32LE(r0.off + 2 + r0.strLen + 8 + i*4));
    p1.push(buf.readUInt32LE(r1.off + 2 + r1.strLen + 8 + i*4));
  }
  const same = p0.every((v, i) => v === p1[i]);
  console.log(`  ${sv}: idx=0 perm vs idx=1 perm: same=${same}`);
  console.log(`    idx=0 first10: ${p0.slice(0, 10).join(',')}`);
  console.log(`    idx=1 first10: ${p1.slice(0, 10).join(',')}`);
}

// Track the post-perm region: does the body region after the perm change?
// idx=0 barbarian has body size 5828 - 12 = 5816 B
// After u32 count(=42) + u32 zero + 42*4 indices = 8 + 168 = 176 B
// So 5816 - 176 = 5640 B of post-perm data
console.log('\n=== Post-perm region of FIRST barbarian (idx=0) across saves ===');
const crypto = require('crypto');
for (const sv of SAVES) {
  const buf = perSave[sv].buf;
  const r = perSave[sv].records[0];
  const r1 = perSave[sv].records[1];
  const bs = r.off + 2 + r.strLen;
  const bodyEnd = r1.off;
  const count = buf.readUInt32LE(bs);
  const postPermStart = bs + 8 + count * 4;
  const postPerm = buf.slice(postPermStart, bodyEnd);
  const h = crypto.createHash('sha1').update(postPerm).digest('hex').slice(0, 16);
  // First 32 u32 of post-perm region
  const vs = [];
  for (let i = 0; i + 4 <= Math.min(128, postPerm.length); i += 4) vs.push(postPerm.readUInt32LE(i));
  console.log(`  ${sv.padEnd(35)} hash=${h} first8u32=${vs.slice(0,8).join(',')}`);
}

// Look at structure of post-perm
console.log('\n=== Post-perm structure of idx=0 first barbarian ===');
{
  const sv = ref;
  const buf = perSave[sv].buf;
  const r = perSave[sv].records[0];
  const r1 = perSave[sv].records[1];
  const bs = r.off + 2 + r.strLen;
  const bodyEnd = r1.off;
  const count = buf.readUInt32LE(bs);
  const postPermStart = bs + 8 + count * 4;
  const postPerm = buf.slice(postPermStart, bodyEnd);
  console.log(`  postPerm length: ${postPerm.length} bytes`);
  // First 256 bytes
  console.log(`  First 32 u32:`);
  for (let i = 0; i < 32; i++) {
    const v = postPerm.readUInt32LE(i*4);
    console.log(`    +${i*4}  u32=${v}`);
  }
  console.log('\n  Looking for sub-record markers in postPerm...');
  // Look for repeated short strLen
  for (let i = 0; i < Math.min(postPerm.length - 30, 200); i++) {
    const strLen = postPerm.readUInt16LE(i);
    if (strLen >= 3 && strLen < 20 && i + 2 + strLen <= postPerm.length) {
      let ok = true;
      let txt = '';
      for (let j = 0; j < strLen; j++) {
        const b = postPerm[i + 2 + j];
        if (b < 0x20 || b >= 0x7f) { ok = false; break; }
        txt += String.fromCharCode(b);
      }
      if (ok && /^[a-z_]+$/.test(txt)) console.log(`    +${i} strLen=${strLen} "${txt}"`);
    }
  }
}

fs.writeFileSync(path.join(__dirname, 'out-cpool-7.json'), JSON.stringify({ countMismatches, mismatchRecords }, null, 2));
