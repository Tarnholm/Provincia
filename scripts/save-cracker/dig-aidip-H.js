// dig-aidip-H.js — Session 105/E
// MAJOR FINDING from 105/D: late-game saves' "v≥5 explosion" is dominated by
// ASCII byte values (101=e, 116=t, 84=T, etc.). This means the RLE zone
// is NOT just an exploration grid in late saves — there's ASCII string
// data embedded.
//
// Two hypotheses:
//   H1: Zone size is variable; what looked like 49,740 bytes is actually
//       (shorter grid) + (ASCII strings) + (more data). The 0xc264 end
//       offset is shared across saves only by coincidence.
//   H2: Zone is correct size but late saves use a different structure
//       (not stride-2 RLE) inside the zone.
//
// Tests:
//   1. Scan the zone for ASCII text — where in the zone do the ASCII
//      runs start? In save_10_fresh (no ASCII) vs ror_t5 (lots of ASCII)?
//   2. Look for a section delimiter that separates the RLE part from the
//      ASCII part.
//   3. Confirm: how many bytes into the zone is the FIRST embedded ASCII
//      run in each save?

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');
const ZONE_START = 0x18;
const ZONE_END   = 0x0c264;

function loadPlayer(file) {
  const buf = fs.readFileSync(path.join(FIX, file));
  const recs = findFactionRecords(buf);
  let big = recs[0]; for (const r of recs) if (r.size > big.size) big = r;
  return { buf, recs, player: big, body: buf.slice(big.offset, big.offset + big.size), file };
}

function findAsciiRuns(zone, minLen = 6) {
  // ASCII printable: 0x20..0x7e, plus 0x00 termination ok
  const runs = [];
  let start = -1;
  for (let i = 0; i < zone.length; i++) {
    const b = zone[i];
    const isPrint = b >= 0x20 && b <= 0x7e;
    if (isPrint) {
      if (start < 0) start = i;
    } else {
      if (start >= 0 && i - start >= minLen) {
        runs.push({ start, end: i, text: zone.slice(start, i).toString('ascii') });
      }
      start = -1;
    }
  }
  if (start >= 0 && zone.length - start >= minLen) {
    runs.push({ start, end: zone.length, text: zone.slice(start).toString('ascii') });
  }
  return runs;
}

// 1. First ASCII run position in zone for each save
console.log('=== First ASCII run (≥6 printable bytes) in zone offset ===');
for (const file of ['save_10_fresh.sav', 'ror_t1e.sav', 'ror_t2s.sav', 'ror_t5.sav', 'ror_t11s.sav', 'athens_t21.sav', 'athens_t22e.sav']) {
  const { body } = loadPlayer(file);
  const zone = body.slice(ZONE_START, ZONE_END);
  const runs = findAsciiRuns(zone, 6);
  if (runs.length === 0) { console.log(`  ${file}: no ASCII runs`); continue; }
  const first = runs[0];
  console.log(`  ${file}: ${runs.length} runs; first at +0x${first.start.toString(16)} "${first.text.slice(0,60)}"`);
}

// 2. Show first 10 ASCII runs from ror_t5 — what are these strings?
console.log('\n=== ror_t5: first 30 ASCII runs ===');
{
  const { body } = loadPlayer('ror_t5.sav');
  const zone = body.slice(ZONE_START, ZONE_END);
  const runs = findAsciiRuns(zone, 6);
  for (const r of runs.slice(0, 30)) {
    console.log(`  +0x${r.start.toString(16).padStart(5,'0')} len=${r.end-r.start}: "${r.text}"`);
  }
  console.log(`Total: ${runs.length} runs`);
}

// 3. Find a delimiter: scan backwards from end of zone for a structural
// marker that might separate RLE from text.
console.log('\n=== Hexdump of bytes just before first ASCII run in ror_t5 ===');
{
  const { body } = loadPlayer('ror_t5.sav');
  const zone = body.slice(ZONE_START, ZONE_END);
  const runs = findAsciiRuns(zone, 6);
  if (runs.length > 0) {
    const at = runs[0].start;
    const ctx = zone.slice(Math.max(0, at - 32), Math.min(zone.length, at + 64));
    let hex = '';
    for (let i = 0; i < ctx.length; i++) {
      hex += ctx[i].toString(16).padStart(2, '0') + ' ';
      if ((i + 1) % 16 === 0) hex += '\n';
    }
    console.log(hex);
  }
}

// 4. Differential: bytes 0..N look like RLE; bytes N..49740 might be
// something else. For ror_t11s, find the OFFSET where the byte pattern
// stops looking like RLE.
console.log('\n=== ror_t11s: byte distribution by zone position (8 bins) ===');
{
  const { body } = loadPlayer('ror_t11s.sav');
  const zone = body.slice(ZONE_START, ZONE_END);
  const BIN = 8;
  const sz = Math.floor(zone.length / BIN);
  for (let b = 0; b < BIN; b++) {
    const start = b * sz;
    const end = b === BIN - 1 ? zone.length : (b + 1) * sz;
    const hist = new Array(256).fill(0);
    for (let i = start; i < end; i++) hist[zone[i]]++;
    // Top 5 values in this bin
    const top = hist.map((c, v) => [v, c]).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topStr = top.map(([v, c]) => `${v}:${c}`).join('  ');
    // ASCII letter count (v in 0x41..0x7a)
    let asciiCnt = 0;
    for (let v = 0x41; v <= 0x7a; v++) asciiCnt += hist[v];
    console.log(`  bin ${b}: offset 0x${start.toString(16)}..0x${end.toString(16)}  asciiAlpha=${asciiCnt}  top: ${topStr}`);
  }
}

// 5. Same for save_10_fresh (which has minimal ASCII)
console.log('\n=== save_10_fresh: byte distribution by zone position (8 bins) ===');
{
  const { body } = loadPlayer('save_10_fresh.sav');
  const zone = body.slice(ZONE_START, ZONE_END);
  const BIN = 8;
  const sz = Math.floor(zone.length / BIN);
  for (let b = 0; b < BIN; b++) {
    const start = b * sz;
    const end = b === BIN - 1 ? zone.length : (b + 1) * sz;
    const hist = new Array(256).fill(0);
    for (let i = start; i < end; i++) hist[zone[i]]++;
    const top = hist.map((c, v) => [v, c]).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topStr = top.map(([v, c]) => `${v}:${c}`).join('  ');
    let asciiCnt = 0;
    for (let v = 0x41; v <= 0x7a; v++) asciiCnt += hist[v];
    console.log(`  bin ${b}: offset 0x${start.toString(16)}..0x${end.toString(16)}  asciiAlpha=${asciiCnt}  top: ${topStr}`);
  }
}

// 6. Compare zone end across saves — are they all really the same size?
console.log('\n=== Validation: are zones really fixed size? Look at +0xc264 byte for each save ===');
for (const file of ['save_10_fresh.sav', 'ror_t1e.sav', 'ror_t5.sav', 'ror_t11s.sav', 'athens_t22e.sav']) {
  const { body } = loadPlayer(file);
  const ctxAt = ZONE_END;
  const ctx = body.slice(ctxAt - 8, ctxAt + 16);
  let hex = '';
  for (const b of ctx) hex += b.toString(16).padStart(2, '0') + ' ';
  console.log(`  ${file}  [${ctxAt-8}..${ctxAt+16}): ${hex}`);
}
