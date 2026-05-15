// dig-last075-5.js — Tune the stride-9 detector to catch the remaining
// ~150 runs that have NO trailing FF. Also analyze the residual.

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const SAVE_PATH = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const buf = fs.readFileSync(SAVE_PATH);
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

// Relaxed detector: no FF tail required, just stride-9 density >= 85%.
// MUST be inside the army-trail/AI-cache zone to avoid false positives.
const ZONE_START = 0x14e5ac6;
const ZONE_END   = 0x20e6e8e;

function detectStride9(rs, re) {
  if (re - rs < 100) return null;
  if (rs < ZONE_START || re > ZONE_END) return null;
  // Optionally strip trailing FF.
  let tailFF = 0;
  for (let i = re - 1; i >= rs && i >= re - 200; i--) {
    if (buf[i] === 0xff) tailFF++; else break;
  }
  const dataEnd = re - tailFF;
  if (dataEnd - rs < 60) return null;
  let bestOff = -1, bestOk = 0, bestTotal = 0;
  for (let off = 0; off < 9; off++) {
    let total = 0, ok = 0;
    for (let p = rs + off; p + 9 <= dataEnd; p += 9) {
      total++;
      // 9-byte record ends with 5 trailing zeros (bytes 4..8)
      if (buf[p+4]===0 && buf[p+5]===0 && buf[p+6]===0 && buf[p+7]===0 && buf[p+8]===0) ok++;
    }
    if (ok > bestOk) { bestOk = ok; bestTotal = total; bestOff = off; }
  }
  if (bestTotal < 8) return null;
  const pct = bestOk / bestTotal;
  if (pct < 0.85) return null;
  return { off: bestOff, ok: bestOk, total: bestTotal, pct, tailFF };
}

let n = 0, b = 0;
for (const u of unknowns) {
  if (detectStride9(u.start, u.end)) { n++; b += u.bytes; }
}
console.log(`relaxed stride-9 (no FF required, in-zone) claims ${n} / ${unknowns.length} runs (${b} bytes)`);

// Show what's NOT claimed.
const claimed = new Set();
for (const u of unknowns) if (detectStride9(u.start, u.end)) claimed.add(u.start);
const rem = unknowns.filter(u => !claimed.has(u.start)).sort((a,b)=>b.bytes-a.bytes);
console.log(`\nstill remaining: ${rem.length} runs, ${rem.reduce((s,u)=>s+u.bytes,0)} bytes`);
console.log("\nTop 20 of remaining:");
for (const u of rem.slice(0, 20)) {
  const slice = buf.slice(u.start, Math.min(u.end, u.start+48));
  const hex = [...slice].map(b => b.toString(16).padStart(2, "0")).join(" ");
  const asc = [...slice].map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : ".").join("");
  console.log(`  0x${u.start.toString(16)} (${u.bytes} B) HEX: ${hex}`);
  console.log(`                              ASC: ${asc}`);
}

// Bucket the remaining.
console.log("\n=== Remaining size buckets ===");
const buck = { lt200: 0, lt500: 0, lt1k: 0, lt3k: 0, ge3k: 0 };
const buckB = { lt200: 0, lt500: 0, lt1k: 0, lt3k: 0, ge3k: 0 };
for (const u of rem) {
  if (u.bytes < 200)      { buck.lt200++; buckB.lt200 += u.bytes; }
  else if (u.bytes < 500) { buck.lt500++; buckB.lt500 += u.bytes; }
  else if (u.bytes < 1000){ buck.lt1k++;  buckB.lt1k  += u.bytes; }
  else if (u.bytes < 3000){ buck.lt3k++;  buckB.lt3k  += u.bytes; }
  else                    { buck.ge3k++;  buckB.ge3k  += u.bytes; }
}
console.log(buck, buckB);

// Padding-sweeper test on the remaining: how many >= 95% zero or >= 95% FF?
let zd = 0, fd = 0, mixed = 0;
for (const u of rem) {
  const slice = buf.slice(u.start, u.end);
  let zeros = 0, ffs = 0;
  for (const b of slice) { if (b===0) zeros++; else if (b===0xff) ffs++; }
  if (zeros / slice.length >= 0.95) zd++;
  else if (ffs / slice.length >= 0.95) fd++;
  else mixed++;
}
console.log(`\nPadding analysis on remaining: zero-dom=${zd} ff-dom=${fd} mixed=${mixed}`);

// Verify zone constraint isn't over-claiming OUTSIDE useful regions.
// All 330+ stride-9 claims should be in army-trail zone. Confirm.
console.log("\n=== stride-9 claim zones ===");
let inZone = 0, outZone = 0;
for (const u of unknowns) {
  const d = detectStride9(u.start, u.end);
  if (d) {
    if (u.start >= ZONE_START && u.end <= ZONE_END) inZone++;
    else outZone++;
  }
}
console.log(`  in-zone: ${inZone}, out-of-zone: ${outZone}`);
