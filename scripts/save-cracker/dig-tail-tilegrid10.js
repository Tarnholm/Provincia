// dig-tail-tilegrid10.js — Decode payload format.
// Sample payload (record 1, first row):
//   00 ff 00 ff 00 ff 00 e4 02 01 03 09 02 01 00 02 02 01 03 07 02 01 00 ff 00 ff 00 ff
//
// Hypothesis A: this is a 2D mask encoded as runs of (value, length).
// Hypothesis B: each cell takes 2 bytes (u16), where 0xff00 = "empty / background" and
//   non-empty cells encode a small (value, ???) pair.
//
// Looking at the bytes: the pattern is "00 ff 00 ff 00 ff 00 e4 02 01 03 09 02 01 00".
// If we interpret as 1-byte units: 00 ff 00 ff 00 ff 00 e4 02 01 03 09 02 01 00 02 02 01 03 07 02 01 00 ff
// We see: 7 bytes of "00 ff 00 ff 00 ff 00", then "e4 02 01 03 09 02 01 00 02 02 01 03 07 02 01 00", then more "00 ff".
//
// "e4 02" = u16 LE = 740. That's close to 700+40 = image_height + some bound.
// "01 03 09 02 01 00 02 02 01 03 07 02 01 00" — looks like a sequence of small u8 values.
//
// Hypothesis C: RLE row-encoded — each row is:
//   [u16 count_of_zeros][u8 count_of_small_values][...small values...][u16 count_of_zeros]...
//
// Try Hypothesis C: Use the rec[7] (Eastern_City, big trailing) which is 19KB and decode.

const fs = require("fs");

const ROME10 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(ROME10);

// Take record 1 (5990 bytes, smaller, simpler) at 0x1f4834b
// Header ends at +20 (after the 5 u32s + magic). So payload starts at 0x1f4834b + 20 = 0x1f4835f.
const PAYLOAD_START = 0x1f4835f;
const PAYLOAD_END = 0x1f4a463;  // start of record 2

console.log(`Record 1 payload: 0x${PAYLOAD_START.toString(16)}..0x${PAYLOAD_END.toString(16)} = ${PAYLOAD_END - PAYLOAD_START} bytes`);

// Read first 256 bytes and dump in groups
console.log(`\nFirst 256 bytes:`);
for (let row = 0; row < 16; row++) {
  const off = PAYLOAD_START + row * 16;
  const hex = [];
  for (let j = 0; j < 16; j++) hex.push(buf[off + j].toString(16).padStart(2, "0"));
  console.log(`  +${(row * 16).toString().padStart(3, "0")}: ${hex.join(" ")}`);
}

// Now check: assume 2-byte cells (u16 LE). Where 0xff00 = "background/sea", and other
// values are non-background. Build the cell sequence and look at "transitions".
console.log(`\nU16 LE cell sequence (first 64):`);
const cells = [];
for (let p = PAYLOAD_START; p < PAYLOAD_START + 256; p += 2) {
  cells.push(buf.readUInt16LE(p));
}
console.log(cells.map(c => "0x" + c.toString(16).padStart(4, "0")).join(" "));

// Look at runs of 0xff00 (background) and how they're interspersed.
// Count run lengths of 0xff00:
const runs = [];
let curRun = 0;
let nonBgRuns = [];
let curNonBg = 0;
for (let p = PAYLOAD_START; p < PAYLOAD_END - 1; p += 2) {
  const v = buf.readUInt16LE(p);
  if (v === 0xff00) {
    if (curNonBg > 0) { nonBgRuns.push(curNonBg); curNonBg = 0; }
    curRun++;
  } else {
    if (curRun > 0) { runs.push(curRun); curRun = 0; }
    curNonBg++;
  }
}
if (curRun > 0) runs.push(curRun);
if (curNonBg > 0) nonBgRuns.push(curNonBg);
console.log(`\nBackground 0xff00 runs: ${runs.length} total, distribution:`);
const runHist = new Map();
for (const r of runs) runHist.set(r, (runHist.get(r) || 0) + 1);
const runSorted = [...runHist.entries()].sort((a, b) => b[1] - a[1]);
console.log(`  Top 15: ${runSorted.slice(0, 15).map(([r, c]) => `len${r}=${c}x`).join(" ")}`);
console.log(`  Run sum (total bg cells): ${runs.reduce((a, b) => a + b, 0)}`);

console.log(`\nNon-bg runs: ${nonBgRuns.length}, distribution:`);
const nonBgHist = new Map();
for (const r of nonBgRuns) nonBgHist.set(r, (nonBgHist.get(r) || 0) + 1);
const nonBgSorted = [...nonBgHist.entries()].sort((a, b) => b[1] - a[1]);
console.log(`  Top 15: ${nonBgSorted.slice(0, 15).map(([r, c]) => `len${r}=${c}x`).join(" ")}`);

// Now: total cells in this payload
const totalCells = (PAYLOAD_END - PAYLOAD_START) / 2;
console.log(`\nTotal cells: ${totalCells}`);
console.log(`If 1020x700 grid, sparse encoding: 714000 / ${totalCells} = ${(714000 / totalCells).toFixed(2)}x compression ratio`);

// Hypothesis: this is not a raw mask but a STRUCTURED record-of-records.
// Look for repeating 4 or 8-byte structures.
console.log(`\nFirst 32 cells decoded as u8 pairs:`);
for (let i = 0; i < 32; i++) {
  const p = PAYLOAD_START + i * 2;
  process.stdout.write(`(${buf[p].toString().padStart(3)},${buf[p+1].toString().padStart(3)})`);
}
console.log();

// Try interpretation: u16 LE where 0xff00 means a u16 background and non-0xff00 is
// (low byte = 'attr', high byte = 'count' or other)?
// In the first 32 cells we see 0x00ff, 0x00ff, 0x00ff, 0x02e4, 0x0301, 0x0209, 0x0001, ...
// "0x02e4" = 740 (interesting!) and 0x0301, 0x0209 are smaller.

// Alternative: maybe pairs of bytes encode (advance_count, value) instead of (value, count).
// Look at the start: 00 ff (advance 0xff cells then write 0? Or write value 0xff for 0 cells?)
// 00 e4 02 01 — write u16 0x00e4 (228) then write 0x01? doesn't make sense.

// Most likely interpretation: payload is a tile-mask encoded as RLE u16 pairs.
// (advance, value) or (count, value) where advance/count is u16 and value is something.
// But the cells in the dump look like:
// cells[0..6]   = ff 00 (7 of them, all background)  →  7 "empty" cells
// cells[7..10]  = e4 02, 01 03, 09 02, 01 00, 02 02, 01 03, 07 02, 01 00 — small u8 values
// cells[11+]    = back to ff 00
//
// Try interpretation: a "row record" is:
//   [u16 col_skip_count][u8 num_values_at_this_col][u8 col_skip_value_each_value]
//   ... [values follow] ...

// Let me try: each "non-bg run" is preceded by a u16 cell that encodes its starting column,
// and each non-bg value is (high_byte, low_byte) representing position in row?
// At the start: "0x00ff x7" (background), then "0x02e4" — interpret as count=740 (??),
// then 4 cells: "0x0301, 0x0209, 0x0001, 0x0202" (8 bytes).
//
// 740 is close to 1020 ÷ √2 or 700 ✕ 1.05. Hmm.
//
// Going further: rec[238] is 334KB. That's 167,000 cells. If the typical record is 6000 bytes
// (~3000 cells), and the player+rebels' record is 167K cells, that's much closer to 714,000 cells
// with ~76% RLE compression rate.

// Let me look at record 238 (largest)
console.log(`\n===== Record 238 (the BIG one — 334KB) =====`);
// Find rec[238]
const recordsBig = [];
for (let p = 0x1f00000; p < buf.length - 16; p++) {
  if (buf[p] === 0xf0 && buf[p+1] === 0x0a && buf[p+2] === 0xaf && buf[p+3] === 0xf0) {
    const a = buf.readUInt32LE(p + 4);
    const b = buf.readUInt32LE(p + 8);
    if (a === 0x3fc && b === 0x2bc) recordsBig.push(p - 8);
  }
}
const big = recordsBig[238];
console.log(`Record 238 at: 0x${big.toString(16)}, payload 0x${(big+20).toString(16)}..end`);
// Dump first 256 bytes of payload
for (let row = 0; row < 16; row++) {
  const off = big + 20 + row * 16;
  const hex = [];
  for (let j = 0; j < 16; j++) hex.push(buf[off + j].toString(16).padStart(2, "0"));
  console.log(`  +${(row * 16).toString().padStart(3, "0")}: ${hex.join(" ")}`);
}
