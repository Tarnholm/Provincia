// dig-stride9xyz2.js — session 98 attempt 2
// Two fixes vs attempt 1:
//  - Use a more permissive terminator scan: look for ff ff ff ff anywhere,
//    then scan forward for printable ASCII to capture the next "label" word.
//  - Reuse the §16 detector logic directly to find runs (alignment scan),
//    then walk forward to identify the terminating string.

const fs = require("fs");
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const EDU  = "C:/RIS/RIS/data/export_descr_unit.txt";

const Z0 = 0x14e5ac6, Z1 = 0x20e6e8e;
const buf = fs.readFileSync(SAVE);
console.log(`save: ${buf.length} B; scanning zone [0x${Z0.toString(16)}..0x${Z1.toString(16)})`);

// Locate stride-9 runs: scan for FF FF FF FF (4-byte sentinel), then walk back
// in 9-byte strides while records conform. Capture the string that follows.

function looksLikeRecord(p) {
  if (p + 9 > buf.length) return false;
  if (buf[p+5] !== 0 || buf[p+6] !== 0 || buf[p+7] !== 0 || buf[p+8] !== 0) return false;
  const nn = buf[p+3];
  if ((nn & 0x0f) !== 0) return false;
  if (nn > 0x80) return false;
  return true;
}

function readStringAfter(p) {
  // After 4×0xff, scan up to 64 bytes for a printable-ASCII run of length >=3.
  // The layout could be `ff ff ff ff <len:u32_le> <chars>` or `ff ff ff ff <chars>`
  // or with a u16 length. Try the formats.
  // Format A: u32 length-prefix
  if (p + 8 <= buf.length) {
    const l32 = buf.readUInt32LE(p + 4);
    if (l32 >= 3 && l32 <= 32 && p + 8 + l32 <= buf.length) {
      let s = "";
      let ok = true;
      for (let i = 0; i < l32; i++) {
        const c = buf[p+8+i];
        if (c < 0x20 || c > 0x7e) { ok = false; break; }
        s += String.fromCharCode(c);
      }
      if (ok) return { str: s, len: l32, fmt: "u32", end: p+8+l32 };
    }
  }
  // Format B: u16 length-prefix
  if (p + 6 <= buf.length) {
    const l16 = buf.readUInt16LE(p + 4);
    if (l16 >= 3 && l16 <= 32 && p + 6 + l16 <= buf.length) {
      let s = "";
      let ok = true;
      for (let i = 0; i < l16; i++) {
        const c = buf[p+6+i];
        if (c < 0x20 || c > 0x7e) { ok = false; break; }
        s += String.fromCharCode(c);
      }
      if (ok) return { str: s, len: l16, fmt: "u16", end: p+6+l16 };
    }
  }
  // Format C: raw printable ASCII directly after ff ff ff ff
  let s = "";
  for (let i = 4; i < 32 && p+i < buf.length; i++) {
    const c = buf[p+i];
    if (c >= 0x20 && c <= 0x7e) s += String.fromCharCode(c);
    else break;
  }
  if (s.length >= 3) return { str: s, len: s.length, fmt: "raw", end: p+4+s.length };
  return null;
}

// Find all FFx4 sentinels
const sentinels = [];
for (let p = Z0; p + 4 < Z1; p++) {
  if (buf[p]===0xff && buf[p+1]===0xff && buf[p+2]===0xff && buf[p+3]===0xff) {
    // Skip if part of a longer FF run (this would be filler not a terminator)
    // i.e. require byte at p-1 != ff and byte at p+4 != ff sometimes... but
    // actually some terminators may abut filler. Just record all and dedupe.
    sentinels.push(p);
    p += 3; // skip ahead
  }
}
console.log(`found ${sentinels.length} FFx4 sentinels in zone`);

// For each sentinel, capture trailing label (try the 3 formats), and walk back
// for stride-9 runs.
const runs = [];
for (const sp of sentinels) {
  const lab = readStringAfter(sp);
  if (!lab) continue;
  // Walk back from sp in 9-byte strides
  let runStart = sp;
  for (let p = sp - 9; p >= Z0; p -= 9) {
    if (looksLikeRecord(p)) {
      runStart = p;
    } else {
      break;
    }
  }
  const nrec = (sp - runStart) / 9;
  if (nrec >= 5 && Number.isInteger(nrec)) {
    runs.push({ start: runStart, term: sp, nrec, lab: lab.str, labFmt: lab.fmt });
  }
}
console.log(`found ${runs.length} runs with stride-9 alignment + readable trailing label`);

// Print label histogram
const byTerm = {};
for (const r of runs) {
  if (!byTerm[r.lab]) byTerm[r.lab] = [];
  byTerm[r.lab].push(r);
}
const termHist = Object.entries(byTerm).map(([k,v]) => [k, v.length]).sort((a,b) => b[1]-a[1]);
console.log("\ntrailing-label histogram (top 25):");
for (const [t, n] of termHist.slice(0, 25)) console.log(`  "${t}".padEnd(30) ${n} runs`);

// Pick the most-common label that has >=3 runs and >=20 records per run
let pickTerm = null;
for (const [t, n] of termHist) {
  if (n >= 3) {
    const goodRuns = byTerm[t].filter(r => r.nrec >= 20);
    if (goodRuns.length >= 3) { pickTerm = t; break; }
  }
}
if (!pickTerm) {
  console.log("no label with >=3 runs of >=20 records; using top label anyway");
  pickTerm = termHist[0][0];
}

const pickedRuns = byTerm[pickTerm].filter(r => r.nrec >= 10).slice(0, 50);
console.log(`\n=== Analysis for label "${pickTerm}" — using ${pickedRuns.length} runs (nrec>=10) ===`);

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
console.log(`run sizes: ${runRecs.map(r => r.length).join(", ")}`);

// xyz overlap analysis
const xyzSets = runRecs.map(rs => new Set(rs.map(r => r.xyz)));
// Pairwise overlap
console.log(`\nxyz pairwise overlap (first 5x5 runs):`);
const N = Math.min(5, xyzSets.length);
let line = "      ";
for (let j = 0; j < N; j++) line += `r${j}`.padStart(7);
console.log(line);
for (let i = 0; i < N; i++) {
  let row = `r${i}    `;
  for (let j = 0; j < N; j++) {
    if (j === i) row += "    -- ";
    else {
      let inter = 0;
      for (const v of xyzSets[i]) if (xyzSets[j].has(v)) inter++;
      const denom = Math.min(xyzSets[i].size, xyzSets[j].size);
      row += `${(100*inter/denom).toFixed(0)}%`.padStart(7);
    }
  }
  console.log(row);
}

// Union and intersection
let union = new Set();
for (const s of xyzSets) for (const v of s) union.add(v);
let inter = new Set(xyzSets[0]);
for (let i = 1; i < xyzSets.length; i++) {
  const tmp = new Set();
  for (const v of inter) if (xyzSets[i].has(v)) tmp.add(v);
  inter = tmp;
}
console.log(`\nUnion across ${pickedRuns.length} runs: ${union.size} distinct xyz`);
console.log(`Intersection across all: ${inter.size} distinct xyz`);

// Are values dense in low ranges (suggesting an index)?
const allXyz = [...union];
allXyz.sort((a,b)=>a-b);
console.log(`\nxyz range: min=${allXyz[0]} (0x${allXyz[0].toString(16)}) max=${allXyz[allXyz.length-1]} (0x${allXyz[allXyz.length-1].toString(16)})`);
console.log(`distinct count: ${allXyz.length}`);
console.log(`< 256: ${allXyz.filter(v=>v<256).length}; <1024: ${allXyz.filter(v=>v<1024).length}; <65536: ${allXyz.filter(v=>v<65536).length}; <262144: ${allXyz.filter(v=>v<262144).length}`);
console.log(`first 30 sorted: ${allXyz.slice(0, 30).map(v=>v.toString(16)).join(",")}`);
console.log(`last 10 sorted: ${allXyz.slice(-10).map(v=>v.toString(16)).join(",")}`);

// Byte-split distribution
const loVals = new Set(), midVals = new Set(), hiVals = new Set();
for (const v of allXyz) {
  loVals.add(v & 0xff);
  midVals.add((v >> 8) & 0xff);
  hiVals.add((v >> 16) & 0xff);
}
console.log(`\nbyte-split distinct: lo=${loVals.size}, mid=${midVals.size}, hi=${hiVals.size}`);
console.log(`hi values: ${[...hiVals].sort((a,b)=>a-b).join(",")}`);

// First-run sample
console.log(`\nrun 0 first 30 records:`);
for (const r of runRecs[0].slice(0, 30)) {
  console.log(`  xyz=0x${r.xyz.toString(16).padStart(6,"0")} (${r.xyz.toString().padStart(7)}) nn=0x${r.nn.toString(16).padStart(2,"0")} mm=0x${r.mm.toString(16).padStart(2,"0")}`);
}

// NN value pattern within a run
console.log(`\nNN ordering within run 0 (first 50 records):`);
const r0 = runRecs[0];
console.log(`  NN sequence: ${r0.slice(0,50).map(r=>"0x"+r.nn.toString(16)).join(",")}`);
// Is NN sorted descending (rank order)?
let descending = 0;
for (let i = 1; i < r0.length; i++) if (r0[i].nn <= r0[i-1].nn) descending++;
console.log(`  NN non-increasing in file order: ${descending}/${r0.length-1} (${(100*descending/(r0.length-1)).toFixed(1)}%)`);

// Hash test
function djb2(s){let h=5381;for(let i=0;i<s.length;i++)h=((h<<5)+h+s.charCodeAt(i))|0;return h>>>0;}
function fnv1a(s){let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=(h*0x01000193)>>>0;}return h;}

let eduText = "";
try { eduText = fs.readFileSync(EDU, "utf8"); } catch(e) { console.log("EDU read failed:", e.message); }
const unitNames = new Set();
if (eduText) {
  const re = /^type\s+(.+)$/gim;
  let mm;
  while ((mm = re.exec(eduText)) !== null) unitNames.add(mm[1].trim().toLowerCase());
  const re2 = /^dictionary\s+(\S+)/gim;
  while ((mm = re2.exec(eduText)) !== null) unitNames.add(mm[1].trim().toLowerCase());
}
console.log(`\nloaded ${unitNames.size} EDU unit/dict names`);

// Faction names (descr_sm_factions or similar; use a hardcoded list)
const factions = ["romans_julii","romans_brutii","romans_scipii","romans_senate","egypt","seleucid","carthage","parthia","gaul","germans","britons","greek_cities","macedon","pontus","armenia","dacia","numidia","scythia","spain","thrace","slave","rebels","ptolemaic","antigonid","epirus","sparta","athens","achaea","bactria","mauryan","kush","saba","arevaci","vettones","lusitani","getae","getai","massyli","masaesyli","numidians","odrysai","illyrians","boii","arverni","aedui","helvetii","suebi","cimbri","scordisci","celtiberian","insubres","sarmatians","sauromatae","massagetae","bosporan","colchis","pergamon","cappadocia","cilicia","crete","cyrene","libyans","garamantia","saka","albania","atropatene","sogdia","areia","tribes_dahae"];

// Build 24-bit hash map of names
const hash24 = new Map();
for (const n of unitNames) {
  hash24.set(djb2(n) & 0xffffff, { n, h: "djb2" });
  hash24.set(fnv1a(n) & 0xffffff, { n, h: "fnv1a" });
}
for (const n of factions) {
  hash24.set(djb2(n) & 0xffffff, { n, h: "djb2-fac" });
  hash24.set(fnv1a(n) & 0xffffff, { n, h: "fnv1a-fac" });
}
console.log(`built ${hash24.size} 24-bit hash entries`);

let matches = 0;
const sample = [];
for (const v of union) {
  if (hash24.has(v)) {
    matches++;
    if (sample.length < 15) sample.push({ xyz: v, ...hash24.get(v) });
  }
}
console.log(`\nxyz vs hash matches: ${matches}/${union.size} (${(100*matches/union.size).toFixed(1)}%) — random would be ~${(100*hash24.size/0x1000000).toFixed(2)}%`);
for (const s of sample) console.log(`  xyz=0x${s.xyz.toString(16)} -> "${s.n}" (${s.h})`);

// MM histogram across all picked runs
const mmHist = {};
for (const rs of runRecs) for (const r of rs) mmHist[r.mm] = (mmHist[r.mm]||0)+1;
console.log(`\nMM histogram across picked runs: ${Object.entries(mmHist).map(([k,v])=>`0x${Number(k).toString(16)}:${v}`).join(" ")}`);

// MM=0 vs MM=4 ranges: report separately. Does any MM=4 run terminate with the picked label?
const mm4Runs = runs.filter(r => {
  for (let p = r.start; p < r.term; p += 9) if (buf[p+4] === 4) return true;
  return false;
});
console.log(`\nruns containing any MM=4 record: ${mm4Runs.length}/${runs.length}`);

// Spread of MM per run (within-run constancy)
let constMM = 0, mixMM = 0;
for (const rs of runRecs) {
  const mms = new Set(rs.map(r=>r.mm));
  if (mms.size === 1) constMM++; else mixMM++;
}
console.log(`runs with constant MM: ${constMM}; with mixed MM: ${mixMM}`);

// Save all-runs summary
const allRunRecs = runs.map(extractRecords);
console.log(`\n--- All ${runs.length} runs combined ---`);
const allUnion = new Set();
for (const rs of allRunRecs) for (const r of rs) allUnion.add(r.xyz);
console.log(`global distinct xyz across all runs: ${allUnion.size}`);
console.log(`avg records/run: ${(runs.reduce((s,r)=>s+r.nrec,0)/runs.length).toFixed(1)}; total records: ${runs.reduce((s,r)=>s+r.nrec,0)}`);

// Save out
fs.writeFileSync("C:/dev/Provincia/scripts/save-cracker/out-stride9xyz-summary.json", JSON.stringify({
  picked: pickTerm,
  runsForPicked: pickedRuns.length,
  unionPicked: union.size,
  interPicked: inter.size,
  hashMatches: matches,
  totalRuns: runs.length,
  globalDistinct: allUnion.size,
  termHistTop: termHist.slice(0,30),
}, null, 2));
console.log("wrote out-stride9xyz-summary.json");
