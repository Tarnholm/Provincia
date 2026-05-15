// dig-settlegap1.js — investigate intra-settlement-zone gap #1: 0x015b7114..0x015c2d47 (48,179 B)
//
// Session 60 target: largest unclaimed gap inside the settlement zone per cover.js after session 59.
// Hypothesis: per-settlement non-chain payload — pop breakdown, garrison roster, construction queue,
// settlement events, or building progress. Likely same structure repeats across all top-5 small gaps.

"use strict";
const fs = require("fs");

const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const GAP_START = 0x015b7114;
const GAP_END   = 0x015c2d47;

const buf = fs.readFileSync(SAVE);
const len = GAP_END - GAP_START;
console.log(`gap: 0x${GAP_START.toString(16)}..0x${GAP_END.toString(16)} = ${len} bytes (${(len/1024).toFixed(1)} KB)`);

// ---- 1. Hex dump first 256 B and last 256 B ----------------------------
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
hexdump("First 256 B of gap", GAP_START, 16);
hexdump("Last 256 B of gap",  GAP_END - 256, 16);

// ---- 2. Byte histogram + entropy ---------------------------------------
const hist = new Uint32Array(256);
for (let i = GAP_START; i < GAP_END; i++) hist[buf[i]]++;
const sorted = [...hist].map((c, b) => ({b, c})).sort((a, b) => b.c - a.c);
console.log("\n=== Top 12 byte values ===");
for (let i = 0; i < 12; i++) {
  const e = sorted[i];
  console.log(`  0x${e.b.toString(16).padStart(2,"0")}  ${e.c.toString().padStart(8)}  ${(e.c/len*100).toFixed(2)}%`);
}
const zc = hist[0];
console.log(`  zeros: ${zc} (${(zc/len*100).toFixed(2)}%)  nonzero: ${len-zc}`);
let entropy = 0;
for (let i = 0; i < 256; i++) { if (hist[i]) { const p = hist[i]/len; entropy -= p*Math.log2(p); } }
console.log(`  shannon entropy: ${entropy.toFixed(3)} bits/byte`);

// ---- 3. ASCII strings >= 4 chars ---------------------------------------
console.log("\n=== ASCII strings >= 4 chars (first 120) ===");
const strs = [];
let cur = "", curStart = -1;
for (let i = GAP_START; i < GAP_END; i++) {
  const b = buf[i];
  if (b >= 0x20 && b < 0x7f) {
    if (!cur.length) curStart = i;
    cur += String.fromCharCode(b);
  } else {
    if (cur.length >= 4) strs.push({ off: curStart, s: cur });
    cur = ""; curStart = -1;
  }
}
if (cur.length >= 4) strs.push({ off: curStart, s: cur });
console.log(`  total strings >= 4 chars: ${strs.length}`);
for (let i = 0; i < Math.min(120, strs.length); i++) {
  const s = strs[i];
  console.log(`  0x${s.off.toString(16).padStart(8,"0")}  (${s.s.length}) ${JSON.stringify(s.s).slice(0,90)}`);
}

// ---- 4. Magic markers / known tokens ----------------------------------
const MAGICS = [
  { n: "ff 0a af f0 (faction)", b: Buffer.from([0xff,0x0a,0xaf,0xf0]) },
  { n: "f0 0a af f0", b: Buffer.from([0xf0,0x0a,0xaf,0xf0]) },
  { n: "0a 07 (save magic)", b: Buffer.from([0x0a,0x07]) },
  { n: "ff ff ff ff", b: Buffer.from([0xff,0xff,0xff,0xff]) },
  { n: "ac fe 45 12 (slot sentinel)", b: Buffer.from([0xac,0xfe,0x45,0x12]) },
  { n: "00 00 80 7f (NaN f32)", b: Buffer.from([0x00,0x00,0x80,0x7f]) },
];
console.log("\n=== Magic hits in gap ===");
for (const m of MAGICS) {
  let count = 0, first = [];
  let p = GAP_START;
  while (p < GAP_END - m.b.length) {
    const i = buf.indexOf(m.b, p);
    if (i < 0 || i >= GAP_END) break;
    count++;
    if (first.length < 6) first.push(i);
    p = i + 1;
  }
  console.log(`  ${m.n}: ${count}${first.length?" first="+first.map(o=>"0x"+o.toString(16)).join(","):""}`);
}

// ---- 5. ASCII token search: building / unit / culture / faction names --
const TOKENS = [
  "core_building","temple","barracks","wall","market","port","mine","governor","road",
  "peasants","hoplite","legionary","spear","cavalry","archer","skirm",
  "roman","greek","barbarian","carthaginian","eastern","egyptian","nomad",
  "romans_julii","carthage","egypt","macedon","gauls","britons","seleucid","parthia","scythia",
  "happy","unhappy","health","trade","tax","construct","queue","barbarian",
];
console.log("\n=== Token searches (case-insensitive, partial OK) ===");
const slice = buf.slice(GAP_START, GAP_END);
const txt = slice.toString("latin1").toLowerCase();
for (const t of TOKENS) {
  let count = 0, idx = 0, firstAt = -1;
  while ((idx = txt.indexOf(t, idx)) !== -1) {
    if (count === 0) firstAt = idx;
    count++;
    idx += 1;
  }
  if (count) console.log(`  "${t}": ${count} hits (first @ +0x${firstAt.toString(16)})`);
}

// ---- 6. taw self-pointer scan -----------------------------------------
console.log("\n=== taw self-pointer hits ===");
let sec = [];
for (let p = GAP_START; p < GAP_END - 8; p++) {
  if (buf.readUInt32LE(p) === p) {
    const sz = buf.readUInt32LE(p + 4);
    if (sz > 0 && sz < len) {
      sec.push({ off: p, size: sz });
      if (sec.length >= 64) break;
    }
  }
}
console.log(`  taw hits: ${sec.length}`);
for (let i = 0; i < Math.min(20, sec.length); i++) {
  const h = sec[i];
  console.log(`  0x${h.off.toString(16).padStart(8,"0")}  size=${h.size}  end=0x${(h.off+8+h.size).toString(16)}`);
}

// ---- 7. Stride autocorrelation -----------------------------------------
console.log("\n=== Stride autocorrelation (% byte-eq at stride) ===");
const SAMPLE = Math.min(len, 40000);
const strides = [2,3,4,5,6,8,10,12,14,16,20,24,28,32,36,40,48,56,64,80,96,112,128,160,192,256,320,512,1024,2048,4096];
const baseline = (sorted[0].c / len) * 100;
console.log(`  (baseline if all-same byte = ${baseline.toFixed(2)}%)`);
for (const s of strides) {
  let same = 0, total = 0;
  for (let i = 0; i < SAMPLE - s; i += 4) { total++; if (buf[GAP_START+i] === buf[GAP_START+i+s]) same++; }
  console.log(`  stride ${s.toString().padStart(4)}: ${(same/total*100).toFixed(2)}%`);
}

// ---- 8. u32 fields at start --------------------------------------------
console.log("\n=== u32 fields at gap start (first 96 bytes) ===");
for (let off = 0; off < 96; off += 4) {
  const u = buf.readUInt32LE(GAP_START + off);
  console.log(`  +${off.toString().padStart(3)}  u32=0x${u.toString(16).padStart(8,"0")}  dec=${u}  i32=${u|0}`);
}

// ---- 9. Find boundaries with cover claims (last claimed before, first after) --
// Look for typical settlement-record markers near the gap edges.
console.log("\n=== 64 B just BEFORE gap ===");
hexdump("pre-gap", GAP_START - 64, 4);
console.log("\n=== 64 B just AFTER gap ===");
hexdump("post-gap", GAP_END, 4);

// ---- 10. Long zero / single-byte runs ----------------------------------
let zStart = -1; const zRuns = [];
for (let i = GAP_START; i <= GAP_END; i++) {
  if (i < GAP_END && buf[i] === 0) { if (zStart < 0) zStart = i; }
  else if (zStart >= 0) { if (i - zStart >= 32) zRuns.push({ s: zStart, e: i, l: i-zStart }); zStart = -1; }
}
console.log(`\n=== Zero runs >= 32 B: ${zRuns.length} ===`);
for (const z of zRuns.sort((a,b)=>b.l-a.l).slice(0,8))
  console.log(`  0x${z.s.toString(16).padStart(8,"0")}..0x${z.e.toString(16).padStart(8,"0")}  len=${z.l}`);
