// dig-pfact-2.js — Session 102/B
// Decompose the 334 KB player faction record (index 237 in save_1.2.sav).
// Produce:
//   (1) byte histogram in 4 KB windows
//   (2) "natural section break" map (runs of >32 bytes of 0x00 or 0xFF)
//   (3) ASCII strings ≥ 6 chars inside the record
//   (4) UTF-16LE strings ≥ 6 chars inside the record

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');
const SAVE = path.join(FIX, 'save_1.2.sav');
const buf = fs.readFileSync(SAVE);

const records = findFactionRecords(buf);
const player = records[records.length - 1]; // huge one
const REC_START = player.offset;
const REC_END = player.offset + player.size;
const recBuf = buf.slice(REC_START, REC_END);
console.log(`Player record: offset=0x${REC_START.toString(16)} size=${recBuf.length} (${(recBuf.length / 1024).toFixed(1)} KB)`);

// ----- (1) byte histogram in 4 KB windows -----
const WIN = 4096;
const numWin = Math.ceil(recBuf.length / WIN);
console.log(`\n=== 4 KB window byte-class breakdown ===`);
console.log(`window  rel_offset  zero%  ff%  print%  other%  topByte (count)`);
for (let w = 0; w < numWin; w++) {
  const s = w * WIN;
  const e = Math.min(s + WIN, recBuf.length);
  let zero = 0, ff = 0, print = 0;
  const cnt = new Array(256).fill(0);
  for (let i = s; i < e; i++) {
    const b = recBuf[i];
    cnt[b]++;
    if (b === 0) zero++;
    else if (b === 0xff) ff++;
    else if (b >= 0x20 && b < 0x7f) print++;
  }
  const len = e - s;
  const other = len - zero - ff - print;
  let topByte = 0;
  for (let b = 1; b < 256; b++) if (cnt[b] > cnt[topByte]) topByte = b;
  const pct = n => (100 * n / len).toFixed(1).padStart(5);
  console.log(`  ${w.toString().padStart(3)}    0x${s.toString(16).padStart(6,'0')}    ${pct(zero)}  ${pct(ff)}  ${pct(print)}  ${pct(other)}   0x${topByte.toString(16).padStart(2,'0')}(${cnt[topByte]})`);
}

// ----- (2) natural section breaks: runs of >32 zeros or >32 FFs -----
console.log(`\n=== Section breaks: runs of >32 bytes of 0x00 or 0xFF ===`);
const breaks = [];
let runStart = -1;
let runByte = -1;
for (let i = 0; i <= recBuf.length; i++) {
  const b = i < recBuf.length ? recBuf[i] : -1;
  if (b === 0 || b === 0xff) {
    if (runByte === -1) {
      runStart = i;
      runByte = b;
    } else if (b !== runByte) {
      if (i - runStart > 32) breaks.push({ start: runStart, end: i, len: i - runStart, byte: runByte });
      runStart = i;
      runByte = b;
    }
  } else {
    if (runByte !== -1 && i - runStart > 32) {
      breaks.push({ start: runStart, end: i, len: i - runStart, byte: runByte });
    }
    runStart = -1;
    runByte = -1;
  }
}
console.log(`Found ${breaks.length} runs of >32 bytes of 0x00/0xFF`);
console.log(`First 30:`);
for (const b of breaks.slice(0, 30)) {
  console.log(`  0x${b.start.toString(16).padStart(6,'0')}..0x${b.end.toString(16).padStart(6,'0')}  len=${b.len}  byte=0x${b.byte.toString(16)}`);
}
if (breaks.length > 30) {
  console.log(`  ... and ${breaks.length - 30} more`);
  console.log(`Last 5:`);
  for (const b of breaks.slice(-5)) {
    console.log(`  0x${b.start.toString(16).padStart(6,'0')}..0x${b.end.toString(16).padStart(6,'0')}  len=${b.len}  byte=0x${b.byte.toString(16)}`);
  }
}
// Big runs sorted by length
const bigRuns = breaks.slice().sort((a, b) => b.len - a.len).slice(0, 15);
console.log(`\nLargest 15 padding runs:`);
for (const b of bigRuns) {
  console.log(`  0x${b.start.toString(16).padStart(6,'0')}..0x${b.end.toString(16).padStart(6,'0')}  len=${b.len}  byte=0x${b.byte.toString(16)}`);
}

// ----- (3) ASCII strings >= 6 chars -----
console.log(`\n=== ASCII strings (≥ 6 printable chars) ===`);
const ascii = [];
{
  let s = -1;
  for (let i = 0; i <= recBuf.length; i++) {
    const b = i < recBuf.length ? recBuf[i] : -1;
    const ok = b >= 0x20 && b < 0x7f;
    if (ok) { if (s === -1) s = i; }
    else {
      if (s !== -1 && i - s >= 6) ascii.push({ off: s, len: i - s, text: recBuf.slice(s, i).toString('latin1') });
      s = -1;
    }
  }
}
console.log(`Total: ${ascii.length}`);
for (const a of ascii.slice(0, 80)) {
  console.log(`  0x${a.off.toString(16).padStart(6,'0')}  len=${a.len}  "${a.text}"`);
}
if (ascii.length > 80) console.log(`  ... and ${ascii.length - 80} more`);

// ----- (4) UTF-16LE strings >= 6 chars -----
console.log(`\n=== UTF-16LE strings (≥ 6 ASCII letters interleaved with 0x00) ===`);
const utf16 = [];
{
  let s = -1;
  for (let i = 0; i + 1 < recBuf.length; i++) {
    const lo = recBuf[i], hi = recBuf[i + 1];
    const ok = hi === 0 && lo >= 0x20 && lo < 0x7f;
    if (ok) {
      if (s === -1) s = i;
      i += 1; // we consumed 2 bytes
    } else {
      if (s !== -1) {
        const chars = (i - s) / 2;
        if (chars >= 6) {
          let txt = '';
          for (let j = s; j < i; j += 2) txt += String.fromCharCode(recBuf[j]);
          utf16.push({ off: s, chars, text: txt });
        }
      }
      s = -1;
    }
  }
}
console.log(`Total: ${utf16.length}`);
for (const u of utf16.slice(0, 50)) {
  console.log(`  0x${u.off.toString(16).padStart(6,'0')}  chars=${u.chars}  "${u.text}"`);
}
if (utf16.length > 50) console.log(`  ... and ${utf16.length - 50} more`);

// Dump section map
fs.writeFileSync(
  path.join(__dirname, 'out-pfact-2.json'),
  JSON.stringify({
    recordOffset: REC_START,
    recordSize: recBuf.length,
    paddingRuns: breaks,
    asciiStrings: ascii,
    utf16Strings: utf16,
  }, null, 2),
);
console.log(`\nWrote out-pfact-2.json.`);
