// dig-tail-tilegrid11.js — Decode the row-encoded tile mask format.
// Pattern observation:
//   "00 ff 00 ff 00 ff 00 e4 02 01 03 09 02 01 00 02 02 01 03 07 02 01 00 ff 00 ff 00 ff"
//
// Each "row" appears delimited by runs of (0x00, 0xff) — let me call these RUN_SEPARATORs.
// Inside a row: starts with a u16 LE that's a small value (228, 232, 234, 237 — these look
// like ROW NUMBERS), then small (col, ...) pairs.
//
// More careful look at first 256 bytes of record 1:
//   [3 separators of (00,ff)] [row 228 marker = u16 0x00e4]
//     [02 01] [03 09] [02 01] [00 02] [02 01] [03 07] [02 01]
//   [3 separators] [row 232 marker = u16 0x00e8]
//     [02 01] [03 0b] [02 02] [03 04] [04 01] [03 04] [02 01]
//   [3 separators] [row 232 marker AGAIN = u16 0x00e8]
//     ...
//
// The "rows" are repeating 232, 232, 232, 232, 234, 237, 243, 244, 244, 245... — these are
// MONOTONICALLY INCREASING after some smoothing, so they're indeed row numbers (Y).
//
// Inside each row: pairs of bytes. The pattern (col_delta, length) or (col_delta, value)
// is plausible. We see: 0x02 0x01 / 0x03 0x09 / 0x02 0x01 / 0x00 0x02 / 0x02 0x01 / 0x03 0x07 / 0x02 0x01
//   = (col2, len1), (col3, len9), (col2, len1), (col0, len2), ...
//
// Alternative: column-pair → bitmap entries.

const fs = require("fs");

const ROME10 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(ROME10);

const PAYLOAD_START = 0x1f4835f;
const PAYLOAD_END = 0x1f4a463;

// Hypothesis: Format is row-major sparse mask.
//   For each row:
//     [u16 row_index]
//     [byte stream of column entries terminated by 0x00 0xff sequence]
//   Between rows: a "0x00 0xff" pair separates the column entries from the next row's index.
//
// Test: parse the payload as alternating (row_marker_u16, col_entries_byte_stream).
// Detect "end of row" as the 0x00 0xff terminator.

function parseRowMajor(buf, start, end) {
  let p = start;
  const rows = [];
  while (p < end - 1) {
    // Skip 0x00 0xff separator bytes
    let sepCount = 0;
    while (p < end - 1 && buf[p] === 0x00 && buf[p + 1] === 0xff) {
      sepCount++;
      p += 2;
    }
    if (p >= end - 1) break;
    // Read row index as u16 LE
    if (p + 2 > end) break;
    const rowIdx = buf.readUInt16LE(p);
    p += 2;
    // Read column entries (bytes) until we hit a 0x00 0xff
    const cols = [];
    while (p < end - 1) {
      if (buf[p] === 0x00 && buf[p + 1] === 0xff) break;
      cols.push(buf[p]);
      p++;
    }
    rows.push({ rowIdx, sepBefore: sepCount, cols });
    if (rows.length > 250) break; // limit
  }
  return rows;
}

const rows = parseRowMajor(buf, PAYLOAD_START, PAYLOAD_END);
console.log(`Parsed ${rows.length} rows`);
console.log(`First 20 rows:`);
for (let i = 0; i < 20 && i < rows.length; i++) {
  const r = rows[i];
  console.log(`  rowIdx=${r.rowIdx} sepBefore=${r.sepBefore} (${r.cols.length} col bytes): ${r.cols.map(c => c.toString(16).padStart(2, "0")).join(" ")}`);
}

// Look at row indices: are they monotonic?
const rowIndices = rows.map(r => r.rowIdx);
let maxIdx = 0;
let nonMono = 0;
for (let i = 1; i < rowIndices.length; i++) {
  if (rowIndices[i] < rowIndices[i-1]) nonMono++;
  maxIdx = Math.max(maxIdx, rowIndices[i]);
}
console.log(`\nRow index range: ${rowIndices[0]}..${maxIdx}. Non-monotonic transitions: ${nonMono}`);

// Row index distribution
const indexHist = new Map();
for (const r of rows) indexHist.set(r.rowIdx, (indexHist.get(r.rowIdx) || 0) + 1);
const sortedIndices = [...indexHist.entries()].sort((a, b) => a[0] - b[0]);
console.log(`Distinct row indices: ${sortedIndices.length}`);
console.log(`First 30 row index → count: ${sortedIndices.slice(0, 30).map(([i, c]) => `${i}=${c}`).join(" ")}`);

// Try interpreting cols as pairs: (col_byte, count_byte)
console.log(`\nFirst 5 rows, interpreted as (col,len) pairs:`);
for (let i = 0; i < 5 && i < rows.length; i++) {
  const r = rows[i];
  const pairs = [];
  for (let k = 0; k < r.cols.length; k += 2) {
    pairs.push([r.cols[k], r.cols[k + 1]]);
  }
  console.log(`  row=${r.rowIdx}: ${pairs.map(([a, b]) => `(${a},${b})`).join(" ")}`);
}

// Look at all column bytes globally — what's their range?
const colByteHist = new Map();
for (const r of rows) for (const c of r.cols) colByteHist.set(c, (colByteHist.get(c) || 0) + 1);
const colSorted = [...colByteHist.entries()].sort((a, b) => b[1] - a[1]);
console.log(`\nDistinct col bytes: ${colSorted.length}, top 20: ${colSorted.slice(0, 20).map(([v, c]) => `0x${v.toString(16).padStart(2, "0")}=${c}`).join(" ")}`);

// Alternative interpretation: each pair is (column_index, value).
// In the first row: (2, 1) (3, 9) (2, 1) (0, 2) (2, 1) (3, 7) (2, 1)
// If we say (col_delta, run_length): starting col=2, run len=1; col_delta=3, run len=9;
//   col delta=2, run=1; col_delta=0, run=2; col_delta=2, run=1; col_delta=3, run=7; col_delta=2, run=1
//   Total run length: 1+9+1+2+1+7+1 = 22
// Total col span: 2+3+2+0+2+3+2 = 14
// Doesn't add up clean.
//
// Try (col_start, span): col=2 span=1 (cell 2), col=3 span=9 (cells 3..11), col=2 span=1 (cell 2?)
// Doesn't progress; col goes back.
//
// Try (count_of_skip, value_to_write): skip 2 cells, write '1'; skip 3 cells, write '9'; etc.
// Then the "values" are 1, 9, 1, 2, 1, 7, 1 — looks like values in range 1..15.
// These could be FACTION-IDs! 0..23 = major factions, 0..239 = all factions, but here we see 1..11.
//
// CONFIRMED-LIKE: each pair (skip_count, value) writes value at position cursor += skip_count.
//
// Let me test this hypothesis. For row 228 of record 1:
//   pairs: (2,1) (3,9) (2,1) (0,2) (2,1) (3,7) (2,1)
//   cursor starts at 0, write '1' at col=2, then advance 3 → col=5, write '9', advance 2 → col=7, write '1',
//   advance 0 → col=7 (overwrite?), write '2', ...
//
// Hmm... Maybe the format is different. Let me look at it as (value, count) pairs:
//   (2,1)(3,9)(2,1)(0,2)(2,1)(3,7)(2,1)
//   value=2 for 1 cell, value=3 for 9 cells, value=2 for 1 cell, value=0 for 2 cells, ...
//   This decodes a ROW WITH GAPS where the values are tile attributes.
//   Row content: [2] [3,3,3,3,3,3,3,3,3] [2] [0,0] [2] [3,3,3,3,3,3,3] [2]
//   Total: 1+9+1+2+1+7+1 = 22 cells in the row.
//   Numeric values: 0, 2, 3.
//
// Let me test this interpretation:
console.log(`\n===== Interpretation: pairs are (value, run_count) =====`);
for (let i = 0; i < 5 && i < rows.length; i++) {
  const r = rows[i];
  let cells = [];
  for (let k = 0; k < r.cols.length - 1; k += 2) {
    const value = r.cols[k];
    const count = r.cols[k + 1];
    for (let j = 0; j < count; j++) cells.push(value);
  }
  console.log(`  row=${r.rowIdx}: ${cells.length} cells: ${cells.slice(0, 60).join(",")}${cells.length > 60 ? "..." : ""}`);
}
