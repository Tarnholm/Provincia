// dig-stride9-internal.js — Session 99/F
// The stride9-score-table-auto detector claims 889 ranges totaling 1.7 MB
// but each range is a "catch-all" that may contain multiple logical sub-
// tables. Look inside the 10 largest ranges to find internal terminators
// and per-block size distribution.

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(SAVE);

// Re-derive the ranges by re-running the same detector logic from cover.js §16
// Conservatively look at the AI/army-trail zone [0x14e5ac6, 0x20e6e8e)
// We need to know which bitmap positions are NOT claimed by other things.
// Quick approach: scan for sequences of stride-9 records and report runs.

const ZONE_START = 0x14e5ac6;
const ZONE_END = 0x20e6e8e;
const MIN_RUN = 100;

// Run-length of consecutive valid stride-9 records starting at each byte.
// A "valid" record: 9 bytes, +5..+8 = 0, +3 low-nibble = 0, +3 <= 0x80
function isStride9Rec(p) {
  if (p + 9 > buf.length) return false;
  if (buf[p+5] !== 0 || buf[p+6] !== 0 || buf[p+7] !== 0 || buf[p+8] !== 0) return false;
  const b3 = buf[p+3];
  if ((b3 & 0x0f) !== 0) return false;
  if (b3 > 0x80) return false;
  return true;
}

// Look for chained runs starting at the same offset (any alignment).
const runs = [];
let i = ZONE_START;
while (i < ZONE_END - 9) {
  if (isStride9Rec(i)) {
    let j = i;
    let count = 0;
    while (j + 9 <= ZONE_END && isStride9Rec(j)) { count++; j += 9; }
    if (count >= 10) {
      runs.push({ start: i, end: j, count, bytes: j - i });
      i = j;
    } else {
      i++;
    }
  } else {
    i++;
  }
}

console.log(`Found ${runs.length} chained stride-9 runs (≥10 records)`);
const sorted = [...runs].sort((a, b) => b.bytes - a.bytes);
console.log('\nTop 15 by size:');
console.log('  start_hex      records  bytes      preceding-byte  following-byte  string-after?');
for (const r of sorted.slice(0, 15)) {
  const prev = buf[r.start - 1];
  const next = buf[r.end];
  // Is there a length-prefixed string immediately after?
  const len = buf.readUInt16LE(r.end);
  let strRead = '';
  if (len > 2 && len < 64 && r.end + 2 + len < ZONE_END) {
    let valid = true;
    for (let k = 0; k < len; k++) {
      const c = buf[r.end + 2 + k];
      if (!((c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a) || c === 0x5f || c === 0x20 || (c >= 0x30 && c <= 0x39))) { valid = false; break; }
    }
    if (valid) strRead = buf.slice(r.end + 2, r.end + 2 + len).toString('ascii');
  }
  console.log(`  0x${r.start.toString(16).padStart(8, '0')}  ${r.count.toString().padStart(6)}  ${r.bytes.toString().padStart(8)}   prev=0x${prev.toString(16)}      next=0x${next.toString(16)}      ${strRead ? '"' + strRead + '"' : '(no ascii)'}`);
}

// Show run-length histogram
const lengthHist = new Map();
for (const r of runs) {
  const len = r.count;
  // Bin into power-of-2 buckets
  const bucket = Math.floor(Math.log2(len));
  lengthHist.set(bucket, (lengthHist.get(bucket) || 0) + 1);
}
console.log('\nRun-length histogram (log2 buckets):');
for (const [b, c] of [...lengthHist].sort((a, b) => a[0] - b[0])) {
  console.log(`  2^${b}..2^${b+1}: ${c} runs`);
}

// Common record-count totals (sum)
const totalRecords = runs.reduce((s, r) => s + r.count, 0);
const totalBytes = runs.reduce((s, r) => s + r.bytes, 0);
console.log(`\nTotal: ${runs.length} runs, ${totalRecords} records, ${totalBytes} bytes`);
