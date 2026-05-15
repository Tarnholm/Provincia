// dig-zonea1.js — session 84 attempt 1.
// ZoneA = 0x61c47..0x846af (141,928 B). Session 54 found ~60% zeros, bimodal
// strides ~72/152, hypothesised "battle/message log slot array".
// This script:
//   1. Dump first 256 bytes and first 4 occupied "islands".
//   2. Find every non-zero island (run of >=4 nonzero bytes after a zero run).
//   3. Bucket island sizes; report top strides.
//   4. ASCII-fragment scan (>=4 printable run).
//   5. u32 scan for faction-ids (0..23) and known UUID buckets.

"use strict";
const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
const SAVES = [
  ["save_1.2", SAVE_DIR + "save_1.2.sav"],
  ["save_2.2", SAVE_DIR + "save_2.2.sav"],
  ["save_3.2", SAVE_DIR + "save_3.2.sav"],
  ["RoR_T2_Start", SAVE_DIR + "save_Autosave   Republic of Rome   Turn 2 Start.sav"],
];

const ZA_START = 0x61c47;
const ZA_END   = 0x846af;

function asciiRun(buf, p, max) {
  let out = "";
  for (let i = p; i < p + max && i < buf.length; i++) {
    const b = buf[i];
    if (b >= 0x20 && b < 0x7f) out += String.fromCharCode(b);
    else break;
  }
  return out;
}

function findIslands(buf) {
  // Walk: find runs of non-zero >=4B separated by zero gaps >=4B.
  const islands = [];
  let inIsland = false, start = -1, lastNonZero = -1, zeroRun = 0;
  for (let p = ZA_START; p < ZA_END; p++) {
    if (buf[p] !== 0) {
      if (!inIsland) { start = p; inIsland = true; }
      lastNonZero = p;
      zeroRun = 0;
    } else {
      zeroRun++;
      if (inIsland && zeroRun >= 4) {
        islands.push({ start, end: lastNonZero + 1, len: lastNonZero + 1 - start });
        inIsland = false;
      }
    }
  }
  if (inIsland) islands.push({ start, end: lastNonZero + 1, len: lastNonZero + 1 - start });
  return islands;
}

function hexdump(buf, start, n) {
  const lines = [];
  for (let row = 0; row < Math.ceil(n / 16); row++) {
    const base = start + row * 16;
    const hex = [], ascii = [];
    for (let c = 0; c < 16 && base + c < start + n; c++) {
      const b = buf[base + c];
      hex.push(b.toString(16).padStart(2, "0"));
      ascii.push(b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".");
    }
    lines.push(`  0x${base.toString(16).padStart(8,"0")}  ${hex.join(" ").padEnd(48)}  |${ascii.join("")}|`);
  }
  return lines.join("\n");
}

function asciiFragments(buf, minLen = 4) {
  const frags = [];
  let run = "";
  let runStart = -1;
  for (let p = ZA_START; p < ZA_END; p++) {
    const b = buf[p];
    if (b >= 0x20 && b < 0x7f) {
      if (run.length === 0) runStart = p;
      run += String.fromCharCode(b);
    } else {
      if (run.length >= minLen) frags.push({ off: runStart, s: run });
      run = "";
    }
  }
  if (run.length >= minLen) frags.push({ off: runStart, s: run });
  return frags;
}

function zeroFrac(buf) {
  let zeros = 0;
  for (let p = ZA_START; p < ZA_END; p++) if (buf[p] === 0) zeros++;
  return zeros / (ZA_END - ZA_START);
}

// Try taw self-pointer convention: look for u32==p hits in ZoneA.
function tawHits(buf) {
  const hits = [];
  for (let p = ZA_START; p < ZA_END - 8; p++) {
    if (buf.readUInt32LE(p) === p) hits.push(p);
  }
  return hits;
}

for (const [tag, fpath] of SAVES) {
  if (!fs.existsSync(fpath)) { console.log(`[skip ${tag}] missing: ${fpath}`); continue; }
  const buf = fs.readFileSync(fpath);
  console.log(`\n================ ${tag}  ${path.basename(fpath)}  (size=${buf.length}) ================`);
  console.log(`ZoneA = 0x${ZA_START.toString(16)}..0x${ZA_END.toString(16)} = ${ZA_END-ZA_START} B`);
  console.log(`zeroFrac = ${(zeroFrac(buf)*100).toFixed(1)}%`);

  console.log("\n--- First 128 B of zone ---");
  console.log(hexdump(buf, ZA_START, 128));

  const islands = findIslands(buf);
  console.log(`\n--- Islands (non-zero clusters >=4B, gap-sep >=4 zeros): ${islands.length} ---`);
  // Size histogram
  const sizeHist = new Map();
  for (const isl of islands) sizeHist.set(isl.len, (sizeHist.get(isl.len)||0) + 1);
  const sorted = [...sizeHist.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 15);
  console.log("Top island sizes (size -> count):");
  for (const [sz, ct] of sorted) console.log(`  ${sz} B : ${ct}`);

  // First 4 islands
  console.log("\n--- First 4 islands ---");
  for (let i = 0; i < Math.min(4, islands.length); i++) {
    const isl = islands[i];
    console.log(`\nIsland #${i}: 0x${isl.start.toString(16)}..0x${isl.end.toString(16)} len=${isl.len}`);
    console.log(hexdump(buf, isl.start, Math.min(64, isl.len)));
  }

  // Stride between consecutive island starts
  if (islands.length > 1) {
    const strides = [];
    for (let i = 1; i < islands.length; i++) strides.push(islands[i].start - islands[i-1].start);
    const strideHist = new Map();
    for (const s of strides) strideHist.set(s, (strideHist.get(s)||0) + 1);
    const ss = [...strideHist.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 10);
    console.log("\nTop island-start strides:");
    for (const [s, ct] of ss) console.log(`  ${s} B : ${ct}`);
  }

  const frags = asciiFragments(buf, 4);
  console.log(`\n--- ASCII fragments >=4 chars: ${frags.length} ---`);
  for (const f of frags.slice(0, 30)) console.log(`  0x${f.off.toString(16)}  "${f.s}"`);
  if (frags.length > 30) console.log(`  ...(${frags.length-30} more)`);

  const tw = tawHits(buf);
  console.log(`\n--- taw self-pointer hits (u32==p): ${tw.length} ---`);
  if (tw.length > 0) {
    for (const p of tw.slice(0, 10)) {
      const sz = buf.readUInt32LE(p+4);
      console.log(`  0x${p.toString(16)}  size=${sz}`);
    }
  }
}
