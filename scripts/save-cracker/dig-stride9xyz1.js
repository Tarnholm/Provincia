// dig-stride9xyz1.js — session 98
// Extract stride-9 score-table records and pin what xyz encodes.
//
// Strategy:
//  1. Scan zone [0x14e5ac6, 0x20e6e8e) for stride-9 runs (mirroring cover.js §16).
//  2. Group runs by terminator string ("ptolemai", "egyptian", "psiloi", etc).
//  3. For each group: check xyz overlap across runs.
//  4. Slice xyz into byte fields, examine ranges.
//  5. Compare xyz to djb2/fnv1a/crc32 hashes of unit/culture strings.
//  6. Cross-check NN ordering vs xyz.

const fs = require("fs");
const path = require("path");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const EDU  = "C:/RIS/RIS/data/export_descr_unit.txt";

const Z0 = 0x14e5ac6, Z1 = 0x20e6e8e;

const buf = fs.readFileSync(SAVE);
console.log(`save: ${buf.length} B`);

// ---- detect stride-9 runs (use the §16 detector logic) -------------------
// We approximate "unclaimed runs" by simply walking the zone and finding
// dense aligned stride-9 records. Each run starts at a position where the
// 9-byte pattern conforms and extends until we lose conformance for >50 B
// or hit the terminator (ff ff ff ff + length-prefixed string).

function looksLikeRecord(p) {
  if (p + 9 > buf.length) return false;
  if (buf[p+5] !== 0 || buf[p+6] !== 0 || buf[p+7] !== 0 || buf[p+8] !== 0) return false;
  const nn = buf[p+3];
  if ((nn & 0x0f) !== 0) return false;
  if (nn > 0x80) return false;
  return true;
}

// Locate runs: a "run" is a contiguous block ending at `ff ff ff ff <len> <str>`.
// We scan for the terminator pattern (4×0xff followed by a small length byte and
// printable ASCII) and walk backwards in 9-byte strides to find the run start.

function readTerminator(p) {
  // p points to start of 4-byte 0xff
  if (buf[p] !== 0xff || buf[p+1] !== 0xff || buf[p+2] !== 0xff || buf[p+3] !== 0xff) return null;
  // After ff ff ff ff, expect u16 length-prefix then ASCII string
  if (p + 6 > buf.length) return null;
  const slen = buf.readUInt16LE(p + 4);
  if (slen < 3 || slen > 32) return null;
  if (p + 6 + slen > buf.length) return null;
  let str = "";
  for (let i = 0; i < slen; i++) {
    const c = buf[p+6+i];
    if (c < 0x20 || c > 0x7e) return null;
    str += String.fromCharCode(c);
  }
  return { str, after: p + 6 + slen };
}

// Find all terminators in the zone
const terminators = [];
for (let p = Z0; p + 6 < Z1; p++) {
  const t = readTerminator(p);
  if (t) {
    terminators.push({ pos: p, ...t });
    p = t.after - 1;
  }
}
console.log(`found ${terminators.length} terminator markers in zone`);

// Walk back from each terminator in 9-byte strides while records conform
const runs = [];
for (const t of terminators) {
  // Find the latest position where a 9-byte record DOES NOT conform — that's
  // the run start (after the previous run's terminator string).
  let runStart = t.pos;
  // Walk back: try strides aligned so that runStart..t.pos is k*9
  // Try alignment by stepping back 9 at a time while conforming.
  for (let p = t.pos - 9; p >= Z0; p -= 9) {
    if (looksLikeRecord(p)) {
      runStart = p;
    } else {
      break;
    }
  }
  const recBytes = t.pos - runStart;
  if (recBytes >= 9 && recBytes % 9 === 0) {
    runs.push({ start: runStart, term: t.pos, terminator: t.str, after: t.after, nrec: recBytes / 9 });
  }
}
console.log(`found ${runs.length} runs with valid stride-9 alignment ending at terminator`);

// Group by terminator string
const byTerm = {};
for (const r of runs) {
  if (!byTerm[r.terminator]) byTerm[r.terminator] = [];
  byTerm[r.terminator].push(r);
}
const termHist = Object.entries(byTerm).map(([k,v]) => [k, v.length]).sort((a,b) => b[1]-a[1]);
console.log("\nterminator histogram (top 25):");
for (const [t, n] of termHist.slice(0, 25)) console.log(`  ${t.padEnd(20)} ${n} runs`);

// Pick the most-common terminator that has >=3 runs
let pickTerm = null;
for (const [t, n] of termHist) {
  if (n >= 3) { pickTerm = t; break; }
}
if (!pickTerm) { console.log("no terminator with >=3 runs; abort"); process.exit(0); }

const pickedRuns = byTerm[pickTerm];
console.log(`\n=== Analysis for terminator "${pickTerm}" (${pickedRuns.length} runs) ===`);

// Extract xyz arrays per run
function extractRecords(run) {
  const out = [];
  for (let p = run.start; p < run.term; p += 9) {
    out.push({
      xyz: buf[p] | (buf[p+1] << 8) | (buf[p+2] << 16),
      nn: buf[p+3],
      mm: buf[p+4],
    });
  }
  return out;
}

const runRecs = pickedRuns.map(extractRecords);
for (let i = 0; i < pickedRuns.length && i < 5; i++) {
  console.log(`  run ${i}: start=0x${pickedRuns[i].start.toString(16)} nrec=${runRecs[i].length}  xyz[0..5]=${runRecs[i].slice(0,5).map(r => r.xyz.toString(16)).join(",")}`);
}

// 1. xyz overlap: do runs with same terminator share xyz values?
const xyzSets = runRecs.map(rs => new Set(rs.map(r => r.xyz)));
function intersectSets(s1, s2) {
  const out = new Set();
  for (const v of s1) if (s2.has(v)) out.add(v);
  return out;
}
let cumulative = xyzSets[0];
let cumSize = cumulative.size;
console.log(`\nxyz overlap analysis for "${pickTerm}":`);
console.log(`  run 0: ${xyzSets[0].size} distinct xyz`);
for (let i = 1; i < xyzSets.length; i++) {
  const inter = intersectSets(cumulative, xyzSets[i]);
  console.log(`  run ${i}: ${xyzSets[i].size} distinct, intersect with cumulative = ${inter.size} (${(100*inter.size/Math.min(cumulative.size, xyzSets[i].size)).toFixed(1)}%)`);
  cumulative = inter;
}
console.log(`  shared-across-all xyz: ${cumulative.size} values`);

// 2. byte-split distribution
console.log(`\nxyz byte-split for run 0 (first 20 records):`);
for (const r of runRecs[0].slice(0, 20)) {
  const lo = r.xyz & 0xff;
  const mid = (r.xyz >> 8) & 0xff;
  const hi = (r.xyz >> 16) & 0xff;
  console.log(`  xyz=0x${r.xyz.toString(16).padStart(6,"0")} (=${r.xyz}) lo=${lo} mid=${mid} hi=${hi}  nn=0x${r.nn.toString(16)} mm=0x${r.mm.toString(16)}`);
}

// 3. xyz value ranges
const allXyz = runRecs.flatMap(rs => rs.map(r => r.xyz));
const minX = Math.min(...allXyz);
const maxX = Math.max(...allXyz);
const distinctX = new Set(allXyz);
console.log(`\nxyz range across ${pickedRuns.length} runs: min=${minX} (0x${minX.toString(16)})  max=${maxX} (0x${maxX.toString(16)})  distinct=${distinctX.size} / ${allXyz.length} total`);

// Are xyz values dense in a small range, or scattered across 24-bit space?
let inSmall = 0;
for (const v of allXyz) if (v < 65536) inSmall++;
console.log(`  values < 65536: ${inSmall}/${allXyz.length} (${(100*inSmall/allXyz.length).toFixed(1)}%)`);
let inMed = 0;
for (const v of allXyz) if (v < 0x40000) inMed++;
console.log(`  values < 0x40000 (262144): ${inMed}/${allXyz.length} (${(100*inMed/allXyz.length).toFixed(1)}%)`);

// 4. NN-vs-xyz correlation: is NN a monotone function of xyz within a run?
console.log(`\nNN-vs-xyz correlation per run:`);
for (let i = 0; i < Math.min(5, runRecs.length); i++) {
  const rs = runRecs[i];
  const sorted = [...rs].sort((a,b) => a.xyz - b.xyz);
  // Count NN monotone
  let mono = 0, total = sorted.length - 1;
  for (let j = 1; j < sorted.length; j++) if (sorted[j].nn >= sorted[j-1].nn) mono++;
  console.log(`  run ${i}: ${mono}/${total} (${(100*mono/total).toFixed(1)}%) NN non-decreasing when sorted by xyz`);
  // NN histogram
  const nnHist = {};
  for (const r of rs) nnHist[r.nn] = (nnHist[r.nn] || 0) + 1;
  console.log(`    NN histogram: ${Object.entries(nnHist).map(([k,v])=>`0x${Number(k).toString(16)}:${v}`).join(" ")}`);
}

// 5. Hash test: does xyz match djb2/fnv1a/crc32 of the terminator string truncated to 24 bits?
function djb2(s) { let h = 5381; for (let i=0;i<s.length;i++) h = ((h<<5)+h+s.charCodeAt(i))|0; return h>>>0; }
function fnv1a(s) { let h = 0x811c9dc5; for (let i=0;i<s.length;i++) { h ^= s.charCodeAt(i); h = (h*0x01000193)>>>0; } return h; }

// Maybe xyz hashes the *unit name* line in EDU. Load unit names.
const eduText = fs.readFileSync(EDU, "utf8");
const unitNames = [];
const dictRe = /^dictionary\s+(\S+)/gim;
let m;
while ((m = dictRe.exec(eduText)) !== null) unitNames.push(m[1]);
console.log(`\nloaded ${unitNames.length} unit dictionary names from EDU`);

// Also pull type lines (the recruited internal name)
const typeNames = [];
const typeRe = /^type\s+(.+)$/gim;
while ((m = typeRe.exec(eduText)) !== null) typeNames.push(m[1].trim());
console.log(`loaded ${typeNames.length} unit type names from EDU`);

// 24-bit hashes of all unit names
const hashMap = new Map();
for (const n of [...unitNames, ...typeNames]) {
  hashMap.set(djb2(n) & 0xffffff, { n, h: "djb2" });
  hashMap.set(fnv1a(n) & 0xffffff, { n, h: "fnv1a" });
  hashMap.set(djb2(n.toLowerCase()) & 0xffffff, { n: n.toLowerCase(), h: "djb2-lc" });
  hashMap.set(fnv1a(n.toLowerCase()) & 0xffffff, { n: n.toLowerCase(), h: "fnv1a-lc" });
}
console.log(`built ${hashMap.size} 24-bit hash entries`);

// Match xyz values against hash map
let matches = 0;
const sampleMatches = [];
for (const v of distinctX) {
  if (hashMap.has(v)) {
    matches++;
    if (sampleMatches.length < 10) sampleMatches.push({ xyz: v, ...hashMap.get(v) });
  }
}
console.log(`xyz hash matches: ${matches}/${distinctX.size} distinct xyz values`);
if (sampleMatches.length) {
  console.log("  sample matches:");
  for (const sm of sampleMatches) console.log(`    xyz=0x${sm.xyz.toString(16)} -> "${sm.n}" (${sm.h})`);
}

// 6. Within a single run: how many records per "tier" (NN value)?
// If 254 records per range and 8 tiers, do we see ~32/tier (~uniform) or skewed?
console.log(`\nRecord count per range (first 10 runs): ${runRecs.slice(0,10).map(r => r.length).join(", ")}`);
const lenHist = {};
for (const rs of runRecs) lenHist[rs.length] = (lenHist[rs.length]||0)+1;
console.log(`run-length histogram: ${Object.entries(lenHist).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v])=>`${k}:${v}`).join(" ")}`);
