// dig-last075-7.js — Build the FINAL detector pair:
//   (A) multi-stride (S=7 or 9) record table with relaxed min-records=5
//   (B) all-zero-padding sweeper (>= 98% zeros, in army-trail/AI zone, <= 1024 B)
// Plus identify the standalone special cases:
//   * 0x3bb5 (2115 B) — header strings + flag table (extend header claim)
//   * 0xf84632 (6442 B) — first settlement-detail record (extend setts.length-1 lower bound)

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

const { size, unknowns } = data;

const ZONE_START = 0x14e5ac6;
const ZONE_END   = 0x20e6e8e;

function detectStrideTable(rs, re) {
  if (re - rs < 80) return null;
  if (rs < ZONE_START || re > ZONE_END) return null;
  let tailFF = 0;
  for (let i = re - 1; i >= rs && i >= re - 300; i--) {
    if (buf[i] === 0xff) tailFF++; else break;
  }
  const dataEnd = re - tailFF;
  if (dataEnd - rs < 45) return null;
  let best = null;
  for (const S of [7, 9]) {
    for (let off = 0; off < S; off++) {
      let total = 0, ok = 0;
      for (let p = rs + off; p + S <= dataEnd; p += S) {
        total++;
        let z = 0;
        for (let k = S - 4; k < S; k++) if (buf[p + k] === 0) z++;
        if (z === 4) ok++;
      }
      if (total < 5) continue;
      const pct = ok / total;
      if (!best || pct > best.pct) best = { S, off, ok, total, pct };
    }
  }
  if (!best || best.pct < 0.85) return null;
  return best;
}

function detectZeroPad(rs, re) {
  if (re - rs < 100 || re - rs > 1024) return null;
  // Require >= 98% zeros (allow a few sentinel bytes).
  let zeros = 0;
  for (let i = rs; i < re; i++) if (buf[i] === 0) zeros++;
  if (zeros / (re - rs) < 0.98) return null;
  return { zeros, pct: zeros / (re - rs) };
}

let nS = 0, bS = 0, nZ = 0, bZ = 0;
const claimedSet = new Set();
for (const u of unknowns) {
  const d = detectStrideTable(u.start, u.end);
  if (d) { nS++; bS += u.bytes; claimedSet.add(u.start); continue; }
  const z = detectZeroPad(u.start, u.end);
  if (z) { nZ++; bZ += u.bytes; claimedSet.add(u.start); }
}
console.log(`multi-stride detector: ${nS} runs (${bS} bytes)`);
console.log(`zero-pad detector:     ${nZ} runs (${bZ} bytes)`);
console.log(`total claimed:         ${nS + nZ} / ${unknowns.length} runs (${bS + bZ} bytes)`);

const rem = unknowns.filter(u => !claimedSet.has(u.start)).sort((a,b)=>b.bytes-a.bytes);
console.log(`\nresidual: ${rem.length} runs, ${rem.reduce((s,u)=>s+u.bytes,0)} bytes`);
for (const u of rem.slice(0, 20)) {
  const slice = buf.slice(u.start, Math.min(u.end, u.start+48));
  const hex = [...slice].map(b => b.toString(16).padStart(2, "0")).join(" ");
  const asc = [...slice].map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : ".").join("");
  console.log(`  0x${u.start.toString(16)} (${u.bytes} B) HEX: ${hex}`);
  console.log(`                              ASC: ${asc}`);
}

// 0x3bb5 — extend body-root header claim from [0x3bad, 0x3bb5) to [0x3bad, 0x43f8).
// This single contiguous extension covers the 2115 B unknown.
console.log("\n=== Special-case claims that cover.js should add ===");
console.log("  EXTEND body-root header: 0x3bad..0x43f8 (claims 2115 B unknown at 0x3bb5)");

// 0xf84632 — first settlement-detail record. The marker scanner found the
// FIRST marker at 0xf85f5c. But the record at 0xf84632 (just AFTER the tile-
// grid matrix end at 0xf84632) is a settlement-detail without a preceding
// marker. The marker is implicit (tile-grid end = first settlement start).
// Claim 0xf84632..0xf85f5c as "settlement-detail-record-0".
console.log("  EXPLICIT: 0xf84632..0xf85f5c = first settlement-detail (no preceding marker)");

// Project final coverage.
const oldUnknown = unknowns.reduce((s,u)=>s+u.bytes,0);
const headerExtClaim = 2115; // approx
const sett0Claim = 0xf85f5c - 0xf84632; // 6442
const totalAdded = bS + bZ + headerExtClaim + sett0Claim;
const newUnknown = oldUnknown - totalAdded;
console.log(`\n=== Projected coverage ===`);
console.log(`  total file:   ${size}`);
console.log(`  current unknown: ${oldUnknown} (${(oldUnknown/size*100).toFixed(3)}%)`);
console.log(`  added claims:    ${totalAdded}`);
console.log(`  new unknown:     ${newUnknown} (${(newUnknown/size*100).toFixed(3)}%)`);
console.log(`  new claimed:     ${(100 - newUnknown/size*100).toFixed(3)}%`);
