// dig-head-4.js — Session 107 / 4
// Hunt for record-magic prefixes in HEAD. The session-103 RLE finding was
// `0x0a0000ef`-style; session 106 finds the pool zone starts with strLen-prefixed
// ASCII tokens. So we look for repeating short prefixes in HEAD that delimit records.
//
// Strategy:
//   (a) Look at byte-strings just BEFORE every "<u16 strLen><ASCII>" header to find common framing.
//   (b) Look at the "Settlement Lost/Gained" UTF-16 message records: scan backward from each
//       UTF-16 settlement-name to find what 4..32 byte prefix sits there.
//   (c) Look for 4-byte values that are very frequent at 4-aligned positions in the first 5800 bytes
//       of HEAD (the building-completion records). These should reveal a record header magic.

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

// ---- Settlement-class records walker. They look like:
//   <u32 ???> <u16 strLen> <ASCII bytes \0> <fields...> (variable size, ends right before next <u16 strLen>)
// Walk forward, find every <u16 strLen> ASCII pattern, classify gap between consecutive strings.

function findClassNameRecords(head, maxOffset) {
  const records = [];
  let i = 0;
  while (i + 2 < (maxOffset || head.length)) {
    const len = head.readUInt16LE(i);
    if (len >= 6 && len <= 50) {
      // Check if 'len' next bytes are printable ASCII + NUL terminator at end
      let ok = true;
      for (let k = 0; k < len - 1; k++) {
        const c = head[i + 2 + k];
        if (c < 0x20 || c >= 0x7f) { ok = false; break; }
      }
      if (ok && head[i + 2 + len - 1] === 0x00) {
        const s = head.slice(i + 2, i + 2 + len - 1).toString('ascii');
        // Only accept "settlement-class" style strings (TitleCase / underscore)
        if (s[0] >= 'A' && s[0] <= 'Z' && /^[A-Za-z_]+$/.test(s)) {
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

const HEAD = getHead('ror_t11s.sav').head;
console.log(`HEAD len ${HEAD.length} bytes`);

// First, scan the entire HEAD for class-name records (limited to first 0x6000 for speed and clarity)
const cnRecs = findClassNameRecords(HEAD, 0x6000);
console.log(`\n=== Class-name records found in HEAD[0..0x6000]: ${cnRecs.length} ===`);
for (const r of cnRecs.slice(0, 12)) {
  console.log(`  +0x${r.off.toString(16).padStart(5,'0')}  len=${r.len}  ${JSON.stringify(r.s)}`);
}
console.log('  ...');
for (const r of cnRecs.slice(-4)) {
  console.log(`  +0x${r.off.toString(16).padStart(5,'0')}  len=${r.len}  ${JSON.stringify(r.s)}`);
}

// Diff: gaps between consecutive class-name records.
console.log(`\n=== Gap distribution between consecutive class-name records ===`);
const gapHist = new Map();
const gapTrace = [];
for (let i = 1; i < cnRecs.length; i++) {
  const a = cnRecs[i - 1];
  const b = cnRecs[i];
  const aEnd = a.off + 2 + a.len; // end of (strLen + bytes) for prev
  const gap = b.off - aEnd;
  gapHist.set(gap, (gapHist.get(gap) || 0) + 1);
  gapTrace.push({ from: a.s, to: b.s, gap });
}
const sortedGaps = [...gapHist.entries()].sort((a,b)=>b[1]-a[1]);
for (const [g, c] of sortedGaps.slice(0, 15)) {
  console.log(`  gap=${g}  count=${c}`);
}

// Now examine the GAPS as bytes - look at a few specific examples
console.log(`\n=== First 3 records' full bytes (gap + next class name) ===`);
let cursor = 0;
for (let k = 0; k < 6; k++) {
  if (k >= cnRecs.length) break;
  const cn = cnRecs[k];
  const recStart = cursor;
  const recEnd = cn.off + 2 + cn.len;
  console.log(`\n  Record ${k}: ${JSON.stringify(cn.s)} at +0x${cn.off.toString(16)} (full record +0x${recStart.toString(16)}..+0x${recEnd.toString(16)}, len=${recEnd-recStart})`);
  for (let i = recStart; i < recEnd; i += 16) {
    process.stdout.write(`    +0x${i.toString(16).padStart(5,'0')}  `);
    for (let j = 0; j < 16 && i+j < recEnd; j++) process.stdout.write(HEAD[i+j].toString(16).padStart(2,'0')+' ');
    for (let j = (recEnd - i); j < 16; j++) process.stdout.write('   ');
    process.stdout.write('  ');
    for (let j = 0; j < 16 && i+j < recEnd; j++) {
      const c = HEAD[i+j];
      process.stdout.write(c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '.');
    }
    console.log();
  }
  cursor = recEnd;
}

// Now look at the "Settlement Lost/Gained" message records. Walk forward to first UTF-16 string,
// then back up.
console.log(`\n=== "Settlement Lost/Gained" message records ===`);
const msgRecs = [];
{
  // Scan for UTF-16LE "Settlement " (S=53 e=65 ...)
  const needle = Buffer.from('Settlement ', 'utf16le');
  let i = 0;
  while ((i = HEAD.indexOf(needle, i)) !== -1) {
    msgRecs.push(i);
    i++;
  }
}
console.log(`  Total "Settlement " UTF-16 strings: ${msgRecs.length}`);
// Examine the first 3 in detail:
for (let k = 0; k < 4; k++) {
  if (k >= msgRecs.length) break;
  const at = msgRecs[k];
  console.log(`\n  Settlement msg ${k}: UTF-16 "Settlement..." at +0x${at.toString(16)}`);
  const ctxStart = Math.max(0, at - 64);
  const ctxEnd = Math.min(HEAD.length, at + 32);
  for (let i = ctxStart; i < ctxEnd; i += 16) {
    process.stdout.write(`    +0x${i.toString(16).padStart(5,'0')}  `);
    for (let j = 0; j < 16 && i+j < ctxEnd; j++) process.stdout.write(HEAD[i+j].toString(16).padStart(2,'0')+' ');
    for (let j = (ctxEnd - i); j < 16; j++) process.stdout.write('   ');
    process.stdout.write('  ');
    for (let j = 0; j < 16 && i+j < ctxEnd; j++) {
      const c = HEAD[i+j];
      process.stdout.write(c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '.');
    }
    console.log();
  }
}

// Section boundaries: find big transitions in byte-distribution. Bucketed mode of bytes by 4 KB window.
console.log(`\n=== 4KB window classification of HEAD ===`);
console.log(`  Window         nz%   asciiByte%  ff-byte%  nullByte%  pred`);
for (let w = 0; w < HEAD.length; w += 4096) {
  const e = Math.min(w + 4096, HEAD.length);
  let nz=0, asc=0, ff=0, nl=0;
  for (let i = w; i < e; i++) {
    if (HEAD[i] !== 0) nz++;
    if (HEAD[i] >= 0x20 && HEAD[i] < 0x7f) asc++;
    if (HEAD[i] === 0xff) ff++;
    if (HEAD[i] === 0) nl++;
  }
  const t = e - w;
  let pred = 'mixed';
  if (asc / t > 0.4) pred = 'UTF16-text-or-ASCII';
  else if (nz / t < 0.4) pred = 'sparse-records';
  else if (ff / t > 0.05) pred = 'has-ff';
  console.log(`  +0x${w.toString(16).padStart(5,'0')}..+0x${e.toString(16).padStart(5,'0')}  ${(100*nz/t).toFixed(0).padStart(3)}%  ${(100*asc/t).toFixed(0).padStart(3)}%        ${(100*ff/t).toFixed(0).padStart(3)}%      ${(100*nl/t).toFixed(0).padStart(3)}%      ${pred}`);
}

// Final: look at the TAIL of head (last ~24 KB which should match T0's static lookup)
console.log(`\n=== Last 24 KB of HEAD (potentially the T0 static lookup table) ===`);
{
  const tail = HEAD.slice(HEAD.length - 23608); // T0 head size
  console.log(`  Tail size = ${tail.length} bytes`);
  // 4-byte stride: count zero/nonzero pattern
  let lowU16Zero = 0, lowU16NonZero = 0;
  for (let i = 0; i + 4 <= tail.length; i += 4) {
    const low = tail.readUInt16LE(i);
    if (low === 0) lowU16Zero++; else lowU16NonZero++;
  }
  console.log(`  stride-4 slots: ${Math.floor(tail.length/4)}  lowU16=0: ${lowU16Zero}  lowU16!=0: ${lowU16NonZero}`);
  // Count distinct u16 values at positions where high u16 == 0
  const u16Set = new Set();
  let maxU16 = 0;
  for (let i = 0; i + 4 <= tail.length; i += 4) {
    const v = tail.readUInt32LE(i);
    if (v < 65536) {
      u16Set.add(v);
      if (v > maxU16) maxU16 = v;
    }
  }
  console.log(`  Distinct small u32 values: ${u16Set.size}  max = ${maxU16}`);
  console.log(`  First 64 u32:`);
  for (let i = 0; i < 64; i++) {
    process.stdout.write(String(tail.readUInt32LE(i*4)).padStart(5)+' ');
    if ((i+1) % 8 === 0) console.log();
  }
}
