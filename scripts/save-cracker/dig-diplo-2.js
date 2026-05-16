// dig-diplo-2.js — session 108 step 2
//
// Each NPC faction record is ~6 KB. The first 96 bytes (after the 24-byte
// magic header) look IDENTICAL to the player's stride-2 RLE exploration zone
// opener. Hypothesis: every NPC also stores a 510×1400 RLE exploration grid
// (much smaller because most of it is unexplored = single big run). The
// remaining bytes after RLE termination (count==0 pair) should be the
// trailing settlement-list + whatever else. Find the RLE-end offset per
// NPC, then look at what comes after — that's where diplomacy must live.
//
// Validation:
//   * Every NPC's RLE block decodes to ~714,000 tiles (510×1400).
//   * The byte after the RLE has a uniform structure across NPCs.
//
// Usage: node dig-diplo-2.js
"use strict";

const fs = require("fs");
const path = require("path");
const { findFactionRecords } = require("../../src/factionRecordParser");

const SAVE = path.join(__dirname, "fixtures", "feral", "save_1.2.sav");
const buf = fs.readFileSync(SAVE);
const recs = findFactionRecords(buf);
console.log(`save_1.2.sav: ${recs.length} faction records`);

// Decode stride-2 <v, c> RLE from offset start. Return { decodedTiles, endOffset }.
function decodeRle(b, start, maxEnd) {
  let p = start;
  let tiles = 0;
  while (p + 1 < maxEnd) {
    const v = b[p];
    const c = b[p + 1];
    if (c === 0) {
      // terminator: include this pair and stop
      return { decodedTiles: tiles, endOffset: p + 2, terminatorVal: v };
    }
    tiles += c;
    p += 2;
  }
  return { decodedTiles: tiles, endOffset: p, terminatorVal: -1 };
}

const RLE_START_OFFSET = 24; // post-header, where session 103 anchored
const expectedTiles = 510 * 1400; // 714000

const npcs = recs.filter((r) => r.size > 1024 && r.size < 12000);
console.log(`\n${npcs.length} NPC records (1-12 KB)\n`);

// Decode RLE for each NPC. Collect end offsets and trailing-byte counts.
const stats = [];
for (let k = 0; k < npcs.length; k++) {
  const r = npcs[k];
  const start = r.offset + RLE_START_OFFSET;
  const maxEnd = r.offset + r.size;
  const { decodedTiles, endOffset, terminatorVal } = decodeRle(buf, start, maxEnd);
  const rleBytes = endOffset - start;
  const trailingBytes = maxEnd - endOffset;
  stats.push({ idx: k, recIdx: recs.indexOf(r), pos: r.offset, size: r.size, rleBytes, decodedTiles, terminatorVal, trailingBytes });
}

// Histogram tile counts
const tileBins = {};
for (const s of stats) {
  const k = Math.floor(s.decodedTiles / 1000) * 1000;
  tileBins[k] = (tileBins[k] || 0) + 1;
}
console.log("Decoded tile-count histogram (binned by 1000):");
Object.keys(tileBins).sort((a, b) => +a - +b).forEach((k) => {
  console.log(`  ${k}-${+k + 999}: ${tileBins[k]}`);
});

console.log(`\nExpected (510*1400 = ${expectedTiles}):`);
const hit = stats.filter((s) => Math.abs(s.decodedTiles - expectedTiles) < 100).length;
console.log(`  Within ±100 of expected: ${hit}/${stats.length}`);

// Histogram trailing-bytes
const tbBins = {};
for (const s of stats) {
  const k = Math.floor(s.trailingBytes / 100) * 100;
  tbBins[k] = (tbBins[k] || 0) + 1;
}
console.log("\nTrailing-bytes histogram (binned by 100):");
Object.keys(tbBins).sort((a, b) => +a - +b).slice(0, 20).forEach((k) => {
  console.log(`  ${k}-${+k + 99}: ${tbBins[k]}`);
});

// Show first 3 NPCs in detail
console.log("\nFirst 5 NPCs:");
for (let k = 0; k < 5; k++) {
  const s = stats[k];
  console.log(`  [${k}] pos=0x${s.pos.toString(16)} size=${s.size}  rleBytes=${s.rleBytes}  decodedTiles=${s.decodedTiles}  term=v=${s.terminatorVal}  trailing=${s.trailingBytes}`);
}

// Pick NPC[0] and dump its trailing-bytes content
const target = stats[0];
const trailStart = target.pos + RLE_START_OFFSET + target.rleBytes;
const trailEnd = target.pos + target.size;
const trailBuf = buf.slice(trailStart, trailEnd);
console.log(`\nNPC[0] trailing bytes (${trailBuf.length} B) at 0x${trailStart.toString(16)}:`);
for (let i = 0; i < Math.min(trailBuf.length, 512); i += 16) {
  let h = "  ", a = "  ";
  for (let j = 0; j < 16 && i + j < trailBuf.length; j++) {
    const b = trailBuf[i + j];
    h += b.toString(16).padStart(2, "0") + " ";
    a += (b >= 32 && b < 127 ? String.fromCharCode(b) : ".");
  }
  console.log(`  +${i.toString(16).padStart(4, "0")}: ${h}  ${a}`);
}

// Dump trailing-bytes from a DIFFERENT NPC to compare uniform structure
console.log(`\nNPC[10] trailing bytes (first 384):`);
const t10 = stats[10];
const tb10 = buf.slice(t10.pos + RLE_START_OFFSET + t10.rleBytes, t10.pos + t10.size);
for (let i = 0; i < Math.min(tb10.length, 384); i += 16) {
  let h = "  ", a = "  ";
  for (let j = 0; j < 16 && i + j < tb10.length; j++) {
    const b = tb10[i + j];
    h += b.toString(16).padStart(2, "0") + " ";
    a += (b >= 32 && b < 127 ? String.fromCharCode(b) : ".");
  }
  console.log(`  +${i.toString(16).padStart(4, "0")}: ${h}  ${a}`);
}

// Is there a regionCount pattern? Look at small u32 values near the start of trailing
console.log("\nFirst 8 u32 values of NPC trailing (decimal) — looking for region-count + ID list:");
for (let k = 0; k < 5; k++) {
  const s = stats[k];
  const off = s.pos + RLE_START_OFFSET + s.rleBytes;
  let line = `  [${k}] `;
  for (let u = 0; u < 8; u++) {
    line += buf.readUInt32LE(off + u * 4).toString().padStart(12) + " ";
  }
  console.log(line);
}
