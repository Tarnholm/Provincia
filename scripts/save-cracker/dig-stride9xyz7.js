// dig-stride9xyz7.js — FINAL attempt. Skip the "same terminator" grouping
// (failed because runs are bitmap-carved, not string-anchored). Instead:
//  1. Scan the full AI zone for ANY 9-byte position where the rigid pattern
//     `XX YY ZZ NN MM 00 00 00 00` holds (NN low nibble 0, NN<=0x80).
//  2. Treat all such positions as "stride-9 records".
//  3. Analyze the GLOBAL xyz distribution: byte split, density, hash match,
//     position-within-run patterns, and adjacency patterns.

const fs = require("fs");
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const EDU  = "C:/RIS/RIS/data/export_descr_unit.txt";

const Z0 = 0x14e5ac6, Z1 = 0x20e6e8e;
const buf = fs.readFileSync(SAVE);

// Use cover.js §16-style detector to find runs and their alignments.
// But here, simpler: scan for stride-9 conformance density windowed.

function isRec(p) {
  return buf[p+5]===0 && buf[p+6]===0 && buf[p+7]===0 && buf[p+8]===0 &&
         (buf[p+3] & 0x0f)===0 && buf[p+3] <= 0x80;
}

// For each starting offset 0..8, score conformance density across the zone.
// Then collect records using the GLOBAL best alignment over a sliding window
// approach — within each "dense conformance" region, walk in stride-9 steps.

// Simpler: collect ALL stride-9 records (any alignment) ANYWHERE in the zone
// where 9 consecutive positions p..p+8 conform AND p-9 also conforms — i.e.
// the record is part of a chain of >=2 conforming records.

const records = []; // { off, xyz, nn, mm }
let prevHit = -100;
for (let p = Z0; p + 9 <= Z1; p++) {
  if (isRec(p) && isRec(p+9)) {
    // Both this position and the next-9 position conform — accept this record.
    if (prevHit !== p - 9) {
      // start of a new chain
    }
    records.push({ off: p, xyz: buf[p] | (buf[p+1]<<8) | (buf[p+2]<<16), nn: buf[p+3], mm: buf[p+4] });
    prevHit = p;
    // Advance to next stride-9 record without re-scanning
    p += 8; // for-loop increments to p+9
  }
}
console.log(`collected ${records.length} chained stride-9 records in zone`);

// Group into runs by contiguity (consecutive offsets diff == 9)
const runs = [];
let cur = [];
for (let i = 0; i < records.length; i++) {
  if (cur.length === 0 || records[i].off === cur[cur.length-1].off + 9) {
    cur.push(records[i]);
  } else {
    if (cur.length >= 5) runs.push(cur);
    cur = [records[i]];
  }
}
if (cur.length >= 5) runs.push(cur);
console.log(`${runs.length} runs of >=5 chained records`);
console.log(`run-length stats: min=${Math.min(...runs.map(r=>r.length))} max=${Math.max(...runs.map(r=>r.length))} median=${runs.map(r=>r.length).sort((a,b)=>a-b)[Math.floor(runs.length/2)]}`);

const lenHist = {};
for (const r of runs) lenHist[r.length] = (lenHist[r.length]||0)+1;
const topLens = Object.entries(lenHist).sort((a,b)=>b[1]-a[1]).slice(0,10);
console.log(`top run-lengths (count of runs at this size): ${topLens.map(([k,v])=>`${k}:${v}`).join(", ")}`);

// Total records inside accepted runs
const totalRecs = runs.reduce((s,r)=>s+r.length,0);
console.log(`total records across runs: ${totalRecs}`);

// Histogram of MM by run-type
const mmRuns = {};
for (const r of runs) {
  const mmHist = {};
  for (const rec of r) mmHist[rec.mm] = (mmHist[rec.mm]||0)+1;
  const dominant = Object.entries(mmHist).sort((a,b)=>b[1]-a[1])[0][0];
  mmRuns[dominant] = (mmRuns[dominant]||0)+1;
}
console.log(`run count by dominant MM: ${JSON.stringify(mmRuns)}`);

// ALL xyz: global distinct
const allXyz = new Set();
for (const r of runs) for (const rec of r) allXyz.add(rec.xyz);
console.log(`\nglobal distinct xyz across all runs: ${allXyz.size}`);

const sortedX = [...allXyz].sort((a,b)=>a-b);
console.log(`xyz range: ${sortedX[0]} (0x${sortedX[0].toString(16)}) .. ${sortedX[sortedX.length-1]} (0x${sortedX[sortedX.length-1].toString(16)})`);
console.log(`distribution: <256:${sortedX.filter(v=>v<256).length} <1024:${sortedX.filter(v=>v<1024).length} <4096:${sortedX.filter(v=>v<4096).length} <16384:${sortedX.filter(v=>v<16384).length} <65536:${sortedX.filter(v=>v<65536).length} <0x40000:${sortedX.filter(v=>v<0x40000).length}`);

// Byte split
const hi = new Set(), mid = new Set(), lo = new Set();
for (const v of allXyz) { lo.add(v&0xff); mid.add((v>>8)&0xff); hi.add((v>>16)&0xff); }
console.log(`byte-split distinct: lo=${lo.size}, mid=${mid.size}, hi=${hi.size}`);
console.log(`HI values present: ${[...hi].sort((a,b)=>a-b).slice(0,40).join(",")}`);
console.log(`MID values present (first 30): ${[...mid].sort((a,b)=>a-b).slice(0,30).join(",")}`);
console.log(`LO values present (first 30): ${[...lo].sort((a,b)=>a-b).slice(0,30).join(",")}`);

// Histograms
const hiHist = {}, midHist = {}, loHist = {};
for (const r of runs) for (const rec of r) {
  hiHist[(rec.xyz>>16)&0xff] = (hiHist[(rec.xyz>>16)&0xff]||0)+1;
  midHist[(rec.xyz>>8)&0xff] = (midHist[(rec.xyz>>8)&0xff]||0)+1;
  loHist[rec.xyz&0xff] = (loHist[rec.xyz&0xff]||0)+1;
}
console.log(`\nHI hist (top 10): ${Object.entries(hiHist).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v])=>`${k}:${v}`).join(" ")}`);
console.log(`MID hist (top 10): ${Object.entries(midHist).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v])=>`${k}:${v}`).join(" ")}`);
console.log(`LO hist (top 10): ${Object.entries(loHist).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v])=>`${k}:${v}`).join(" ")}`);

// Within MM=0 runs vs MM=4 runs, compare xyz ranges
const mm0Runs = runs.filter(r => {
  const mm = {};
  for (const x of r) mm[x.mm] = (mm[x.mm]||0)+1;
  return Object.entries(mm).sort((a,b)=>b[1]-a[1])[0][0] === "0";
});
const mm4Runs = runs.filter(r => {
  const mm = {};
  for (const x of r) mm[x.mm] = (mm[x.mm]||0)+1;
  return Object.entries(mm).sort((a,b)=>b[1]-a[1])[0][0] === "4";
});
console.log(`\nMM=0 runs: ${mm0Runs.length}, MM=4 runs: ${mm4Runs.length}`);

const mm0Xyz = new Set(); for (const r of mm0Runs) for (const x of r) mm0Xyz.add(x.xyz);
const mm4Xyz = new Set(); for (const r of mm4Runs) for (const x of r) mm4Xyz.add(x.xyz);
console.log(`MM=0 distinct xyz: ${mm0Xyz.size}; MM=4 distinct xyz: ${mm4Xyz.size}`);
let overlapMM = 0;
for (const v of mm0Xyz) if (mm4Xyz.has(v)) overlapMM++;
console.log(`MM=0/MM=4 xyz overlap: ${overlapMM} (${(100*overlapMM/Math.min(mm0Xyz.size,mm4Xyz.size)).toFixed(1)}% of smaller set)`);

// MM=4 xyz analysis (region-keyed): range
const mm4sorted = [...mm4Xyz].sort((a,b)=>a-b);
console.log(`MM=4 xyz range: ${mm4sorted[0]} .. ${mm4sorted[mm4sorted.length-1]}`);
console.log(`MM=4 <1024:${mm4sorted.filter(v=>v<1024).length} <4096:${mm4sorted.filter(v=>v<4096).length}`);
const mm4Hi = new Set(), mm4Mid = new Set(), mm4Lo = new Set();
for (const v of mm4Xyz) { mm4Lo.add(v&0xff); mm4Mid.add((v>>8)&0xff); mm4Hi.add((v>>16)&0xff); }
console.log(`MM=4 byte-split distinct: lo=${mm4Lo.size}, mid=${mm4Mid.size}, hi=${mm4Hi.size}`);

// Hash test on EDU names
const eduText = fs.readFileSync(EDU, "utf8");
const typeNames = new Set();
const dictNames = new Set();
for (const l of eduText.split(/\r?\n/)) {
  let m;
  if ((m = l.match(/^\s*type\s+(.+?)\s*$/i))) typeNames.add(m[1]);
  if ((m = l.match(/^\s*dictionary\s+(\S+)/i))) dictNames.add(m[1]);
}
function djb2(s){let h=5381;for(let i=0;i<s.length;i++)h=((h<<5)+h+s.charCodeAt(i))|0;return h>>>0;}
function fnv1a(s){let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=(h*0x01000193)>>>0;}return h;}
function crc32(s) {
  // Simple table-based CRC32
  if (!crc32.t) {
    crc32.t = new Uint32Array(256);
    for (let i=0;i<256;i++) { let c=i; for(let k=0;k<8;k++) c = (c&1) ? (0xedb88320 ^ (c>>>1)) : (c>>>1); crc32.t[i]=c>>>0; }
  }
  let c = 0xffffffff;
  for (let i=0;i<s.length;i++) c = crc32.t[(c ^ s.charCodeAt(i)) & 0xff] ^ (c>>>8);
  return (c ^ 0xffffffff) >>> 0;
}

const allNames = [...typeNames, ...dictNames];
const hash24 = new Map();
for (const n of allNames) {
  for (const variant of [n, n.toLowerCase(), n.replace(/\s+/g,"_"), n.toLowerCase().replace(/\s+/g,"_")]) {
    hash24.set(djb2(variant) & 0xffffff, { n: variant, h: "djb2" });
    hash24.set(fnv1a(variant) & 0xffffff, { n: variant, h: "fnv1a" });
    hash24.set(crc32(variant) & 0xffffff, { n: variant, h: "crc32" });
  }
}
console.log(`\nbuilt ${hash24.size} 24-bit hash entries from ${allNames.length} EDU names`);
let hashMatches = 0;
const sample = [];
for (const v of allXyz) if (hash24.has(v)) { hashMatches++; if (sample.length<15) sample.push({xyz:v, ...hash24.get(v)}); }
console.log(`xyz vs hash(EDU names): ${hashMatches}/${allXyz.size} (${(100*hashMatches/allXyz.size).toFixed(2)}%)`);
console.log(`expected random match: ${(100*hash24.size/0x1000000).toFixed(2)}%`);
for (const s of sample) console.log(`  xyz=0x${s.xyz.toString(16)} -> "${s.n}" (${s.h})`);

// Faction names — load from descr_sm_factions
let smfText = "";
try { smfText = fs.readFileSync("C:/RIS/RIS/data/descr_sm_factions.txt", "utf8"); } catch(e){}
const factionNames = new Set();
for (const l of smfText.split(/\r?\n/)) {
  const m = l.match(/^\s*faction\s+(\S+)/i);
  if (m) factionNames.add(m[1].toLowerCase());
}
console.log(`\nloaded ${factionNames.size} faction names`);

const fhash = new Map();
for (const n of factionNames) {
  fhash.set(djb2(n) & 0xffffff, n);
  fhash.set(fnv1a(n) & 0xffffff, n);
  fhash.set(crc32(n) & 0xffffff, n);
}
let fMatches = 0;
const fSample = [];
for (const v of allXyz) if (fhash.has(v)) { fMatches++; if (fSample.length<10) fSample.push({xyz:v, n:fhash.get(v)}); }
console.log(`xyz vs faction-hash: ${fMatches}/${allXyz.size} (random expected ~${(100*fhash.size/0x1000000).toFixed(2)}%)`);
for (const s of fSample) console.log(`  xyz=0x${s.xyz.toString(16)} -> "${s.n}"`);

// Position-within-run analysis: are xyz values at same position constant
// across runs of similar shape?
const lenGroups = {};
for (const r of runs) {
  if (!lenGroups[r.length]) lenGroups[r.length] = [];
  lenGroups[r.length].push(r);
}
const topLenGroups = Object.entries(lenGroups).sort((a,b)=>b[1].length-a[1].length).slice(0,3);
console.log(`\ntop run-length groups:`);
for (const [len, group] of topLenGroups) {
  console.log(`  length=${len}: ${group.length} runs`);
  // Position-wise consistency
  if (group.length >= 3) {
    let constPos = 0;
    const L = Number(len);
    for (let pos = 0; pos < L; pos++) {
      const vals = new Set(group.map(r => r[pos].xyz));
      if (vals.size === 1) constPos++;
    }
    console.log(`    positions where xyz is identical across all ${group.length} runs of this length: ${constPos}/${L}`);
    // Modal xyz at first 5 positions
    for (let pos = 0; pos < Math.min(5, L); pos++) {
      const cnts = {};
      for (const r of group) cnts[r[pos].xyz] = (cnts[r[pos].xyz]||0)+1;
      const top = Object.entries(cnts).sort((a,b)=>b[1]-a[1]).slice(0,3);
      console.log(`    pos ${pos}: top-3 modal xyz: ${top.map(([k,v])=>`0x${Number(k).toString(16)}:${v}`).join(" ")}`);
    }
  }
}

// NN distribution per run
console.log(`\nNN distribution (global): ${Object.entries(records.reduce((a,r)=>{a[r.nn]=(a[r.nn]||0)+1;return a;},{})).sort((a,b)=>Number(a[0])-Number(b[0])).map(([k,v])=>`0x${Number(k).toString(16)}:${v}`).join(" ")}`);

// Within MM=0 runs, check NN ordering pattern
let monotone = 0, totalCheck = 0;
for (const r of mm0Runs) {
  for (let i = 1; i < r.length; i++) {
    totalCheck++;
    if (r[i].nn >= r[i-1].nn) monotone++;
  }
}
console.log(`MM=0 NN non-decreasing in file-order: ${monotone}/${totalCheck} (${(100*monotone/totalCheck).toFixed(1)}%)`);

// Within MM=0 runs, check sorted-by-xyz NN monotone
let sortedMono = 0, sortedTotal = 0;
for (const r of mm0Runs) {
  const s = [...r].sort((a,b)=>a.xyz-b.xyz);
  for (let i = 1; i < s.length; i++) {
    sortedTotal++;
    if (s[i].nn >= s[i-1].nn) sortedMono++;
  }
}
console.log(`MM=0 NN non-decreasing when sorted by xyz: ${sortedMono}/${sortedTotal} (${(100*sortedMono/sortedTotal).toFixed(1)}%)`);

// === KEY TEST: cross-reference xyz values to settlement and unit-record offsets
// at the start of the save (pre-AI-zone). If xyz < 0x40000, maybe it's an
// offset into a body section? Save first MB has ~1M bytes; xyz could be a
// file offset.
const xyzInBodyRange = sortedX.filter(v => v >= 0x1000 && v < 0x100000);
console.log(`\nxyz values in [0x1000, 0x100000): ${xyzInBodyRange.length} (these could be file offsets into pre-AI body)`);

// Sample xyz: do these point to anything reasonable in the file?
console.log(`\nSample 'could-be-offset' xyz values and what's at that file offset:`);
for (const v of xyzInBodyRange.slice(0, 5)) {
  if (v + 16 < buf.length) {
    const b = buf.slice(v, v+16);
    let ascii = "";
    for (const c of b) ascii += (c >= 0x20 && c <= 0x7e) ? String.fromCharCode(c) : ".";
    console.log(`  xyz=0x${v.toString(16)} (${v}) -> bytes: ${[...b].map(c=>c.toString(16).padStart(2,"0")).join(" ")}  ASCII: ${ascii}`);
  }
}

// === KEY TEST: is xyz a settlement-region index?
// RTW has 1310 regions (per regions_large.json). MM=4 runs (region-keyed)
// should have xyz in [0, 1310) range.
console.log(`\n=== Region-index test for MM=4 runs ===`);
console.log(`max region count typically ~1310. MM=4 xyz <1310: ${mm4sorted.filter(v=>v<1310).length}/${mm4sorted.length}`);
console.log(`MM=4 xyz <2048: ${mm4sorted.filter(v=>v<2048).length}/${mm4sorted.length}`);
console.log(`MM=4 xyz distinct count: ${mm4Xyz.size}; first 30 sorted: ${mm4sorted.slice(0,30).join(",")}; last 10: ${mm4sorted.slice(-10).join(",")}`);

// MM=0 xyz: is it bounded by EDU unit count (~1672)?
const mm0sorted = [...mm0Xyz].sort((a,b)=>a-b);
console.log(`\n=== Unit-index test for MM=0 runs ===`);
console.log(`EDU unit count: ${typeNames.size}; MM=0 xyz <typeCount: ${mm0sorted.filter(v=>v<typeNames.size).length}/${mm0sorted.length}`);
console.log(`MM=0 xyz <2048: ${mm0sorted.filter(v=>v<2048).length}/${mm0sorted.length}`);
console.log(`MM=0 xyz <0x10000: ${mm0sorted.filter(v=>v<0x10000).length}/${mm0sorted.length}`);
console.log(`MM=0 xyz max: ${mm0sorted[mm0sorted.length-1]} (0x${mm0sorted[mm0sorted.length-1].toString(16)})`);
console.log(`MM=0 xyz first 30 sorted: ${mm0sorted.slice(0,30).join(",")}`);
console.log(`MM=0 xyz LAST 30 sorted: ${mm0sorted.slice(-30).join(",")}`);

// What's the MEAN xyz per run? If runs are per-faction tables, maybe the
// mean xyz tells us something about which faction.
console.log(`\nMM=0 runs — mean-xyz first 20 runs: ${mm0Runs.slice(0,20).map(r=>{const m=r.reduce((s,x)=>s+x.xyz,0)/r.length;return Math.round(m);}).join(", ")}`);

// Save out
fs.writeFileSync("C:/dev/Provincia/scripts/save-cracker/out-stride9xyz-final.json", JSON.stringify({
  totalRuns: runs.length,
  totalRecords: totalRecs,
  globalDistinctXyz: allXyz.size,
  globalXyzRange: [sortedX[0], sortedX[sortedX.length-1]],
  byteSplit: { lo: lo.size, mid: mid.size, hi: hi.size },
  mm0Runs: mm0Runs.length, mm4Runs: mm4Runs.length,
  mm0Xyz: mm0Xyz.size, mm4Xyz: mm4Xyz.size, mmOverlap: overlapMM,
  hashMatches, hashEntries: hash24.size,
  fHashMatches: fMatches,
  topLens,
}, null, 2));
console.log("\nwrote out-stride9xyz-final.json");
