// dig-settlegap2.js — verify gaps #2-#5 share the structure found in gap #1 (dead-character pool).
// Gap #1 contained: taw-headed sub-records of ~500 B each, ASCII portrait paths
// "data/ui/greek/portraits/cards/old/generals/NNN.tga" and ".../dead/NNN.tga", repeating 211-byte
// zero stripes at ~364 B stride, then a "greek slingers" army right after the gap.
//
// Strong-hypothesis: each gap is a per-faction CHARACTER ROSTER (alive + dead/exiled with portraits)
// living between settlement records, OR the dead-characters trait list per faction.

"use strict";
const fs = require("fs");

const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const buf = fs.readFileSync(SAVE);

const GAPS = [
  { i: 1, s: 0x015b7114, e: 0x015c2d47 },
  { i: 2, s: 0x01506dea, e: 0x015102b5 },
  { i: 3, s: 0x016373ee, e: 0x0163f1d3 },
  { i: 4, s: 0x01585c08, e: 0x0158d753 },
  { i: 5, s: 0x01d0edb0, e: 0x01d1576d },
  { i: 6, s: 0x01f1a697, e: 0x01f1fc14 },
  { i: 7, s: 0x01632150, e: 0x0163709f },
];

function summarize(gap) {
  const { s, e } = gap;
  const len = e - s;
  console.log(`\n======== gap #${gap.i}  0x${s.toString(16)}..0x${e.toString(16)}  ${len} B ========`);

  // Histogram
  let zeros = 0, ffs = 0;
  for (let i = s; i < e; i++) { const b = buf[i]; if (b===0) zeros++; else if (b===0xff) ffs++; }
  console.log(`  zeros=${(zeros/len*100).toFixed(1)}%  0xFF=${(ffs/len*100).toFixed(1)}%`);

  // taw self-pointers
  let taw = 0, tawSamples = [];
  for (let p = s; p < e - 8; p++) {
    if (buf.readUInt32LE(p) === p) {
      const sz = buf.readUInt32LE(p+4);
      if (sz > 0 && sz < len) {
        taw++;
        if (tawSamples.length < 4) tawSamples.push({off:p, sz});
        if (taw >= 500) break;
      }
    }
  }
  console.log(`  taw self-pointers: ${taw}${tawSamples.length?" sample sizes="+tawSamples.map(t=>t.sz).join(","):""}`);

  // Portrait-path / faction culture tokens
  const slice = buf.slice(s, e).toString("latin1").toLowerCase();
  const PROBES = ["data/ui/", "/portraits/", "/cards/", "/dead/", "/generals/",
                  "greek","roman","barbarian","carthaginian","eastern","egyptian","nomad",
                  "merc ","temple","barracks","mine","wall","governor","road","queue"];
  const hits = [];
  for (const t of PROBES) {
    let c = 0, idx = 0;
    while ((idx = slice.indexOf(t, idx)) !== -1) { c++; idx += 1; }
    if (c) hits.push(`${t}=${c}`);
  }
  console.log(`  token hits: ${hits.join("  ") || "(none)"}`);

  // First 64 B
  console.log(`  first 64 B hex:`);
  for (let r = 0; r < 4; r++) {
    const base = s + r*16;
    const hx = [], ax = [];
    for (let c = 0; c < 16; c++) { const b = buf[base+c]; hx.push(b.toString(16).padStart(2,"0")); ax.push(b>=0x20&&b<0x7f?String.fromCharCode(b):"."); }
    console.log(`    0x${base.toString(16).padStart(8,"0")}  ${hx.join(" ")}  |${ax.join("")}|`);
  }

  // 32 B before gap
  console.log(`  32 B BEFORE gap:`);
  for (let r = 0; r < 2; r++) {
    const base = s - 32 + r*16;
    const hx = [], ax = [];
    for (let c = 0; c < 16; c++) { const b = buf[base+c]; hx.push(b.toString(16).padStart(2,"0")); ax.push(b>=0x20&&b<0x7f?String.fromCharCode(b):"."); }
    console.log(`    0x${base.toString(16).padStart(8,"0")}  ${hx.join(" ")}  |${ax.join("")}|`);
  }
  // 64 B after gap (catch the next visible record header for context)
  console.log(`  64 B AFTER gap:`);
  for (let r = 0; r < 4; r++) {
    const base = e + r*16;
    const hx = [], ax = [];
    for (let c = 0; c < 16; c++) { const b = buf[base+c]; hx.push(b.toString(16).padStart(2,"0")); ax.push(b>=0x20&&b<0x7f?String.fromCharCode(b):"."); }
    console.log(`    0x${base.toString(16).padStart(8,"0")}  ${hx.join(" ")}  |${ax.join("")}|`);
  }
}

for (const g of GAPS) summarize(g);

// ---- For gap #1: dump structure around the first taw self-pointer pair (size 6 + size ~500)
// to confirm what kind of record it is.
console.log("\n======== gap #1 first taw record dissection ========");
const G1 = GAPS[0];
let firstPair = null;
for (let p = G1.s; p < G1.e - 16; p++) {
  if (buf.readUInt32LE(p) === p) {
    const sz1 = buf.readUInt32LE(p+4);
    if (sz1 === 6) {
      // The next pair should follow at p+8+6 = p+14
      const p2 = p + 14;
      if (buf.readUInt32LE(p2) === p2) {
        const sz2 = buf.readUInt32LE(p2+4);
        if (sz2 > 200 && sz2 < 800) { firstPair = { p, sz1, p2, sz2 }; break; }
      }
    }
  }
}
if (firstPair) {
  const { p, sz1, p2, sz2 } = firstPair;
  console.log(`  outer taw @ 0x${p.toString(16)}  size=${sz1}`);
  console.log(`  inner taw @ 0x${p2.toString(16)}  size=${sz2}`);
  console.log(`  full record 0x${p.toString(16)}..0x${(p2+8+sz2).toString(16)}  total=${(p2+8+sz2)-p} B`);
  // Dump first 96 B of the inner-record payload
  console.log(`  inner payload first 128 B:`);
  for (let r = 0; r < 8; r++) {
    const base = p2 + 8 + r*16;
    const hx = [], ax = [];
    for (let c = 0; c < 16; c++) { const b = buf[base+c]; hx.push(b.toString(16).padStart(2,"0")); ax.push(b>=0x20&&b<0x7f?String.fromCharCode(b):"."); }
    console.log(`    0x${base.toString(16).padStart(8,"0")}  ${hx.join(" ")}  |${ax.join("")}|`);
  }
  // Extract ASCII strings from this single record only
  const recStart = p, recEnd = p2 + 8 + sz2;
  const strs = []; let cur = "", st = -1;
  for (let i = recStart; i < recEnd; i++) {
    const b = buf[i];
    if (b >= 0x20 && b < 0x7f) { if (!cur.length) st = i; cur += String.fromCharCode(b); }
    else { if (cur.length >= 4) strs.push({ off: st, s: cur }); cur = ""; st = -1; }
  }
  if (cur.length >= 4) strs.push({ off: st, s: cur });
  console.log(`  strings in this record: ${strs.length}`);
  for (const x of strs.slice(0, 16)) console.log(`    +${(x.off-recStart).toString().padStart(4)} (${x.s.length}) ${JSON.stringify(x.s)}`);

  // Step through following records to estimate per-record size and count
  let cursor = recEnd;
  let recs = 1;
  const recSizes = [recEnd - recStart];
  while (cursor < G1.e - 16 && recs < 50) {
    // Look for next outer taw of size 6 within 32 B
    let found = -1;
    for (let q = cursor; q < cursor + 64 && q < G1.e - 16; q++) {
      if (buf.readUInt32LE(q) === q && buf.readUInt32LE(q+4) === 6) {
        const q2 = q + 14;
        if (q2 + 8 < G1.e && buf.readUInt32LE(q2) === q2) {
          found = q; break;
        }
      }
    }
    if (found < 0) break;
    const innerOff = found + 14;
    const innerSz = buf.readUInt32LE(innerOff + 4);
    const recE = innerOff + 8 + innerSz;
    recSizes.push(recE - found);
    cursor = recE;
    recs++;
  }
  console.log(`  consecutive records found: ${recs}`);
  console.log(`  record sizes (first 20): ${recSizes.slice(0,20).join(", ")}`);
  const avg = recSizes.reduce((a,b)=>a+b,0) / recSizes.length;
  console.log(`  avg record size: ${avg.toFixed(0)} B  ~ ${(48179 / avg).toFixed(1)} records would fill the gap`);
} else {
  console.log("  no nested taw pair found");
}
