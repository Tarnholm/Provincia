// dig-cpool-8.js — Session 106 / 8
// idx=0 barbarian record body = 5816 B. The first 176 B is "<u32 count=42> <u32 0> <42 indices>".
// The post-perm region of 5640 B contains another (42, 0, 36, 9, 3, ...) — i.e. another sub-pool.
// Let's walk the whole record body as a chain of sub-pools.

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

// For a culture-record body, walk a chain of <u32 count> <u32 sep> <count u32 indices> sub-pools.
// Until we run out of room or hit invalid data.
function walkSubPools(body) {
  const sub = [];
  let i = 0;
  while (i + 8 <= body.length) {
    const count = body.readUInt32LE(i);
    const sep = body.readUInt32LE(i + 4);
    if (count > 1000 || count === 0) {
      // unlikely a real header
      break;
    }
    if (i + 8 + count * 4 > body.length) break;
    const indices = [];
    for (let j = 0; j < count; j++) indices.push(body.readUInt32LE(i + 8 + j * 4));
    // Check the perm: max should be ~count-1
    const maxIdx = Math.max(...indices);
    if (maxIdx > count + 30) break; // too out of range
    sub.push({ off: i, count, sep, indices });
    i += 8 + count * 4;
  }
  return { subPools: sub, lastOff: i };
}

const sv = SAVES[0];
const buf = fs.readFileSync(path.join(FIX, sv));
const recs = findFactionRecords(buf);
const player = recs[recs.length - 1];
const REC = player.offset;
const firstBarbAbs = findFirstBarbarian(buf, REC, REC + player.size);
const walkEnd = Math.min(firstBarbAbs + 500*1024, REC + player.size);
const records = walkPoolRecords(buf, firstBarbAbs, walkEnd);

// Look at idx=0 barbarian: walk sub-pools
console.log(`=== Walking sub-pools in idx=0 barbarian (save_10_fresh) ===`);
{
  const r = records[0];
  const r1 = records[1];
  const bs = r.off + 2 + r.strLen;
  const body = buf.slice(bs, r1.off);
  console.log(`  body length: ${body.length}`);
  const { subPools, lastOff } = walkSubPools(body);
  console.log(`  Sub-pools found: ${subPools.length}`);
  for (let i = 0; i < subPools.length; i++) {
    const sp = subPools[i];
    console.log(`    sub[${i}]: off=+${sp.off} count=${sp.count} sep=${sp.sep} max=${Math.max(...sp.indices)} indices(first10)=${sp.indices.slice(0,10).join(',')}`);
  }
  console.log(`  Walk ended at offset ${lastOff}; remaining ${body.length - lastOff} bytes`);
  // Show remaining bytes
  console.log(`  Remaining tail (first 64 bytes hex): ${body.slice(lastOff, lastOff + Math.min(64, body.length - lastOff)).toString('hex')}`);
}

// Now do the same for greek (idx=5)
console.log(`\n=== Walking sub-pools in idx=5 greek (save_10_fresh) ===`);
{
  const r = records[5];
  const r1 = records[6];
  const bs = r.off + 2 + r.strLen;
  const body = buf.slice(bs, r1.off);
  console.log(`  body length: ${body.length}`);
  const { subPools, lastOff } = walkSubPools(body);
  console.log(`  Sub-pools found: ${subPools.length}`);
  for (let i = 0; i < subPools.length; i++) {
    const sp = subPools[i];
    console.log(`    sub[${i}]: off=+${sp.off} count=${sp.count} sep=${sp.sep} max=${Math.max(...sp.indices)} indices(first10)=${sp.indices.slice(0,10).join(',')}`);
  }
  console.log(`  Walk ended at offset ${lastOff}; remaining ${body.length - lastOff} bytes`);
}

// Now do for idx=20 (the eastern record with recSize=4979, which is differnt from the standard 4958)
console.log(`\n=== Walking sub-pools in idx=20 eastern (save_10_fresh) ===`);
{
  const r = records[20];
  const r1 = records[21];
  const bs = r.off + 2 + r.strLen;
  const body = buf.slice(bs, r1.off);
  console.log(`  body length: ${body.length}`);
  const { subPools, lastOff } = walkSubPools(body);
  console.log(`  Sub-pools found: ${subPools.length}`);
  for (let i = 0; i < subPools.length; i++) {
    const sp = subPools[i];
    console.log(`    sub[${i}]: off=+${sp.off} count=${sp.count} sep=${sp.sep} max=${Math.max(...sp.indices)} indices(first10)=${sp.indices.slice(0,10).join(',')}`);
  }
  console.log(`  Walk ended at offset ${lastOff}; remaining ${body.length - lastOff} bytes`);
}

// Now do the same for idx=177 aetolian_men (size=5828, last record - same size as first barb!)
console.log(`\n=== Walking sub-pools in idx=177 aetolian_men (save_10_fresh) — last record ===`);
{
  const r = records[177];
  const r1 = null;
  const bs = r.off + 2 + r.strLen;
  const recEnd = r.off + 5828; // assumed size matching first culture record
  const body = buf.slice(bs, Math.min(recEnd, REC + player.size));
  console.log(`  body length: ${body.length}`);
  const { subPools, lastOff } = walkSubPools(body);
  console.log(`  Sub-pools found: ${subPools.length}`);
  for (let i = 0; i < subPools.length; i++) {
    const sp = subPools[i];
    console.log(`    sub[${i}]: off=+${sp.off} count=${sp.count} sep=${sp.sep} max=${Math.max(...sp.indices)} indices(first5)=${sp.indices.slice(0,5).join(',')}`);
  }
}

// Compare sub-pool counts in idx=0 barbarian across all 9 saves
console.log(`\n=== Sub-pool counts in idx=0 barbarian (T0 vs T22e) ===`);
const allRecords = {};
for (const ss of SAVES) {
  const b = fs.readFileSync(path.join(FIX, ss));
  const rcs = findFactionRecords(b);
  const pl = rcs[rcs.length - 1];
  const fb = findFirstBarbarian(b, pl.offset, pl.offset + pl.size);
  const we = Math.min(fb + 500*1024, pl.offset + pl.size);
  const rr = walkPoolRecords(b, fb, we);
  allRecords[ss] = { buf: b, records: rr };
}

console.log('save                              sub0/sub1/sub2/... counts in idx=0 barb');
for (const ss of SAVES) {
  const r = allRecords[ss].records[0];
  const r1 = allRecords[ss].records[1];
  const bs = r.off + 2 + r.strLen;
  const body = allRecords[ss].buf.slice(bs, r1.off);
  const { subPools } = walkSubPools(body);
  console.log(`  ${ss.padEnd(35)} [${subPools.length} sub-pools] counts=${subPools.map(sp => sp.count).join(',')} `);
}
