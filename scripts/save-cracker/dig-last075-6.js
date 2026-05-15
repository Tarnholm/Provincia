// dig-last075-6.js — Multi-stride record-table detector.
// Strides observed: 4, 7, 9 (and possibly 5, 6, 8). Each record has a
// non-zero prefix and a tail of zeros (or near-zeros). Use a relaxed
// trailing-zero count metric.

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

const ZONE_START = 0x14e5ac6;
const ZONE_END   = 0x20e6e8e;

// Multi-stride detector: stride S in {7, 9}. Each record has:
//   bytes 0..(S-5) = arbitrary
//   bytes (S-4)..(S-1) = mostly zero (require >= S-5 zeros)
// The MM byte (S-5) is allowed to be non-zero (per-table constant).
function detectMultiStride(rs, re) {
  if (re - rs < 100) return null;
  if (rs < ZONE_START || re > ZONE_END) return null;
  let tailFF = 0;
  for (let i = re - 1; i >= rs && i >= re - 300; i--) {
    if (buf[i] === 0xff) tailFF++; else break;
  }
  const dataEnd = re - tailFF;
  if (dataEnd - rs < 60) return null;
  let best = null;
  for (const S of [7, 9]) {
    for (let off = 0; off < S; off++) {
      let total = 0, ok = 0;
      for (let p = rs + off; p + S <= dataEnd; p += S) {
        total++;
        // Record valid if bytes (S-4)..(S-1) all zero. (i.e. last 4 bytes zero.)
        let z = 0;
        for (let k = S - 4; k < S; k++) if (buf[p + k] === 0) z++;
        if (z === 4) ok++;
      }
      if (total < 10) continue;
      const pct = ok / total;
      if (!best || pct > best.pct) best = { S, off, ok, total, pct };
    }
  }
  if (!best || best.pct < 0.85) return null;
  return best;
}

let n = 0, b = 0, byS = {};
for (const u of unknowns) {
  const d = detectMultiStride(u.start, u.end);
  if (d) { n++; b += u.bytes; byS[d.S] = (byS[d.S]||0)+1; }
}
console.log(`multi-stride detector claims ${n}/${unknowns.length} runs (${b} bytes)`);
console.log(`by stride:`, byS);

// Residual
const claimed = new Set();
for (const u of unknowns) if (detectMultiStride(u.start, u.end)) claimed.add(u.start);
const rem = unknowns.filter(u => !claimed.has(u.start)).sort((a,b)=>b.bytes-a.bytes);
console.log(`\nremaining: ${rem.length} runs, ${rem.reduce((s,u)=>s+u.bytes,0)} bytes`);

// Dump top 30 remaining.
console.log("\nTop 30 of remaining:");
for (const u of rem.slice(0, 30)) {
  const slice = buf.slice(u.start, Math.min(u.end, u.start+48));
  const hex = [...slice].map(b => b.toString(16).padStart(2, "0")).join(" ");
  const asc = [...slice].map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : ".").join("");
  console.log(`  0x${u.start.toString(16)} (${u.bytes} B)`);
  console.log(`    HEX: ${hex}`);
  console.log(`    ASC: ${asc}`);
}

// Inspect 0xf84632 (6442 B) - this looks like a settlement-detail record
// (has `default_set`, `hinterland_region`, `ef 00 00 00` near tail).
console.log("\n=== 0xf84632 deep look ===");
{
  const u = unknowns.find(x => x.start === 0xf84632);
  if (u) {
    // Has fc fc fc fc magic?
    const FC = Buffer.from([0xfc, 0xfc, 0xfc, 0xfc]);
    const fcIdx = buf.indexOf(FC, u.start);
    console.log(`fc magic at 0x${fcIdx.toString(16)} (offset within run: ${fcIdx - u.start})`);
    const def = buf.indexOf(Buffer.from("default_set"), u.start);
    const hint = buf.indexOf(Buffer.from("hinterland_region"), u.start);
    console.log(`default_set at 0x${def.toString(16)} hinterland_region at 0x${hint.toString(16)}`);
    // ef 00 00 00 in last 16 bytes
    let efIdx = -1;
    for (let p = u.end - 16; p + 4 <= u.end; p++) {
      if (buf[p]===0xef && buf[p+1]===0 && buf[p+2]===0 && buf[p+3]===0) { efIdx = p; break; }
    }
    console.log(`ef00 in last 16: 0x${efIdx.toString(16)}`);
  }
}

// Inspect 0x3bb5 (2115 B) - this is right after body root header (0x3bad+8=0x3bb5).
// Header strings extension: UTF-16 campaign names + flag table.
console.log("\n=== 0x3bb5 (2115 B) — pre-toggle_fow header strings + flag table ===");
{
  const u = unknowns.find(x => x.start === 0x3bb5);
  if (u) {
    // First section: UTF-16 strings until binary jumps in
    const head = buf.slice(u.start, u.start + 64);
    // Show first 6 4-byte words at the END of run to see context.
    const tail = buf.slice(u.end - 64, u.end);
    console.log(`tail (last 64 B): ${[...tail].map(b => b.toString(16).padStart(2,"0")).join(" ")}`);
  }
}

// Save the FINAL coverage estimate.
const claimedBytes = b;
const remainingBytes = rem.reduce((s,u)=>s+u.bytes, 0);
const TOTAL_SIZE = 34524371;
const oldUnknown = 258689;
const newUnknown = oldUnknown - claimedBytes;
console.log(`\n=== Projected coverage ===`);
console.log(`  current unknown:  ${oldUnknown} (${(oldUnknown/TOTAL_SIZE*100).toFixed(3)}%)`);
console.log(`  new unknown:      ${newUnknown} (${(newUnknown/TOTAL_SIZE*100).toFixed(3)}%)`);
console.log(`  bytes claimed by stride: ${claimedBytes}`);
