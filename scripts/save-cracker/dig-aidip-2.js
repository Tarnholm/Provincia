// dig-aidip-2.js — Session 103/B
// Session 103/A revealed: the "stride-3" claim from session 102 is WRONG.
// Stride-2 phase-divergence score = 1.19, stride-3 score = 0.066 (negligible).
// Stride-4 = 0.82. So the data is either:
//   - record-delimited (sentinels like "01 ff 01 ff 01" splitting variable
//     records), or
//   - actual stride-2/stride-even.
//
// Look at the hex dump from dig-aidip-1:
//   +0x0018  01 ff 01 ff 01 8f 00 07 01 cf 00 84 02 03 04 01
//   +0x0028  03 09 04 02 03 06 01 ff 01 ff 01 8e 00 05 01 01 ...
//
// The pattern `01 ff 01 ff 01 NN ...` clearly DELIMITS records. NN appears
// to be a record length or first payload byte. Let's:
//
//  (1) Find every occurrence of `01 ff 01 ff 01` and report inter-record
//      sizes. How many records? Are sizes uniform or variable?
//  (2) For each record, dump the first 16 bytes. Look for a common header
//      pattern.
//  (3) Compare record count across multiple saves — should be 238 or 239
//      if it's per-faction.

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');

function loadPlayer(file) {
  const buf = fs.readFileSync(path.join(FIX, file));
  const recs = findFactionRecords(buf);
  let big = recs[0]; for (const r of recs) if (r.size > big.size) big = r;
  return { buf, recs, player: big, body: buf.slice(big.offset, big.offset + big.size), file };
}

const ZONE_START = 0x18;
const ZONE_END   = 0x0c264;

// Look for delimiter `01 ff 01 ff 01` (5 bytes)
const DELIM = Buffer.from([0x01, 0xff, 0x01, 0xff, 0x01]);

function findDelims(body) {
  const positions = [];
  let p = ZONE_START;
  while (p < ZONE_END) {
    const i = body.indexOf(DELIM, p);
    if (i < 0 || i >= ZONE_END) break;
    positions.push(i);
    p = i + 1;
  }
  return positions;
}

function analyze(file) {
  const { body } = loadPlayer(file);
  const positions = findDelims(body);
  console.log(`\n=== ${file} ===`);
  console.log(`Delimiter '01 ff 01 ff 01' occurrences in zone: ${positions.length}`);
  if (positions.length === 0) return;
  // distance between consecutive delimiters
  const sizes = [];
  for (let i = 1; i < positions.length; i++) sizes.push(positions[i] - positions[i-1]);
  sizes.push(ZONE_END - positions[positions.length - 1]);
  const sum = sizes.reduce((a,b)=>a+b, 0);
  console.log(`Avg record size: ${(sum/sizes.length).toFixed(1)} B  min=${Math.min(...sizes)} max=${Math.max(...sizes)}`);
  // size histogram
  const sizeHist = new Map();
  for (const s of sizes) sizeHist.set(s, (sizeHist.get(s) || 0) + 1);
  const topSizes = [...sizeHist.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 10);
  console.log(`Top sizes: ${topSizes.map(([s,c])=>`${s}B×${c}`).join(', ')}`);
  console.log(`First 5 records:`);
  for (let k = 0; k < Math.min(5, positions.length); k++) {
    const s = positions[k];
    const e = k + 1 < positions.length ? positions[k+1] : ZONE_END;
    const len = e - s;
    const hex = body.slice(s, Math.min(s+32, e)).toString('hex').match(/../g).join(' ');
    console.log(`  rec[${k}] rel=+0x${s.toString(16)} len=${len}  ${hex}${len > 32 ? '...' : ''}`);
  }
  return positions;
}

const saves = [
  'save_10_fresh.sav',
  'save_1.2.sav',
  'ror_t1e.sav',
  'ror_t2s.sav',
  'ror_t5.sav',
  'ror_t11e.sav',
  'ror_t11s.sav',
  'athens_t21.sav',
  'athens_t22e.sav',
];

for (const s of saves) analyze(s);

// ===== Try a different delimiter hypothesis =====
// Maybe the delimiter is actually `01 ff` (2 bytes) — `01 ff 01 ff 01 ...`
// could be either a 5-byte delim or 2 successive 2-byte "01 ff" delims.
console.log(`\n\n=== Alternative delimiter '01 ff' (2 bytes) in save_1.2 ===`);
{
  const { body } = loadPlayer('save_1.2.sav');
  const DEL2 = Buffer.from([0x01, 0xff]);
  const positions = [];
  let p = ZONE_START;
  while (p < ZONE_END) {
    const i = body.indexOf(DEL2, p);
    if (i < 0 || i >= ZONE_END) break;
    positions.push(i);
    p = i + 1;
  }
  console.log(`Count of '01 ff' pairs: ${positions.length}`);
  // gaps
  const gaps = [];
  for (let i = 1; i < positions.length; i++) gaps.push(positions[i] - positions[i-1]);
  const gapHist = new Map();
  for (const g of gaps) gapHist.set(g, (gapHist.get(g) || 0) + 1);
  const top = [...gapHist.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 15);
  console.log(`Top gap sizes (delim-to-delim spacing): ${top.map(([g,c])=>`${g}B×${c}`).join(', ')}`);
}

// ===== Inspect first 1024 bytes broken at delim '01 ff 01 ff 01' =====
console.log(`\n=== save_1.2 zone first 1024 bytes, segmented at '01 ff 01 ff 01' ===`);
{
  const { body } = loadPlayer('save_1.2.sav');
  const positions = findDelims(body).filter(p => p < ZONE_START + 1024);
  for (let k = 0; k < positions.length; k++) {
    const s = positions[k];
    const e = k + 1 < positions.length ? positions[k+1] : Math.min(ZONE_START + 1024, ZONE_END);
    const len = e - s;
    const slice = body.slice(s, e);
    const hex = slice.toString('hex').match(/../g).join(' ');
    console.log(`  rec[${k}] rel=+0x${s.toString(16)} len=${len}  ${hex}`);
  }
}
