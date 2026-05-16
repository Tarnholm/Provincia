// dig-pfact-1.js — Session 102/A
// Enumerate every faction-record in save_1.2.sav and confirm the size delta.
// Goal: produce [index, name?, offset, length] for all records and find the
// one anomalously huge one (the player faction; ~284 KB).

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');
const SAVE = path.join(FIX, 'save_1.2.sav');

const buf = fs.readFileSync(SAVE);
console.log(`Loaded ${SAVE}: ${buf.length} bytes`);

const records = findFactionRecords(buf);
console.log(`Found ${records.length} faction records.`);

// For each record, sniff the first nearby ASCII tag (faction internal name)
function nearbyTag(buf, off) {
  // Look in [off+24, off+200] for a run of printable ASCII >= 4 chars
  const end = Math.min(buf.length, off + 256);
  let i = off + 24;
  while (i < end) {
    let j = i;
    while (j < end && buf[j] >= 0x20 && buf[j] < 0x7f) j++;
    if (j - i >= 4) {
      return buf.slice(i, j).toString('latin1');
    }
    i = j + 1;
  }
  return '';
}

const sizes = records.map(r => r.size);
sizes.sort((a, b) => a - b);
const median = sizes[Math.floor(sizes.length / 2)];
const max = sizes[sizes.length - 1];
const min = sizes[0];
console.log(`Sizes: min=${min}, median=${median}, max=${max}`);

// Show the top 5 largest and a sample of small/typical
const indexed = records.map((r, i) => ({ index: i, offset: r.offset, size: r.size, tag: nearbyTag(buf, r.offset) }));
indexed.sort((a, b) => b.size - a.size);

console.log(`\nTop 10 records by size:`);
for (const r of indexed.slice(0, 10)) {
  console.log(`  [${r.index.toString().padStart(3)}]  off=0x${r.offset.toString(16).padStart(8, '0')}  size=${r.size.toString().padStart(7)}  tag="${r.tag}"`);
}

console.log(`\nBottom 5 records by size (smallest):`);
for (const r of indexed.slice(-5)) {
  console.log(`  [${r.index.toString().padStart(3)}]  off=0x${r.offset.toString(16).padStart(8, '0')}  size=${r.size.toString().padStart(7)}  tag="${r.tag}"`);
}

// Histogram in human buckets
const hist = new Map();
for (const r of records) {
  const bucket = r.size < 10000 ? '<10k' :
                 r.size < 20000 ? '10-20k' :
                 r.size < 50000 ? '20-50k' :
                 r.size < 100000 ? '50-100k' :
                 r.size < 200000 ? '100-200k' :
                 '>200k';
  hist.set(bucket, (hist.get(bucket) || 0) + 1);
}
console.log(`\nSize buckets:`);
for (const [k, v] of hist) console.log(`  ${k}: ${v}`);

// Confirm the player record
const playerRec = indexed[0];
console.log(`\nPlayer faction record:`);
console.log(`  index = ${playerRec.index}`);
console.log(`  offset = 0x${playerRec.offset.toString(16)}`);
console.log(`  size = ${playerRec.size} bytes (${(playerRec.size / 1024).toFixed(1)} KB)`);
console.log(`  internal tag = "${playerRec.tag}"`);

// Dump full table to JSON for downstream scripts
const out = records.map((r, i) => ({
  index: i,
  offset: r.offset,
  size: r.size,
  tag: nearbyTag(buf, r.offset),
}));
fs.writeFileSync(
  path.join(__dirname, 'out-pfact-1.json'),
  JSON.stringify({ save: 'save_1.2.sav', records: out, player: playerRec }, null, 2),
);
console.log(`\nWrote out-pfact-1.json with ${out.length} records.`);
