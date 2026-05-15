// dig-last075-2.js — Session 68: validate stride-7 / stride-5 record-table
// detector. Many leftover unknowns look like dense tables of 5..9-byte records
// ending with a long `ff ff ff ff ff ff ff ff` filler. We need a detector
// that won't false-claim.

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const SAVE_PATH = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const TMP_JS  = path.join(__dirname, "_cover_emit_runtime.js");
const TMP_OUT = path.join(__dirname, "_cover_unknowns.json");

const cover = fs.readFileSync(path.join(__dirname, "cover.js"), "utf8");
const ANCHOR = "console.log(\"\\n=== Top 10 largest UNKNOWN runs ===\");";
const REPL = `require("fs").writeFileSync(${JSON.stringify(TMP_OUT)}, JSON.stringify({size, unknowns}));process.exit(0);`;
fs.writeFileSync(TMP_JS, cover.replace(ANCHOR, REPL));
execSync(`node "${TMP_JS}" "${SAVE_PATH}"`, { stdio: "pipe", maxBuffer: 256 * 1024 * 1024 });
const data = JSON.parse(fs.readFileSync(TMP_OUT, "utf8"));
fs.unlinkSync(TMP_JS);
fs.unlinkSync(TMP_OUT);

const { unknowns } = data;
const buf = fs.readFileSync(SAVE_PATH);

// Try stride 5, 6, 7, 8 across every unclaimed run and find the
// best-matching stride. Record structure hypothesis:
//   stride S: first byte non-zero, byte index 3 has low nibble 0,
//             bytes (3+1)..(S-1) mostly zero or fixed.
// Plus tail must be all 0xff for at least 16 bytes.
function bestStride(buf, rs, re) {
  let bestS = 0, bestScore = 0, bestTotal = 0, bestAlign = 0;
  for (let S = 5; S <= 9; S++) {
    for (let off = 0; off < S; off++) {
      let total = 0, ok = 0;
      for (let p = rs + off; p + S <= re; p += S) {
        total++;
        // pattern check: at least 2 of the last (S-1)/2 bytes are 0
        let zeros = 0;
        for (let k = 4; k < S; k++) if (buf[p + k] === 0) zeros++;
        const last = S - 4;
        if (zeros >= Math.max(2, last - 1)) ok++;
      }
      if (ok > bestScore) { bestScore = ok; bestS = S; bestTotal = total; bestAlign = off; }
    }
  }
  return { stride: bestS, ok: bestScore, total: bestTotal, align: bestAlign };
}

// Strict detector: must satisfy ALL of:
//   1. Length >= 100
//   2. Ends with >= 16 consecutive 0xff bytes
//   3. Best stride S in [5..9] yields >= 75% records matching the
//      "first non-zero byte + low-nibble-zero NN + trailing zero(s)" pattern
function detectStride7(rs, re) {
  if (re - rs < 100) return null;
  // Tail check.
  let tailFF = 0;
  for (let i = re - 1; i >= rs && i >= re - 200; i--) {
    if (buf[i] === 0xff) tailFF++;
    else break;
  }
  if (tailFF < 16) return null;
  // Stride.
  const dataEnd = re - tailFF;
  if (dataEnd - rs < 35) return null; // need at least 5 records
  const { stride, ok, total, align } = bestStride(buf, rs, dataEnd);
  if (total < 5) return null;
  if (ok / total < 0.75) return null;
  // Sanity: data zone byte histogram — should be mostly low-entropy.
  let zeros = 0;
  for (let i = rs; i < dataEnd; i++) if (buf[i] === 0) zeros++;
  if (zeros / (dataEnd - rs) < 0.30) return null;
  return { stride, align, records: ok, total, tailFF, dataBytes: dataEnd - rs };
}

let nClaim = 0, totBytes = 0, byStride = {};
for (const u of unknowns) {
  const d = detectStride7(u.start, u.end);
  if (d) {
    nClaim++;
    totBytes += u.bytes;
    byStride[d.stride] = (byStride[d.stride] || 0) + 1;
  }
}
console.log(`stride-tail-FF detector would claim ${nClaim} / ${unknowns.length} runs (${totBytes} bytes)`);
console.log(`by stride:`, byStride);

// What's left?
const claimed = new Set();
for (const u of unknowns) {
  if (detectStride7(u.start, u.end)) claimed.add(u.start);
}
const remaining = unknowns.filter(u => !claimed.has(u.start));
console.log(`\nremaining unknowns after stride detector: ${remaining.length} runs (${remaining.reduce((s,u)=>s+u.bytes,0)} bytes)`);

// Show top-10 remaining.
const top = remaining.sort((a,b)=>b.bytes-a.bytes).slice(0, 15);
for (const u of top) {
  const slice = buf.slice(u.start, Math.min(u.end, u.start+48));
  const hex = [...slice].map(b => b.toString(16).padStart(2, "0")).join(" ");
  const asc = [...slice].map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : ".").join("");
  console.log(`  0x${u.start.toString(16)} (${u.bytes} B) HEX: ${hex}`);
  console.log(`                          ASC: ${asc}`);
}

// Also: try a separate stride-7 detector that requires the SPECIFIC pattern
// observed in the samples: `NN MM 00 00 00 00 00` where NN's low nibble is 0
// and MM is a per-table constant.
console.log("\n=== Pure stride-7 NN-MM signature ===");
function detectStride7Strict(rs, re) {
  if (re - rs < 100) return null;
  // Find tail FF run.
  let tailFF = 0;
  for (let i = re - 1; i >= rs && i >= re - 200; i--) {
    if (buf[i] === 0xff) tailFF++;
    else break;
  }
  const dataEnd = re - tailFF;
  // Try stride 7, alignment 0..6.
  let bestOk = 0, bestTotal = 0, bestAlign = -1, bestMm = -1;
  for (let off = 0; off < 7; off++) {
    const mmCounts = new Map();
    let total = 0;
    for (let p = rs + off; p + 7 <= dataEnd; p += 7) {
      total++;
      if (buf[p+5]===0 && buf[p+6]===0 && (buf[p+3] & 0x0f) === 0 && buf[p+3] <= 0x80) {
        const mm = buf[p+4];
        mmCounts.set(mm, (mmCounts.get(mm) || 0) + 1);
      }
    }
    let topMm = 0, topMmK = -1;
    for (const [k, v] of mmCounts) if (v > topMm) { topMm = v; topMmK = k; }
    if (topMm > bestOk) { bestOk = topMm; bestTotal = total; bestAlign = off; bestMm = topMmK; }
  }
  if (bestTotal < 10) return null;
  if (bestOk / bestTotal < 0.80) return null;
  return { records: bestOk, total: bestTotal, align: bestAlign, mm: bestMm, tailFF };
}

let n7 = 0, b7 = 0;
for (const u of unknowns) {
  const d = detectStride7Strict(u.start, u.end);
  if (d) { n7++; b7 += u.bytes; }
}
console.log(`strict stride-7 detector would claim ${n7} / ${unknowns.length} runs (${b7} bytes)`);
