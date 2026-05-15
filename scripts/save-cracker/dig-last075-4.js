// dig-last075-4.js — Confirm stride-8 hypothesis and build a detector.

"use strict";

const fs = require("fs");
const path = require("path");

const SAVE_PATH = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const buf = fs.readFileSync(SAVE_PATH);

// Test stride 4, 5, 6, 7, 8 on each target.
const targets = [
  [0x15166cb, 0x15166cb + 1903],
  [0x1516f52, 0x1516f52 + 1903],
  [0x15144b7, 0x15144b7 + 1901],
  [0x1eddd7e, 0x1eddd7e + 1870],
  [0x1f16629, 0x1f16629 + 1897],
  [0x15128ff, 0x15128ff + 1494],
];

for (const [rs, re] of targets) {
  console.log(`\n=== 0x${rs.toString(16)} (${re-rs} B) ===`);
  // Find tail FF.
  let tailFF = 0;
  for (let i = re - 1; i >= rs && i >= re - 200; i--) {
    if (buf[i] === 0xff) tailFF++; else break;
  }
  const dataEnd = re - tailFF;
  console.log(`  tailFF=${tailFF} dataEnd=0x${dataEnd.toString(16)} dataLen=${dataEnd - rs}`);
  // Try strides 4..9 with trailing-zero count metric.
  for (let S = 4; S <= 9; S++) {
    let bestOff = -1, bestOk = 0;
    for (let off = 0; off < S; off++) {
      let total = 0, ok = 0;
      for (let p = rs + off; p + S <= dataEnd; p += S) {
        total++;
        // Count trailing zeros: bytes [3..S-1].
        let trailingZ = 0;
        for (let k = S - 1; k >= 3; k--) {
          if (buf[p + k] === 0) trailingZ++;
          else break;
        }
        if (trailingZ >= S - 4) ok++;
      }
      if (ok > bestOk) { bestOk = ok; bestOff = off; }
    }
    const total = Math.floor((dataEnd - rs) / S);
    console.log(`  S=${S} bestOff=${bestOff} ok=${bestOk}/${total} = ${(bestOk/total*100).toFixed(1)}%`);
  }
}

// New detector: stride-8 with low-byte-counter pattern.
// Observation: bytes at position 0 of each record cycle through low values
// (0..7), high bits are likely a type-nibble. The pattern is:
//   `NN AA BB CC 00 00 00 00`  (8 bytes; CC has low nibble = 0)
// But the trailing-zero count is the real signal.
function detectStrideN(rs, re) {
  if (re - rs < 100) return null;
  let tailFF = 0;
  for (let i = re - 1; i >= rs && i >= re - 200; i--) {
    if (buf[i] === 0xff) tailFF++; else break;
  }
  if (tailFF < 16) return null;
  const dataEnd = re - tailFF;
  if (dataEnd - rs < 50) return null;
  let best = null;
  for (let S = 5; S <= 12; S++) {
    for (let off = 0; off < S; off++) {
      let total = 0, ok = 0;
      for (let p = rs + off; p + S <= dataEnd; p += S) {
        total++;
        // require at least (S-4) trailing zeros from byte S-1 backwards
        let z = 0;
        for (let k = S - 1; k >= 3; k--) {
          if (buf[p + k] === 0) z++; else break;
        }
        if (z >= S - 4) ok++;
      }
      if (total < 10) continue;
      const pct = ok / total;
      if (!best || pct > best.pct) best = { S, off, ok, total, pct };
    }
  }
  if (!best || best.pct < 0.85) return null;
  return best;
}

// Run on ALL unknowns (need to fetch them).
const { execSync } = require("child_process");
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
let claim = 0, bytes = 0, byS = {};
for (const u of unknowns) {
  const d = detectStrideN(u.start, u.end);
  if (d) { claim++; bytes += u.bytes; byS[d.S] = (byS[d.S] || 0) + 1; }
}
console.log(`\nstride-N detector: ${claim} / ${unknowns.length} runs (${bytes} bytes)`);
console.log(`by stride:`, byS);

// Sample 5 "would claim" from each stride to verify.
const samples = {};
for (const u of unknowns) {
  const d = detectStrideN(u.start, u.end);
  if (d) {
    samples[d.S] = samples[d.S] || [];
    if (samples[d.S].length < 3) samples[d.S].push({ u, d });
  }
}
for (const S in samples) {
  console.log(`\n=== Stride ${S} samples ===`);
  for (const { u, d } of samples[S]) {
    const head = buf.slice(u.start, u.start + 32);
    console.log(`  0x${u.start.toString(16)} (${u.bytes} B) off=${d.off} pct=${(d.pct*100).toFixed(1)}%`);
    console.log(`    HEAD: ${[...head].map(b => b.toString(16).padStart(2,"0")).join(" ")}`);
  }
}

// Save the remaining unknowns after this detector.
const claimed = new Set();
for (const u of unknowns) if (detectStrideN(u.start, u.end)) claimed.add(u.start);
const remaining = unknowns.filter(u => !claimed.has(u.start));
console.log(`\nremaining: ${remaining.length} runs (${remaining.reduce((s,u)=>s+u.bytes,0)} bytes)`);
const top = remaining.sort((a,b)=>b.bytes-a.bytes).slice(0, 15);
for (const u of top) {
  const slice = buf.slice(u.start, Math.min(u.end, u.start+48));
  const hex = [...slice].map(b => b.toString(16).padStart(2, "0")).join(" ");
  const asc = [...slice].map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : ".").join("");
  console.log(`  0x${u.start.toString(16)} (${u.bytes} B) HEX: ${hex}`);
  console.log(`                              ASC: ${asc}`);
}
