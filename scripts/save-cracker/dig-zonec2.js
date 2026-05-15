// dig-zonec2.js — session 55 attempt 2.
// Hypothesis from attempt 1: Zone C is the CHARACTER_PATHS body section.
// Each record header is [u32 selfptr=pos][u32 size]; payload is path waypoints.
// Attempt 1 caused 1,582 false-positive "overlapping" records by scanning all
// byte positions. The real layout is sequential records back-to-back.

"use strict";

const fs = require("fs");

const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const ZC_START = 0xa8beb;
const ZC_END   = 0xf8fd2;

const buf = fs.readFileSync(SAVE);

// ---- 1. Sequential walk: assume each record is [u32 selfptr=pos][u32 size][payload].
const recs = [];
let p = ZC_START;
while (p + 8 <= ZC_END) {
  const sp = buf.readUInt32LE(p);
  const sz = buf.readUInt32LE(p + 4);
  if (sp !== p) {
    console.log(`STOP: at 0x${p.toString(16)} self-ptr=${sp} != pos (size=${sz})`);
    break;
  }
  if (sz === 0 || sz > 16384) {
    console.log(`STOP: at 0x${p.toString(16)} bad size=${sz}`);
    break;
  }
  recs.push({ off: p, size: sz, payStart: p + 8, payEnd: p + 8 + sz });
  p = p + 8 + sz;
}
console.log(`sequential walk consumed up to 0x${p.toString(16)} (zone ends 0x${ZC_END.toString(16)}, tail gap=${ZC_END - p})`);
console.log(`records: ${recs.length}`);

// ---- 2. Size histogram (top 20 exact, plus all distinct).
const sizeHist = new Map();
for (const r of recs) sizeHist.set(r.size, (sizeHist.get(r.size)||0)+1);
const sortedSizes = [...sizeHist.entries()].sort((a,b)=>b[1]-a[1]);
console.log(`\ndistinct sizes: ${sizeHist.size}`);
console.log("top 20 sizes:");
for (let i = 0; i < Math.min(20, sortedSizes.length); i++) {
  const [s,c] = sortedSizes[i];
  console.log(`  ${String(s).padStart(5)} B : ${c}`);
}
// size stats
const sizes = recs.map(r=>r.size).sort((a,b)=>a-b);
const total = sizes.reduce((a,b)=>a+b, 0);
console.log(`size: min=${sizes[0]} med=${sizes[Math.floor(sizes.length/2)]} max=${sizes[sizes.length-1]} mean=${(total/sizes.length).toFixed(1)}`);

// ---- 3. Decode each record as a waypoint list.
// Hypothesis: [u32 a][u32 b][u32 c][u32 d] header, then N (x,y) pairs where N relates to size.
// Each waypoint pair is 8 bytes (two u32s). (size - hdr) % 8 should be 0 if pure waypoints.
let pure8 = 0, near8 = 0;
const hdrTries = {};
for (const r of recs) {
  for (const hdr of [0, 4, 8, 12, 16, 20, 24]) {
    const rem = r.size - hdr;
    if (rem >= 0 && rem % 8 === 0) {
      hdrTries[hdr] = (hdrTries[hdr] || 0) + 1;
    }
  }
}
console.log(`\nrecords where (size - hdr) % 8 === 0:`);
for (const [hdr, c] of Object.entries(hdrTries)) {
  console.log(`  hdr=${hdr}: ${c} records (${(c/recs.length*100).toFixed(1)}%)`);
}

// ---- 4. Dump first 3 records in detail to find the (count, payload) split.
console.log("\n=== First 3 records full payload (hex+ascii) ===");
for (let i = 0; i < 3 && i < recs.length; i++) {
  const r = recs[i];
  console.log(`\n  Rec[${i}] off=0x${r.off.toString(16)} size=${r.size}`);
  // Header has selfptr+size already excluded; payload starts at payStart.
  // Dump 64 bytes of header + 32 bytes of mid + 32 bytes of tail.
  const dumpRange = (label, start, len) => {
    console.log(`    -- ${label} --`);
    for (let row = 0; row < Math.ceil(len/16); row++) {
      const base = row*16;
      const hex = [];
      const ascii = [];
      const u32s = [];
      for (let c = 0; c < 16 && base+c < len; c++) {
        const b = buf[start+base+c];
        hex.push(b.toString(16).padStart(2,"0"));
        ascii.push(b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".");
      }
      // u32 row interpretation (4 values)
      for (let c = 0; c < 16 && start+base+c+4 <= r.payEnd; c += 4) {
        u32s.push(buf.readUInt32LE(start+base+c));
      }
      const relOff = (start - r.payStart) + base;
      console.log(`    +${String(relOff).padStart(4)}  ${hex.join(" ").padEnd(48)}  |${ascii.join("")}|  u32: ${u32s.join(", ")}`);
    }
  };
  dumpRange("head", r.payStart, Math.min(48, r.size));
  if (r.size > 80) dumpRange("tail", r.payEnd - 32, 32);
}

// ---- 5. Now suppose (x, y) waypoints fill the body. Test: are payload u32s
// at offsets 16, 24, 32, ... small (< 500 — tile-coord range for 240x238)?
console.log("\n=== Waypoint range check ===");
// For each record, count u32 values < 1000 at offsets 16, 24, 32, ...
let totalU32s = 0, smallU32s = 0;
for (const r of recs) {
  for (let o = 16; o + 4 <= r.size; o += 4) {
    totalU32s++;
    const v = buf.readUInt32LE(r.payStart + o);
    if (v < 1000) smallU32s++;
  }
}
console.log(`  u32s at payload offset >= 16 that are < 1000: ${smallU32s}/${totalU32s} = ${(smallU32s/totalU32s*100).toFixed(1)}%`);

// ---- 6. Header field analysis: examine the first 16 bytes of each record.
// We know payload[+8] = u32 in 0..238 (100% hit in attempt 1).
// And payload[+12] also 0..238 (100% hit). These could be (charIdx, factionId) or (x,y) coords of last position.
// Verify if payload[+8] is bounded — max value?
let max8 = 0, max12 = 0, max0 = 0, max4 = 0;
const distinct8 = new Set();
const distinct12 = new Set();
const distinct0 = new Set();
for (const r of recs) {
  if (r.size >= 4)  { const v = buf.readUInt32LE(r.payStart + 0);  if (v > max0)  max0  = v; distinct0.add(v); }
  if (r.size >= 8)  { const v = buf.readUInt32LE(r.payStart + 4);  if (v > max4)  max4  = v; }
  if (r.size >= 12) { const v = buf.readUInt32LE(r.payStart + 8);  if (v > max8)  max8  = v; distinct8.add(v); }
  if (r.size >= 16) { const v = buf.readUInt32LE(r.payStart + 12); if (v > max12) max12 = v; distinct12.add(v); }
}
console.log(`\n  payload[+0]:  max=${max0} (waypoint count?)  distinct=${distinct0.size}`);
console.log(`  payload[+4]:  max=${max4}`);
console.log(`  payload[+8]:  max=${max8} distinct=${distinct8.size}  <-- 100% in 0..238`);
console.log(`  payload[+12]: max=${max12} distinct=${distinct12.size}  <-- 100% in 0..238`);

// ---- 7. Test correlation: payload[+0] as "waypoint count" — does its value
// predict the size? If yes, size ≈ K * count + const.
let countSamples = [];
for (const r of recs) {
  if (r.size >= 4) countSamples.push({ cnt: buf.readUInt32LE(r.payStart), size: r.size });
}
// linear fit: size = a*cnt + b ; estimate via correlation
const n = countSamples.length;
const sumX = countSamples.reduce((s,x)=>s+x.cnt,0);
const sumY = countSamples.reduce((s,x)=>s+x.size,0);
const sumXY = countSamples.reduce((s,x)=>s+x.cnt*x.size,0);
const sumX2 = countSamples.reduce((s,x)=>s+x.cnt*x.cnt,0);
const sumY2 = countSamples.reduce((s,x)=>s+x.size*x.size,0);
const a = (n*sumXY - sumX*sumY) / (n*sumX2 - sumX*sumX);
const b = (sumY - a*sumX) / n;
const corr = (n*sumXY - sumX*sumY) /
  Math.sqrt((n*sumX2 - sumX*sumX) * (n*sumY2 - sumY*sumY));
console.log(`\n  Linear fit size = ${a.toFixed(3)} * payload[+0] + ${b.toFixed(2)}, corr = ${corr.toFixed(4)}`);

// ---- 8. If payload[+0] is NOT waypoint count, maybe payload[+4] or [+8] is.
// Try each candidate field; pick the one with best linear correlation to size.
function corrOf(getter) {
  const xs = recs.filter(r=>r.size>=16).map(r=>getter(r));
  const ys = recs.filter(r=>r.size>=16).map(r=>r.size);
  const n = xs.length;
  const sX = xs.reduce((s,v)=>s+v, 0);
  const sY = ys.reduce((s,v)=>s+v, 0);
  const sXY = xs.reduce((s,v,i)=>s+v*ys[i], 0);
  const sX2 = xs.reduce((s,v)=>s+v*v, 0);
  const sY2 = ys.reduce((s,v)=>s+v*v, 0);
  const c = (n*sXY - sX*sY) / Math.sqrt((n*sX2 - sX*sX)*(n*sY2 - sY*sY));
  const slope = (n*sXY - sX*sY)/(n*sX2 - sX*sX);
  return { corr: c, slope };
}
console.log("\n  Field-vs-size correlations:");
for (const off of [0, 4, 8, 12]) {
  const { corr, slope } = corrOf(r => buf.readUInt32LE(r.payStart + off));
  console.log(`    payload[+${off}]: corr=${corr.toFixed(4)} slope=${slope.toFixed(3)}`);
}

// ---- 9. Compute apparent waypoint count as (size - 16) / 8 and compare to fields.
console.log("\n  Implied count = (size - 16)/8 vs payload[+0..+12]:");
for (let i = 0; i < 5 && i < recs.length; i++) {
  const r = recs[i];
  const impl = (r.size - 16) / 8;
  const p0 = buf.readUInt32LE(r.payStart);
  const p4 = buf.readUInt32LE(r.payStart + 4);
  const p8 = buf.readUInt32LE(r.payStart + 8);
  const p12 = buf.readUInt32LE(r.payStart + 12);
  console.log(`    rec[${i}] size=${r.size} impl_count=${impl} payload[+0]=${p0} [+4]=${p4} [+8]=${p8} [+12]=${p12}`);
}

// ---- 10. Save offset+size for all records (CSV-like dump head/tail).
// And output relationship between record count and known entity counts.
console.log(`\n  records: ${recs.length}`);
console.log(`  239 factions, 213 regions, characters from descr_strat = many hundreds.`);
console.log(`  per-character path: 1705 chars total? plausible for an empire-scale save.`);

// ---- 11. Cross-check: walk forward from each record's payload[+8] (=u32 in 0..238)
// and see if these match faction IDs in distribution.
const fid8Hist = new Map();
for (const r of recs) {
  if (r.size >= 12) {
    const v = buf.readUInt32LE(r.payStart + 8);
    fid8Hist.set(v, (fid8Hist.get(v)||0)+1);
  }
}
const fidTop = [...fid8Hist.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15);
console.log(`\n  payload[+8] histogram (top 15) — should match faction-distribution:`);
for (const [v,c] of fidTop) console.log(`    val=${v}  count=${c}`);

// Same for payload[+12]
const fid12Hist = new Map();
for (const r of recs) {
  if (r.size >= 16) {
    const v = buf.readUInt32LE(r.payStart + 12);
    fid12Hist.set(v, (fid12Hist.get(v)||0)+1);
  }
}
const fid12Top = [...fid12Hist.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15);
console.log(`\n  payload[+12] histogram (top 15):`);
for (const [v,c] of fid12Top) console.log(`    val=${v}  count=${c}`);
