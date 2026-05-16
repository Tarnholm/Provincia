// dig-cpool-1.js — Session 106
// Decompose the 261 KB sparse "character/name pool" zone inside the player faction record.
// Per session 102, the zone spans +0x0c400..+0x04d000 of the player record.
//
// Outputs:
//   (1) Byte histogram per 4 KB window (zero%, ff%, print%, other%)
//   (2) ASCII strings >= 4 chars
//   (3) UTF-16LE strings >= 4 chars
//   (4) Natural section breaks: runs of >=32 bytes of 0x00
//   (5) Per-save tile-island map: contiguous non-zero islands separated by >=32 zeros
//   (6) Top recurring 4/8-byte words (stride autocorrelation hint)

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');
const SAVE = path.join(FIX, 'save_1.2.sav');
const buf = fs.readFileSync(SAVE);

const records = findFactionRecords(buf);
const player = records[records.length - 1];
const REC_START = player.offset;
const REC_END = REC_START + player.size;
console.log(`Player record: abs offset=0x${REC_START.toString(16)} size=${player.size} (${(player.size / 1024).toFixed(1)} KB)`);

// Zone bounds (relative to record start)
const ZONE_REL_START = 0x0c400;
const ZONE_REL_END = 0x4d000;
const zone = buf.slice(REC_START + ZONE_REL_START, REC_START + ZONE_REL_END);
console.log(`Zone: rel +0x${ZONE_REL_START.toString(16)}..+0x${ZONE_REL_END.toString(16)} size=${zone.length} (${(zone.length/1024).toFixed(1)} KB)`);
console.log(`Zone: abs 0x${(REC_START + ZONE_REL_START).toString(16)}..0x${(REC_START + ZONE_REL_END).toString(16)}`);

// (1) Byte histogram per 4 KB window
console.log(`\n=== 4 KB window byte-class breakdown ===`);
console.log(`win  rel(zone)  rel(record)   zero%   ff%  print%  other%  top1  top2`);
const WIN = 4096;
const numWin = Math.ceil(zone.length / WIN);
const wins = [];
for (let w = 0; w < numWin; w++) {
  const s = w * WIN, e = Math.min(s + WIN, zone.length);
  let zero = 0, ff = 0, print = 0;
  const cnt = new Array(256).fill(0);
  for (let i = s; i < e; i++) {
    const b = zone[i];
    cnt[b]++;
    if (b === 0) zero++;
    else if (b === 0xff) ff++;
    else if (b >= 0x20 && b < 0x7f) print++;
  }
  const len = e - s, other = len - zero - ff - print;
  let top1 = 0; for (let b = 1; b < 256; b++) if (cnt[b] > cnt[top1]) top1 = b;
  let top2 = 0; for (let b = 0; b < 256; b++) if (b !== top1 && cnt[b] > cnt[top2]) top2 = b;
  const pct = n => (100*n/len).toFixed(1).padStart(5);
  const relRecord = ZONE_REL_START + s;
  wins.push({ w, zoneOff: s, recordOff: relRecord, zero, ff, print, other, top1: cnt[top1], top1B: top1, top2: cnt[top2], top2B: top2, len });
  console.log(`${String(w).padStart(3)}  0x${s.toString(16).padStart(5,'0')}     0x${relRecord.toString(16).padStart(6,'0')}    ${pct(zero)} ${pct(ff)}  ${pct(print)}  ${pct(other)}  0x${top1.toString(16).padStart(2,'0')}(${cnt[top1]})  0x${top2.toString(16).padStart(2,'0')}(${cnt[top2]})`);
}

// (2) ASCII strings >= 4 chars
console.log(`\n=== ASCII strings (>= 4 printable chars) — first 200 ===`);
const ascii = [];
{
  let s = -1;
  for (let i = 0; i <= zone.length; i++) {
    const b = i < zone.length ? zone[i] : -1;
    const ok = b >= 0x20 && b < 0x7f;
    if (ok) { if (s === -1) s = i; }
    else {
      if (s !== -1 && i - s >= 4) {
        ascii.push({ off: s, recOff: ZONE_REL_START + s, len: i - s, text: zone.slice(s, i).toString('latin1') });
      }
      s = -1;
    }
  }
}
console.log(`Total ASCII strings >=4: ${ascii.length}`);
for (const a of ascii.slice(0, 200)) {
  console.log(`  zone+0x${a.off.toString(16).padStart(5,'0')}  rec+0x${a.recOff.toString(16).padStart(6,'0')}  len=${a.len}  "${a.text}"`);
}
if (ascii.length > 200) console.log(`  ... and ${ascii.length - 200} more (saving full list to JSON)`);

// (3) UTF-16LE strings >= 4 chars
console.log(`\n=== UTF-16LE strings (>= 4 chars) — first 100 ===`);
const utf16 = [];
{
  let s = -1;
  for (let i = 0; i + 1 < zone.length; ) {
    const lo = zone[i], hi = zone[i + 1];
    const ok = hi === 0 && lo >= 0x20 && lo < 0x7f;
    if (ok) {
      if (s === -1) s = i;
      i += 2;
    } else {
      if (s !== -1) {
        const chars = (i - s) / 2;
        if (chars >= 4) {
          let txt = '';
          for (let j = s; j < i; j += 2) txt += String.fromCharCode(zone[j]);
          utf16.push({ off: s, recOff: ZONE_REL_START + s, chars, text: txt });
        }
        s = -1;
      }
      i += 1;
    }
  }
}
console.log(`Total UTF-16 strings >=4: ${utf16.length}`);
for (const u of utf16.slice(0, 100)) {
  console.log(`  zone+0x${u.off.toString(16).padStart(5,'0')}  rec+0x${u.recOff.toString(16).padStart(6,'0')}  chars=${u.chars}  "${u.text}"`);
}
if (utf16.length > 100) console.log(`  ... and ${utf16.length - 100} more`);

// (4) Natural section breaks: runs of >=32 zero bytes
console.log(`\n=== Non-zero islands (runs separated by >=32 zero bytes) ===`);
const islands = [];
{
  let inIsland = false, islandStart = 0, zeroRun = 0;
  for (let i = 0; i < zone.length; i++) {
    const b = zone[i];
    if (b === 0) {
      zeroRun++;
      if (inIsland && zeroRun >= 32) {
        islands.push({ start: islandStart, end: i - zeroRun + 1, len: i - zeroRun + 1 - islandStart });
        inIsland = false;
      }
    } else {
      if (!inIsland) {
        islandStart = i;
        inIsland = true;
      }
      zeroRun = 0;
    }
  }
  if (inIsland) {
    islands.push({ start: islandStart, end: zone.length, len: zone.length - islandStart });
  }
}
console.log(`Total non-zero islands (zero-run threshold >=32): ${islands.length}`);
// Show distribution
const lenBuckets = {};
for (const isl of islands) {
  const bucket = isl.len < 16 ? '<16' : isl.len < 64 ? '16-63' : isl.len < 256 ? '64-255' : isl.len < 1024 ? '256-1023' : isl.len < 4096 ? '1k-4k' : '>=4k';
  lenBuckets[bucket] = (lenBuckets[bucket] || 0) + 1;
}
console.log(`Length distribution:`, lenBuckets);
// Show top 30 largest
const biggestIslands = islands.slice().sort((a, b) => b.len - a.len).slice(0, 30);
console.log(`\nTop 30 largest non-zero islands (by byte length):`);
for (const isl of biggestIslands) {
  const recOff = ZONE_REL_START + isl.start;
  // Sample first 24 bytes
  const sample = zone.slice(isl.start, Math.min(isl.start + 24, isl.end)).toString('hex');
  // ASCII content?
  let asciiInThis = ascii.filter(a => a.off >= isl.start && a.off < isl.end);
  const asciiSample = asciiInThis.slice(0, 3).map(a => `"${a.text}"`).join(', ');
  console.log(`  zone+0x${isl.start.toString(16).padStart(5,'0')}..+0x${isl.end.toString(16).padStart(5,'0')}  rec+0x${recOff.toString(16).padStart(6,'0')}  len=${isl.len}  hex24=${sample}${asciiSample ? '  ['+asciiSample+']' : ''}`);
}

// First 30 islands in order
console.log(`\nFirst 30 islands (in file order):`);
for (const isl of islands.slice(0, 30)) {
  const recOff = ZONE_REL_START + isl.start;
  const sample = zone.slice(isl.start, Math.min(isl.start + 16, isl.end)).toString('hex');
  console.log(`  zone+0x${isl.start.toString(16).padStart(5,'0')}  rec+0x${recOff.toString(16).padStart(6,'0')}  len=${isl.len}  hex16=${sample}`);
}

// (5) Stride / autocorrelation on a sample window
console.log(`\n=== Stride autocorrelation (a sample window) ===`);
// Pick the densest 4KB window
const densestWin = wins.slice().sort((a, b) => (b.len - b.zero) - (a.len - a.zero))[0];
console.log(`Densest 4KB window: zone+0x${densestWin.zoneOff.toString(16)} (zeros=${densestWin.zero}/${densestWin.len})`);
const sample = zone.slice(densestWin.zoneOff, densestWin.zoneOff + densestWin.len);
console.log(`Autocorrelation peaks (stride: match-rate against shifted self, normalized) [top 20 strides 1..64]:`);
const acScores = [];
for (let stride = 1; stride <= 64; stride++) {
  let matches = 0;
  const limit = sample.length - stride;
  for (let i = 0; i < limit; i++) {
    if (sample[i] === sample[i + stride]) matches++;
  }
  acScores.push({ stride, rate: matches / limit });
}
acScores.sort((a, b) => b.rate - a.rate);
for (const s of acScores.slice(0, 20)) {
  console.log(`  stride=${s.stride.toString().padStart(2)}  rate=${s.rate.toFixed(4)}`);
}

// (6) Top recurring 8-byte words across the zone
console.log(`\n=== Top recurring 8-byte words (excluding all-zero) ===`);
const wordCount = new Map();
for (let i = 0; i + 8 <= zone.length; i++) {
  const w = zone.slice(i, i + 8).toString('hex');
  if (w === '0000000000000000') continue;
  wordCount.set(w, (wordCount.get(w) || 0) + 1);
}
const topWords = [...wordCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
for (const [w, c] of topWords) {
  console.log(`  ${w}  ×${c}`);
}

// Write JSON for cross-script consumption
const outFile = path.join(__dirname, 'out-cpool-1.json');
fs.writeFileSync(outFile, JSON.stringify({
  save: 'save_1.2.sav',
  recordOffset: REC_START,
  recordSize: player.size,
  zoneRelStart: ZONE_REL_START,
  zoneRelEnd: ZONE_REL_END,
  zoneSize: zone.length,
  windows: wins,
  ascii,
  utf16,
  islands,
  topWords,
}, null, 2));
console.log(`\nWrote ${outFile}`);
