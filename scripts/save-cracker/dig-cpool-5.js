// dig-cpool-5.js — Session 106 / 5
// Goals:
// (1) Find WHERE within a pool record the bytes change between saves.
// (2) Determine the structure: <u16 strLen> <ASCII> <u32 count?> <stride-4 indices>
// (3) See if the u32 indices are being "consumed" (decreasing count or specific indices removed).
// (4) Try to correlate consumed names with character creation events.

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
    for (let j = 0; j < needle.length; j++) {
      if (buf[i + j] !== needle[j]) { ok = false; break; }
    }
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

// Per-save first barbarian body slice
const allBodies = {};
for (const sv of SAVES) {
  const buf = fs.readFileSync(path.join(FIX, sv));
  const recs = findFactionRecords(buf);
  const player = recs[recs.length - 1];
  const REC = player.offset;
  const firstBarbAbs = findFirstBarbarian(buf, REC, REC + player.size);
  const walkEnd = Math.min(firstBarbAbs + 500*1024, REC + player.size);
  const records = walkPoolRecords(buf, firstBarbAbs, walkEnd);
  allBodies[sv] = { REC, firstBarbAbs, records, buf };
}

// Look at the FIRST barbarian record body across saves
const refSv = SAVES[0];
const refRec = allBodies[refSv].records[0];
const refBody = allBodies[refSv].buf.slice(refRec.off + 2 + refRec.strLen, allBodies[refSv].records[1].off);
console.log(`\n=== First barbarian body byte-diff analysis ===`);
console.log(`Reference (${refSv}) body length: ${refBody.length}`);

// For each save, compute byte-positions that differ from reference
console.log('\nPer-save: count of bytes differing from save_10_fresh, by 32-byte window');
const N_WIN = Math.ceil(refBody.length / 32);
const headerRow = 'win   off'.padEnd(12) + SAVES.map(s => s.replace('.sav','').slice(0,10).padStart(11)).join('');
console.log(headerRow);

// Build per-save bodies of FIRST barbarian record
const bodies = {};
for (const sv of SAVES) {
  const recs = allBodies[sv].records;
  const r0 = recs[0], r1 = recs[1];
  bodies[sv] = allBodies[sv].buf.slice(r0.off + 2 + r0.strLen, r1.off);
}

// Print per-window diff count
const winDiffs = [];
for (let w = 0; w < N_WIN; w++) {
  const s = w * 32, e = Math.min(s + 32, refBody.length);
  const row = { win: w, off: s };
  for (const sv of SAVES) {
    let d = 0;
    for (let i = s; i < e; i++) if (bodies[sv][i] !== refBody[i]) d++;
    row[sv] = d;
  }
  winDiffs.push(row);
}

// Show only windows where ANY save differs from ref
const interesting = winDiffs.filter(w => SAVES.some(sv => w[sv] > 0));
console.log(`Interesting windows (where any save differs from ${refSv}): ${interesting.length} / ${N_WIN}`);
for (const w of interesting.slice(0, 50)) {
  console.log(`  ${String(w.win).padStart(3)}  +0x${w.off.toString(16).padStart(4,'0')}  ` + SAVES.map(s => String(w[s]).padStart(11)).join(''));
}
if (interesting.length > 50) console.log(`  ... and ${interesting.length - 50} more`);

// Now: structure analysis. Looking at first u32s of first barbarian body:
console.log('\n=== Structure of first barbarian body (first 16 u32 per save) ===');
console.log('save                              u32[0..15]');
for (const sv of SAVES) {
  const vs = [];
  for (let i = 0; i < 16; i++) vs.push(bodies[sv].readUInt32LE(i*4));
  console.log(`${sv.padEnd(35)} ${vs.join(',')}`);
}

// LAST 32 u32 of first barbarian body
console.log('\n=== LAST 32 u32 of first barbarian body ===');
for (const sv of SAVES) {
  const vs = [];
  const len = bodies[sv].length;
  const lastStart = Math.max(0, len - 32*4);
  for (let i = lastStart; i + 4 <= len; i += 4) vs.push(bodies[sv].readUInt32LE(i));
  console.log(`${sv.padEnd(35)} [${vs.length} vals]`);
  console.log(`  last 16: ${vs.slice(-16).join(',')}`);
}

// Count of nonzero u32 in barbarian body per save
console.log('\n=== Count of nonzero u32 in first barbarian body per save ===');
console.log('save                              nz     totalU32  maxVal');
for (const sv of SAVES) {
  const b = bodies[sv];
  const total = Math.floor(b.length / 4);
  let nz = 0, max = 0;
  const valFreq = new Map();
  for (let i = 0; i + 4 <= b.length; i += 4) {
    const v = b.readUInt32LE(i);
    if (v !== 0) {
      nz++;
      if (v > max) max = v;
    }
    valFreq.set(v, (valFreq.get(v) || 0) + 1);
  }
  console.log(`${sv.padEnd(35)} ${String(nz).padStart(4)}  ${String(total).padStart(8)}    ${max}`);
}

// First u16 LE of body (might be count?)
console.log('\n=== First u16 LE and u32 LE of body per save ===');
for (const sv of SAVES) {
  const b = bodies[sv];
  console.log(`${sv.padEnd(35)}  u16[0]=${b.readUInt16LE(0)}  u32[0]=${b.readUInt32LE(0)}  bytes0..15=${b.slice(0,16).toString('hex')}`);
}

// Try to interpret: pattern after the string is `2a 00 00 00 00 00 00 00`
// 2a = 42. The first u32 is 42. Then a zero u32. Then values start.
// Look at structure: <u32 count=42> <u32 zero> <count u32 indices>
// 42 indices = 168 bytes. So 168 + 8 = 176 bytes for the "active" pool.
// Then 5816 - 176 = 5640 bytes of padding/data.
// Let me see if the first 42 u32s are unique and bounded.
console.log('\n=== Sub-structure: assume <u32 count> <u32 zero?> <count u32 indices> ===');
for (const sv of SAVES.slice(0, 4)) {
  const b = bodies[sv];
  const count = b.readUInt32LE(0);
  const sep = b.readUInt32LE(4);
  if (count > 0 && count < 200) {
    const idxs = [];
    for (let i = 0; i < count; i++) idxs.push(b.readUInt32LE(8 + i*4));
    console.log(`${sv}: count=${count} sep=${sep} idxs=${idxs.join(',')}`);
    // First u32 after indices
    const next = b.readUInt32LE(8 + count*4);
    console.log(`  next u32 after count entries: ${next}`);
    // Are all idxs unique?
    const uniq = new Set(idxs).size;
    console.log(`  unique=${uniq}  max=${Math.max(...idxs)}  min=${Math.min(...idxs)}`);
  }
}

// Now: does barbarian count change across saves?
console.log('\n=== count u32[0] for FIRST barbarian record (assumed = active pool size) ===');
for (const sv of SAVES) {
  const b = bodies[sv];
  console.log(`${sv.padEnd(35)} u32[0]=${b.readUInt32LE(0)}  u32[1]=${b.readUInt32LE(1)}`);
}

// Try: scan ALL 178 records, decode first u32 as count, see if consistent
console.log('\n=== count u32[0] for ALL 178 pool records, save_10_fresh vs athens_t22e ===');
const sv1 = 'save_10_fresh.sav';
const sv2 = 'athens_t22e.sav';
const recs1 = allBodies[sv1].records, recs2 = allBodies[sv2].records;
const buf1 = allBodies[sv1].buf, buf2 = allBodies[sv2].buf;
console.log('idx  text                     T0_count  T22e_count  delta');
for (let k = 0; k < recs1.length; k++) {
  const r1 = recs1[k], r2 = recs2[k];
  if (r1.text !== r2.text) continue;
  const bodyStart1 = r1.off + 2 + r1.strLen;
  const bodyStart2 = r2.off + 2 + r2.strLen;
  const c1 = buf1.readUInt32LE(bodyStart1);
  const c2 = buf2.readUInt32LE(bodyStart2);
  if (c1 !== c2 || k < 30) {
    console.log(`${String(k).padStart(3)}  ${r1.text.padEnd(24)} ${String(c1).padStart(8)}  ${String(c2).padStart(10)}  ${c2 - c1 > 0 ? '+' : ''}${c2 - c1}`);
  }
}
