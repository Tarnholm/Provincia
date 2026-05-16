// dig-pfact-5.js — Session 102/E
// Validate two findings from dig-pfact-4 across more turn samples:
//   (1) +0x000fbc f32 = treasury? Check value evolution across t1e/t2s/t5/t11s/t11e.
//   (2) +0x00c264..+0x00c298 = absolute file pointer table that shifts -10
//       when the file shrinks by 10 in the 1-tile-move pair. Decode what it
//       points to.
// Also check several other STRONG anchors:
//   (3) +0x000fb8 / +0x000fbc / +0x000fc0 cluster — look around for treasury
//   (4) +0x000040 area (likely faction id u32)
//   (5) Find Lua turn-counter "turn_number" value across all saves

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
  { label: 'save_mp_before',file: 'save_mp_before.sav' },
  { label: 'save_mp_after', file: 'save_mp_after.sav' },
];
for (const s of samples) {
  s.s = loadPlayer(s.file);
}

// ===== (1) +0x000fbc f32 evolution =====
console.log(`=== Field at +0x000fbc evolution across saves ===`);
for (const s of samples) {
  const f = s.s.body.readFloatLE(0x000fbc);
  const u = s.s.body.readUInt32LE(0x000fbc);
  console.log(`  ${s.label.padEnd(20)}  f32=${f.toFixed(4).padStart(14)}   u32=${u}`);
}

// ===== (2) Pointer table at +0x00c264 — what does 35747491 point to in save_mp_after.sav? =====
console.log(`\n=== Pointer-table at +0x00c264 (1-tile-move BEFORE & AFTER) ===`);
{
  const before = samples.find(s => s.label === 'save_mp_before').s;
  const after  = samples.find(s => s.label === 'save_mp_after').s;
  console.log(`Record offset BEFORE: 0x${before.big.offset.toString(16)} = ${before.big.offset}`);
  console.log(`Record offset AFTER : 0x${after.big.offset.toString(16)} = ${after.big.offset}`);
  // For each pointer, show what it points to in the full file
  for (let off = 0x00c264; off <= 0x00c298; off += 4) {
    const pA = before.body.readUInt32LE(off);
    const pB = after.body.readUInt32LE(off);
    const looksLikePtrA = pA > 0 && pA < before.buf.length;
    const looksLikePtrB = pB > 0 && pB < after.buf.length;
    let hexA = '', hexB = '';
    if (looksLikePtrA) hexA = before.buf.slice(pA, pA + 16).toString('hex');
    if (looksLikePtrB) hexB = after.buf.slice(pB, pB + 16).toString('hex');
    console.log(`  +0x${off.toString(16).padStart(6,'0')}  ptrA=0x${pA.toString(16)} -> ${hexA}   ptrB=0x${pB.toString(16)} -> ${hexB}`);
  }
}

// ===== (3) Trace what's at the pointer destination — check if those targets are character records or stride-9 tables =====
console.log(`\n=== Pointer destinations: dump 64 bytes context around each (BEFORE save) ===`);
{
  const before = samples.find(s => s.label === 'save_mp_before').s;
  for (let off = 0x00c264; off <= 0x00c298; off += 4) {
    const p = before.body.readUInt32LE(off);
    if (p === 0 || p >= before.buf.length) continue;
    const start = Math.max(0, p - 8);
    const end = Math.min(before.buf.length, p + 32);
    const hex = before.buf.slice(start, end).toString('hex');
    console.log(`  +0x${off.toString(16).padStart(6,'0')} -> abs=0x${p.toString(16)}:`);
    console.log(`     [${(p - start).toString().padStart(2)}] ${hex}`);
  }
}

// ===== (4) Walk the start of the record at offsets +24..+200 to find faction-id =====
console.log(`\n=== Record bytes +24..+128 in player record (look for faction id / culture) ===`);
{
  const s12 = samples.find(s => s.label === 'save_1.2').s;
  for (let off = 24; off < 128; off += 4) {
    const u = s12.body.readUInt32LE(off);
    const i = s12.body.readInt32LE(off);
    const f = s12.body.readFloatLE(off);
    console.log(`  +0x${off.toString(16).padStart(2,'0')}  u32=${u.toString().padStart(11)}  i32=${i.toString().padStart(11)}  f32=${f.toFixed(3).padStart(12)}  hex=${s12.body.slice(off, off+4).toString('hex')}`);
  }
}

// ===== (5) Look for "romans_julii" ASCII in the player record head =====
console.log(`\n=== ASCII "roman" position in player record ===`);
{
  const s12 = samples.find(s => s.label === 'save_1.2').s;
  let idx = 0;
  while ((idx = s12.body.indexOf('roman', idx)) >= 0) {
    const end = Math.min(idx + 24, s12.body.length);
    const ascii = s12.body.slice(idx, end).toString('latin1').replace(/[^\x20-\x7e]/g, '.');
    console.log(`  +0x${idx.toString(16).padStart(6,'0')}  "${ascii}"`);
    idx += 1;
    if (idx > 100000) break;
  }
}

// ===== (6) Walk all faction records and dump the same +0..+128 head — see which fields vary across factions =====
console.log(`\n=== Across-faction variation in +0..+128 (save_1.2) ===`);
{
  const s12file = loadPlayer('save_1.2.sav').buf;
  const recs = findFactionRecords(s12file);
  // For each byte position in [24..128], count distinct values
  const variability = [];
  for (let off = 0; off < 128; off++) {
    const vals = new Set();
    for (const r of recs) {
      if (r.size <= off) continue;
      vals.add(s12file[r.offset + off]);
    }
    variability.push({ off, distinct: vals.size });
  }
  // Show top ones (excluding trivial constants)
  console.log(`  Per-byte distinct value count across 238 faction records:`);
  for (let off = 0; off < 128; off++) {
    const d = variability[off].distinct;
    if (d > 1) {
      console.log(`  +0x${off.toString(16).padStart(2,'0')}  distinct=${d}`);
    }
  }
}
