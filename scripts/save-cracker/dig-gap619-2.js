// dig-gap619-2.js — drill into the three distinct zones we found in gap 0x61c47..0xf8fd2:
//   Zone A: 0x61c47..0x846af   (~143 KB) — sparse 0/01 with periodic 215-byte zero runs
//   Zone B: 0x846af..0xa8beb   (~145 KB) — historic/olympics/volcano/eruption scripted-event names
//   Zone C: 0xa8beb..0xf8fd2   (~321 KB) — dense taw section headers of size ~560-767 bytes

"use strict";

const fs = require("fs");

const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const GAP_START = 0x61c47;
const GAP_END   = 0xf8fd2;
const buf = fs.readFileSync(SAVE);

// ---- ZONE A: 0x61c47..0x846af. Periodic ~219-byte zero gaps suggest a fixed-stride record table.
// Many runs are 215 / 219 bytes, so records are probably 224 or 230 bytes (zero gap + ~10-15 nonzero bytes).
console.log("=== ZONE A scan: stride 224 / 226 / 228 / 230 / 232 ===");
const ZA_START = 0x61c47;
const ZA_END   = 0x846af;
console.log(`  range ${(ZA_END-ZA_START)} bytes`);

// Locate the first nonzero pos in zone A — already know 0x61c67 looks like start.
// Confirm stride by checking distances between consecutive nonzero bytes after each zero run.
const nonzeroPositions = [];
for (let i = ZA_START; i < ZA_END; i++) {
  if (buf[i] !== 0) nonzeroPositions.push(i);
}
console.log(`  nonzero positions: ${nonzeroPositions.length} (avg gap ${((ZA_END-ZA_START)/nonzeroPositions.length).toFixed(1)})`);

// Cluster nonzero positions: find "record starts" by gaps >= 50
const records = [];
let cur = [nonzeroPositions[0]];
for (let i = 1; i < nonzeroPositions.length; i++) {
  if (nonzeroPositions[i] - nonzeroPositions[i-1] > 50) {
    records.push({ start: cur[0], end: cur[cur.length-1]+1 });
    cur = [];
  }
  cur.push(nonzeroPositions[i]);
}
if (cur.length) records.push({ start: cur[0], end: cur[cur.length-1]+1 });
console.log(`  record-like clusters: ${records.length}`);
if (records.length > 1) {
  const gaps = [];
  for (let i = 1; i < records.length; i++) gaps.push(records[i].start - records[i-1].start);
  gaps.sort((a,b)=>a-b);
  const med = gaps[Math.floor(gaps.length/2)];
  const mode = new Map();
  for (const g of gaps) mode.set(g, (mode.get(g)||0)+1);
  const topModes = [...mode.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);
  console.log(`  inter-cluster stride median: ${med}, min: ${gaps[0]}, max: ${gaps[gaps.length-1]}`);
  console.log(`  top stride values: ${topModes.map(([g,c])=>`${g}(${c}x)`).join(", ")}`);
}
console.log("  first 6 record clusters:");
for (let i = 0; i < Math.min(6, records.length); i++) {
  const r = records[i];
  const slice = buf.slice(r.start, Math.min(r.end+8, r.start+40));
  console.log(`    0x${r.start.toString(16).padStart(8,"0")}..0x${r.end.toString(16).padStart(8,"0")} (${r.end-r.start}B): ${slice.toString("hex").match(/.{1,2}/g).join(" ")}`);
}

// ---- ZONE B: 0x846af..0xa8beb. Scripted-event records w/ asciiz names. Estimate record stride.
console.log("\n=== ZONE B scan: scripted-event record table ===");
const ZB_START = 0x846af;
const ZB_END   = 0xa8beb;

// Collect all ASCII strings >= 4 chars in zone B.
const strs = [];
{
  let cur = "";
  let curStart = -1;
  for (let i = ZB_START; i < ZB_END; i++) {
    const b = buf[i];
    if (b >= 0x20 && b < 0x7f) {
      if (!cur) curStart = i;
      cur += String.fromCharCode(b);
    } else {
      if (cur.length >= 4) strs.push({ off: curStart, s: cur });
      cur = "";
    }
  }
  if (cur.length >= 4) strs.push({ off: curStart, s: cur });
}
console.log(`  strings >= 4 chars: ${strs.length}`);
// Find the prefix-class distribution
const prefixes = new Map();
for (const s of strs) {
  const tok = s.s.split(/[_0-9]/)[0];
  prefixes.set(tok, (prefixes.get(tok)||0)+1);
}
const topPref = [...prefixes.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15);
console.log(`  top string prefixes: ${topPref.map(([p,c])=>`${p}(${c})`).join(", ")}`);

// Distances between consecutive scripted-event records (taw header sizes 34 / variable).
// Use any taw header { selfPtr==pos, size } in ZB and tabulate.
const zbTaw = [];
for (let p = ZB_START; p < ZB_END - 8; p++) {
  if (buf.readUInt32LE(p) === p) {
    const sz = buf.readUInt32LE(p + 4);
    if (sz > 0 && sz < 4096) zbTaw.push({ off: p, size: sz });
  }
}
console.log(`  taw self-pointer hits in ZB: ${zbTaw.length}`);
const zbSizeHist = new Map();
for (const t of zbTaw) zbSizeHist.set(t.size, (zbSizeHist.get(t.size)||0)+1);
const topSizes = [...zbSizeHist.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12);
console.log(`  size distribution: ${topSizes.map(([s,c])=>`${s}(${c}x)`).join(", ")}`);
console.log("  first 6 zb taw records:");
for (let i = 0; i < Math.min(6, zbTaw.length); i++) {
  const t = zbTaw[i];
  // Read the payload start
  const payStart = t.off + 8;
  const slice = buf.slice(payStart, Math.min(payStart + 40, t.off + 8 + t.size));
  let txt = "";
  for (const b of slice) txt += (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : ".";
  console.log(`    0x${t.off.toString(16)} size=${t.size}: "${txt}"`);
}

// ---- ZONE C: 0xa8beb..0xf8fd2. Dense taw headers of size 560-767. Decode them as records.
console.log("\n=== ZONE C scan: dense taw record table ===");
const ZC_START = 0xa8beb;
const ZC_END   = 0xf8fd2;
const zcTaw = [];
for (let p = ZC_START; p < ZC_END - 8; p++) {
  if (buf.readUInt32LE(p) === p) {
    const sz = buf.readUInt32LE(p + 4);
    if (sz > 0 && sz < 8192) zcTaw.push({ off: p, size: sz });
  }
}
console.log(`  taw self-pointer hits in ZC: ${zcTaw.length}`);
// Size histogram
const zcSizeHist = new Map();
for (const t of zcTaw) zcSizeHist.set(t.size, (zcSizeHist.get(t.size)||0)+1);
const zcTop = [...zcSizeHist.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15);
console.log(`  size distribution top: ${zcTop.map(([s,c])=>`${s}(${c}x)`).join(", ")}`);
// Distances between consecutive headers
console.log("  first 8 ZC taw records:");
for (let i = 0; i < Math.min(8, zcTaw.length); i++) {
  const t = zcTaw[i];
  const payStart = t.off + 8;
  const slice = buf.slice(payStart, Math.min(payStart + 64, t.off + 8 + t.size));
  let txt = "";
  for (const b of slice) txt += (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : ".";
  console.log(`    0x${t.off.toString(16)} size=${t.size}: "${txt}"`);
}
// Inter-record distances
const interDist = [];
for (let i = 1; i < zcTaw.length; i++) {
  interDist.push(zcTaw[i].off - zcTaw[i-1].off);
}
interDist.sort((a,b)=>a-b);
if (interDist.length) {
  console.log(`  inter-record distance: min=${interDist[0]} med=${interDist[Math.floor(interDist.length/2)]} max=${interDist[interDist.length-1]}`);
}

// Are headers wall-to-wall (sums match zone size)?
let totalConsumed = 0;
let maxEnd = ZC_START;
for (const t of zcTaw) {
  const end = t.off + 8 + t.size;
  if (t.off >= maxEnd) {
    totalConsumed += (end - t.off);
    maxEnd = end;
  }
}
console.log(`  ZC zone size: ${ZC_END - ZC_START}, headers consume (non-overlapping): ${totalConsumed} bytes (${(totalConsumed/(ZC_END-ZC_START)*100).toFixed(1)}%)`);

// ---- Section header trail before gap (look at 0x61c00..0x61c47) ----
console.log("\n=== Bytes immediately before gap start (0x61c20..0x61c47) ===");
for (let p = 0x61c20; p < 0x61c47; p += 16) {
  const hex = [];
  const ascii = [];
  for (let c = 0; c < 16 && p+c < 0x61c47; c++) {
    const b = buf[p+c];
    hex.push(b.toString(16).padStart(2,"0"));
    ascii.push(b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".");
  }
  console.log(`  0x${p.toString(16).padStart(8,"0")}  ${hex.join(" ")}  |${ascii.join("")}|`);
}

// ---- Look for "expanded_bi.txt" style refs to identify what these records describe ----
// e.g. tribe_known / scripted_event types stored as 4-byte indices into HST.
// Print the bytes right BEFORE the first volcano string (0x84672 area)
console.log("\n=== Bytes around first 'historic' string (0x846a0..0x84700) ===");
for (let p = 0x846a0; p < 0x84720; p += 16) {
  const hex = [];
  const ascii = [];
  for (let c = 0; c < 16; c++) {
    const b = buf[p+c];
    hex.push(b.toString(16).padStart(2,"0"));
    ascii.push(b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".");
  }
  console.log(`  0x${p.toString(16).padStart(8,"0")}  ${hex.join(" ")}  |${ascii.join("")}|`);
}
