// dig-gap214-1.js — investigate the 214 KB unclaimed gap at 0x2d4a9..0x618f8.
//
// Session 56 target: second-biggest unclaimed range in save_1.2.sav per cover.js.
// Sits between post-fow region (~0x2d15a) and the first character record area.
// Hypotheses: char-uuid index, faction reference table, scripted events, scenario
// preamble, or string pool.

"use strict";

const fs = require("fs");

const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const GAP_START = 0x2d4a9;
const GAP_END   = 0x618f8;

const buf = fs.readFileSync(SAVE);
const len = GAP_END - GAP_START;
console.log(`gap: 0x${GAP_START.toString(16)}..0x${GAP_END.toString(16)} = ${len} bytes (${(len/1024).toFixed(1)} KB)`);

// ---- 1. Hex dump first 256 B and last 256 B ---------------------------
function hexdump(label, start, rows) {
  console.log(`\n=== ${label} ===`);
  for (let row = 0; row < rows; row++) {
    const base = start + row * 16;
    if (base >= buf.length) break;
    const hex = [];
    const ascii = [];
    for (let c = 0; c < 16; c++) {
      const b = buf[base + c];
      hex.push(b.toString(16).padStart(2, "0"));
      ascii.push(b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".");
    }
    console.log(`  0x${base.toString(16).padStart(8, "0")}  ${hex.join(" ")}  |${ascii.join("")}|`);
  }
}
hexdump("First 256 bytes of gap", GAP_START, 16);
hexdump("Last 256 bytes of gap",  GAP_END - 256, 16);

// ---- 2. Byte histogram -----------------------------------------------
const hist = new Uint32Array(256);
for (let i = GAP_START; i < GAP_END; i++) hist[buf[i]]++;
const sortedHist = [...hist].map((c, b) => ({b, c})).sort((a, b) => b.c - a.c);
console.log("\n=== Top 16 byte values ===");
console.log("  byte    count       pct");
for (let i = 0; i < 16; i++) {
  const e = sortedHist[i];
  const pct = (e.c / len * 100).toFixed(2);
  console.log(`  0x${e.b.toString(16).padStart(2, "0")}    ${e.c.toString().padStart(8)}    ${pct.padStart(5)}%`);
}
const zeroCount = hist[0];
console.log(`\n  zero bytes:    ${zeroCount} (${(zeroCount/len*100).toFixed(2)}%)`);
console.log(`  nonzero:       ${len - zeroCount} (${((len-zeroCount)/len*100).toFixed(2)}%)`);
// Shannon entropy
let entropy = 0;
for (let i = 0; i < 256; i++) {
  if (hist[i] === 0) continue;
  const p = hist[i] / len;
  entropy -= p * Math.log2(p);
}
console.log(`  shannon entropy: ${entropy.toFixed(3)} bits/byte (8=random, ~4-5=binary, low=padding)`);

// ---- 3. ASCII strings ------------------------------------------------
console.log("\n=== ASCII strings >= 5 chars (first 80) ===");
const strs = [];
let cur = "";
let curStart = -1;
for (let i = GAP_START; i < GAP_END; i++) {
  const b = buf[i];
  if (b >= 0x20 && b < 0x7f) {
    if (cur.length === 0) curStart = i;
    cur += String.fromCharCode(b);
  } else {
    if (cur.length >= 5) strs.push({ off: curStart, s: cur });
    cur = ""; curStart = -1;
  }
}
if (cur.length >= 5) strs.push({ off: curStart, s: cur });
console.log(`  total strings >= 5 chars: ${strs.length}`);
for (let i = 0; i < Math.min(80, strs.length); i++) {
  const s = strs[i];
  console.log(`  0x${s.off.toString(16).padStart(8, "0")}  (${s.s.length}) ${JSON.stringify(s.s).slice(0, 100)}`);
}

// ---- 4. Look for known magic markers and faction names --------------
const MAGICS = [
  { name: "ff 0a af f0 (faction)", b: Buffer.from([0xff, 0x0a, 0xaf, 0xf0]) },
  { name: "f0 0a af f0 (secondary)", b: Buffer.from([0xf0, 0x0a, 0xaf, 0xf0]) },
  { name: "0a 07 (save magic)", b: Buffer.from([0x0a, 0x07]) },
  { name: "ff ff ff ff (-1 sentinel)", b: Buffer.from([0xff, 0xff, 0xff, 0xff]) },
  { name: "romans_julii ascii", b: Buffer.from("romans_julii", "ascii") },
  { name: "carthage ascii", b: Buffer.from("carthage", "ascii") },
  { name: "egypt ascii", b: Buffer.from("egypt", "ascii") },
  { name: "macedon ascii", b: Buffer.from("macedon", "ascii") },
  { name: "gauls ascii", b: Buffer.from("gauls", "ascii") },
];
console.log("\n=== Magic / known-string hits in gap ===");
for (const m of MAGICS) {
  let count = 0;
  let firstOffs = [];
  let p = GAP_START;
  while (p < GAP_END - m.b.length) {
    const i = buf.indexOf(m.b, p);
    if (i < 0 || i >= GAP_END) break;
    count++;
    if (firstOffs.length < 5) firstOffs.push(i);
    p = i + 1;
  }
  console.log(`  ${m.name}: ${count} hits${firstOffs.length ? " first=" + firstOffs.map(o=>"0x"+o.toString(16)).join(",") : ""}`);
}

// ---- 5. Section taw header scan: { u32 selfPtr === pos, u32 size } --
console.log("\n=== Section taw self-pointer hits in gap ===");
let sectionHits = [];
for (let p = GAP_START; p < GAP_END - 8; p += 1) {
  const sp = buf.readUInt32LE(p);
  if (sp === p) {
    const sz = buf.readUInt32LE(p + 4);
    if (sz > 0 && sz < len) {
      sectionHits.push({ off: p, size: sz });
      if (sectionHits.length >= 200) break;
    }
  }
}
console.log(`  total taw hits: ${sectionHits.length}`);
for (let i = 0; i < Math.min(40, sectionHits.length); i++) {
  const h = sectionHits[i];
  console.log(`  0x${h.off.toString(16).padStart(8, "0")}  size=${h.size} (0x${h.size.toString(16)})  end=0x${(h.off + 8 + h.size).toString(16)}`);
}

// ---- 6. Stride autocorrelation --------------------------------------
console.log("\n=== Stride autocorrelation (higher % = more periodic) ===");
const SAMPLE = Math.min(len, 200000);
const strides = [4, 8, 12, 16, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96, 100, 128, 160, 192, 256, 267, 308, 512, 1024];
for (const s of strides) {
  let same = 0;
  let total = 0;
  for (let i = 0; i < SAMPLE - s; i += 4) {
    total++;
    if (buf[GAP_START + i] === buf[GAP_START + i + s]) same++;
  }
  const pct = (same / total * 100).toFixed(2);
  console.log(`  stride ${s.toString().padStart(4)}: ${pct}% byte-eq`);
}

// ---- 7. Read potential header u32 fields at gap start --------------
console.log("\n=== u32 fields at gap start ===");
for (let off = 0; off < 96; off += 4) {
  const u = buf.readUInt32LE(GAP_START + off);
  console.log(`  +${off.toString().padStart(3)}  u32=0x${u.toString(16).padStart(8, "0")}  dec=${u}`);
}

// ---- 8. Long zero runs ---------------------------------------------
console.log("\n=== Long zero runs (>= 64 bytes) ===");
let zRunStart = -1;
const zRuns = [];
for (let i = GAP_START; i <= GAP_END; i++) {
  if (i < GAP_END && buf[i] === 0) {
    if (zRunStart < 0) zRunStart = i;
  } else if (zRunStart >= 0) {
    if (i - zRunStart >= 64) zRuns.push({ start: zRunStart, end: i, len: i - zRunStart });
    zRunStart = -1;
  }
}
console.log(`  zero runs >= 64: ${zRuns.length}, total bytes: ${zRuns.reduce((a,r)=>a+r.len,0)}`);
const topZ = [...zRuns].sort((a,b)=>b.len-a.len).slice(0,10);
for (const z of topZ) {
  console.log(`  0x${z.start.toString(16).padStart(8,"0")}..0x${z.end.toString(16).padStart(8,"0")}  len=${z.len}`);
}

// ---- 9. Long runs of any single byte value (RLE/padding signature) --
console.log("\n=== Long single-byte runs (>= 32 bytes) — top 12 by length ===");
let bRunStart = -1;
let bRunByte = -1;
const bRuns = [];
for (let i = GAP_START; i <= GAP_END; i++) {
  const cur = i < GAP_END ? buf[i] : -1;
  if (bRunStart < 0 || cur !== bRunByte) {
    if (bRunStart >= 0 && (i - bRunStart) >= 32) {
      bRuns.push({ start: bRunStart, end: i, len: i - bRunStart, byte: bRunByte });
    }
    bRunStart = i;
    bRunByte = cur;
  }
}
const topB = [...bRuns].sort((a,b)=>b.len-a.len).slice(0,12);
for (const r of topB) {
  console.log(`  0x${r.start.toString(16).padStart(8,"0")}..0x${r.end.toString(16).padStart(8,"0")}  len=${r.len}  byte=0x${r.byte.toString(16).padStart(2,"0")}`);
}
