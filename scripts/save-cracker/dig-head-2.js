// dig-head-2.js — Session 107 / 2
// Dump HEAD region structure for ror_t11s.sav:
//  - ASCII strings >= 4 chars (with offset, length)
//  - UTF-16 strings >= 4 chars
//  - Runs of zeros >= 16 bytes (section boundaries)
//  - First 4 KB hex dump
// Cross-check: find character secondaryUuids in HEAD bytes.

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');
const SAVE = 'ror_t11s.sav';

function findFirstBarbarian(buf, recStart, recEnd) {
  const needle = Buffer.from([0x0a, 0x00, 0x62, 0x61, 0x72, 0x62, 0x61, 0x72, 0x69, 0x61, 0x6e, 0x00]);
  for (let i = recStart; i + needle.length < recEnd; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) if (buf[i + j] !== needle[j]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}

const buf = fs.readFileSync(path.join(FIX, SAVE));
const recs = findFactionRecords(buf);
const player = recs[recs.length - 1];
const REC = player.offset;
const firstBarb = findFirstBarbarian(buf, REC, REC + player.size);
const head = buf.slice(REC + 0xc400, firstBarb);
const HEAD_LEN = head.length;
console.log(`Save: ${SAVE}`);
console.log(`Player record: 0x${REC.toString(16)} size ${player.size}`);
console.log(`firstBarb: 0x${firstBarb.toString(16)} (rec+0x${(firstBarb-REC).toString(16)})`);
console.log(`HEAD: ${HEAD_LEN} bytes\n`);

// 1) Hex dump first 1024 bytes
console.log('=== First 1024 bytes (hex+ASCII) ===');
for (let i = 0; i < Math.min(1024, HEAD_LEN); i += 16) {
  process.stdout.write(`+0x${i.toString(16).padStart(5,'0')}  `);
  for (let j = 0; j < 16 && i+j < HEAD_LEN; j++) process.stdout.write(head[i+j].toString(16).padStart(2,'0')+' ');
  process.stdout.write('  ');
  for (let j = 0; j < 16 && i+j < HEAD_LEN; j++) {
    const c = head[i+j];
    process.stdout.write(c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '.');
  }
  console.log();
}

// 2) ASCII strings >= 4 chars
console.log('\n=== ASCII strings (len>=4) ===');
let asciiCount = 0;
{
  let i = 0;
  while (i < HEAD_LEN) {
    let j = i;
    while (j < HEAD_LEN && head[j] >= 0x20 && head[j] < 0x7f) j++;
    if (j - i >= 4) {
      const s = head.slice(i, j).toString('ascii');
      console.log(`  +0x${i.toString(16).padStart(5,'0')}  len=${(j-i).toString().padStart(3)}  ${JSON.stringify(s)}`);
      asciiCount++;
      if (asciiCount >= 100) { console.log('  ... (truncated to 100)'); break; }
    }
    i = j + 1;
  }
}

// 3) UTF-16LE strings >= 4 chars (byte length >= 8)
console.log('\n=== UTF-16LE strings (>=4 chars) ===');
let u16Count = 0;
{
  let i = 0;
  while (i < HEAD_LEN - 8) {
    if (head[i] >= 0x20 && head[i] < 0x7f && head[i+1] === 0 &&
        head[i+2] >= 0x20 && head[i+2] < 0x7f && head[i+3] === 0 &&
        head[i+4] >= 0x20 && head[i+4] < 0x7f && head[i+5] === 0 &&
        head[i+6] >= 0x20 && head[i+6] < 0x7f && head[i+7] === 0) {
      let j = i;
      let s = '';
      while (j < HEAD_LEN - 1 && head[j] >= 0x20 && head[j] < 0x7f && head[j+1] === 0) {
        s += String.fromCharCode(head[j]);
        j += 2;
      }
      if (s.length >= 4) {
        console.log(`  +0x${i.toString(16).padStart(5,'0')}  chars=${s.length}  ${JSON.stringify(s)}`);
        u16Count++;
        if (u16Count >= 50) { console.log('  ... (truncated to 50)'); break; }
        i = j;
        continue;
      }
    }
    i++;
  }
}

// 4) Runs of zeros >= 16 bytes
console.log('\n=== Zero runs (>=16 bytes) ===');
let zrCount = 0;
{
  let i = 0;
  while (i < HEAD_LEN) {
    let j = i;
    while (j < HEAD_LEN && head[j] === 0) j++;
    if (j - i >= 16) {
      console.log(`  +0x${i.toString(16).padStart(5,'0')} .. +0x${j.toString(16).padStart(5,'0')}  len=${j-i}`);
      zrCount++;
      if (zrCount >= 50) { console.log('  ... (truncated to 50)'); break; }
    }
    i = j + 1;
  }
}

// 5) Extract some known character secondaryUuids from the save and look for them in HEAD.
// Use the structural scan from characterParser ourselves so we don't need name lookups.
console.log('\n=== Character UUIDs in HEAD ===');
function findChar4_6_headers(buf) {
  // Find headers (u32 = 4 or 6 at offset -4) directly followed by uuid + xyz fields.
  const uuids = new Set();
  for (let i = 100; i + 24 < buf.length; i++) {
    const hdr = buf.readUInt32LE(i - 4);
    if (hdr !== 6 && hdr !== 4) continue;
    const u = buf.readUInt32LE(i);
    if (u === 0 || u === 0xffffffff) continue;
    const x = buf.readUInt32LE(i + 8);
    const y = buf.readUInt32LE(i + 12);
    if (x < 1 || x > 500 || y < 1 || y > 500) continue;
    const mp = buf.readFloatLE(i + 58);
    if (!isFinite(mp) || mp < 0 || mp > 1000) continue;
    uuids.add(u);
  }
  return uuids;
}
const fileWideUuids = findChar4_6_headers(buf);
console.log(`  Total fileWide char-like uuids: ${fileWideUuids.size}`);
let hitCount = 0;
const hitsArr = [];
for (let i = 0; i + 4 <= HEAD_LEN; i += 4) {
  const v = head.readUInt32LE(i);
  if (fileWideUuids.has(v)) { hitCount++; if (hitsArr.length < 30) hitsArr.push({ off: i, uuid: v }); }
}
console.log(`  HEAD u32 (4-aligned) that match a char uuid: ${hitCount}`);
for (const h of hitsArr) console.log(`    +0x${h.off.toString(16).padStart(5,'0')}  uuid=0x${h.uuid.toString(16).padStart(8,'0')}`);

// 6) Quick u32 statistics: distinct values, top 20 by frequency
console.log('\n=== u32 frequency (stride-4, top 25 distinct values) ===');
const u32Freq = new Map();
for (let i = 0; i + 4 <= HEAD_LEN; i += 4) {
  const v = head.readUInt32LE(i);
  u32Freq.set(v, (u32Freq.get(v) || 0) + 1);
}
const sorted = [...u32Freq.entries()].sort((a,b)=>b[1]-a[1]);
for (const [v, c] of sorted.slice(0, 25)) {
  console.log(`  0x${v.toString(16).padStart(8,'0')} (=${v})  count=${c}`);
}
console.log(`  distinct u32 values: ${u32Freq.size} / ${Math.floor(HEAD_LEN/4)} slots`);

// 7) Stride autocorrelation
console.log('\n=== Stride autocorrelation (head bytes) ===');
for (const stride of [2,4,6,8,12,16,20,24,32,48,64,96,128,160,192,256,512,1024]) {
  let m = 0, t = 0;
  for (let i = 0; i + stride < HEAD_LEN; i++) {
    t++;
    if (head[i] === head[i+stride]) m++;
  }
  console.log(`  stride=${stride}: match=${(100*m/t).toFixed(1)}%`);
}
