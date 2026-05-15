// dig-stride9xyz4.js — session 98 attempt 2
// Find stride-9 score-table runs by locating their *trailing unit-name string*.
// The string format is `<u16 len> <ascii>` preceded by 4-byte 0xff terminator.
// Then walk backward in 9-byte strides while records conform.

const fs = require("fs");
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const EDU  = "C:/RIS/RIS/data/export_descr_unit.txt";

const Z0 = 0x14e5ac6, Z1 = 0x20e6e8e;
const buf = fs.readFileSync(SAVE);

// Load EDU unit type and dictionary names
const eduText = fs.readFileSync(EDU, "utf8");
const typeNames = new Set();
const dictNames = new Set();
{
  const lines = eduText.split(/\r?\n/);
  for (const l of lines) {
    const m1 = l.match(/^\s*type\s+(.+?)\s*$/i);
    if (m1) typeNames.add(m1[1].trim());
    const m2 = l.match(/^\s*dictionary\s+(\S+)/i);
    if (m2) dictNames.add(m2[1].trim());
  }
}
console.log(`EDU: ${typeNames.size} type names, ${dictNames.size} dictionary names`);

// Scan zone for `<u16 len><ascii>` length-prefixed strings matching any EDU
// type name, where the preceding 4 bytes are 0xff (terminator).
// Format: ff ff ff ff [maybe filler] <u16 len> <ascii string>
//   BUT context shows the filler can be variable (ef 00 00 00 etc).
//   Better: just locate strings whose name matches EDU, then walk back.

const allTypes = [...typeNames];
allTypes.sort((a,b) => b.length - a.length);

const stringHits = [];
let p = Z0;
while (p < Z1 - 2) {
  const slen = buf.readUInt16LE(p);
  if (slen >= 4 && slen <= 64 && p + 2 + slen <= Z1) {
    // String body is the first slen-1 bytes (printable ASCII), followed by
    // a NUL terminator byte. slen = len-of-c-string-including-NUL.
    let ok = true;
    for (let i = 0; i < slen - 1; i++) {
      const c = buf[p+2+i];
      if (c < 0x20 || c > 0x7e) { ok = false; break; }
    }
    if (ok && buf[p+2+slen-1] === 0) {
      const s = buf.slice(p+2, p+2+slen-1).toString("ascii");
      if (typeNames.has(s)) {
        stringHits.push({ pos: p, str: s, end: p+2+slen });
        p += 2 + slen;
        continue;
      }
    }
  }
  p++;
}
console.log(`found ${stringHits.length} EDU-unit-name strings in zone`);

if (stringHits.length === 0) {
  console.log("FATAL: no EDU strings found, abort");
  process.exit(0);
}

// Histogram by string
const byStr = {};
for (const h of stringHits) {
  if (!byStr[h.str]) byStr[h.str] = [];
  byStr[h.str].push(h);
}
const strHist = Object.entries(byStr).map(([k,v])=>[k,v.length]).sort((a,b)=>b[1]-a[1]);
console.log(`\nstring histogram (top 30):`);
for (const [s,n] of strHist.slice(0,30)) console.log(`  "${s}" : ${n}`);

// For each string hit, walk back to find the run of stride-9 records.
// A run is identified by: scan backwards 9 bytes at a time, and check the
// 9-byte pattern. Stop when conformance breaks.

function looksLikeRecord(p) {
  if (p < 0 || p + 9 > buf.length) return false;
  if (buf[p+5] !== 0 || buf[p+6] !== 0 || buf[p+7] !== 0 || buf[p+8] !== 0) return false;
  const nn = buf[p+3];
  if ((nn & 0x0f) !== 0) return false;
  if (nn > 0x80) return false;
  return true;
}

// The terminator before the string is 4-byte 0xff. Find it: scan back from
// stringHit.pos for `ff ff ff ff` within last ~64 bytes.
function findFFTerminator(stringPos) {
  for (let k = 2; k <= 64; k++) {
    if (stringPos - k - 3 < 0) break;
    if (buf[stringPos-k]===0xff && buf[stringPos-k-1]===0xff && buf[stringPos-k-2]===0xff && buf[stringPos-k-3]===0xff) {
      return stringPos - k - 3; // start of the 4-byte 0xff block
    }
  }
  return -1;
}

const runs = [];
for (const h of stringHits) {
  const ffStart = findFFTerminator(h.pos);
  if (ffStart < 0) continue;
  // Walk back from ffStart in 9-byte strides
  let runStart = ffStart;
  for (let p = ffStart - 9; p >= Z0; p -= 9) {
    if (looksLikeRecord(p)) {
      runStart = p;
    } else {
      break;
    }
  }
  const nbytes = ffStart - runStart;
  if (nbytes >= 9 && nbytes % 9 === 0) {
    runs.push({ start: runStart, end: ffStart, nrec: nbytes/9, name: h.str, stringPos: h.pos });
  }
}
console.log(`\nfound ${runs.length} stride-9 runs anchored to EDU strings`);

// Histogram by name
const runsByName = {};
for (const r of runs) {
  if (!runsByName[r.name]) runsByName[r.name] = [];
  runsByName[r.name].push(r);
}
const nameHist = Object.entries(runsByName).map(([k,v])=>[k,v.length]).sort((a,b)=>b[1]-a[1]);
console.log("\nruns-per-unit histogram (top 30):");
for (const [s,n] of nameHist.slice(0,30)) console.log(`  "${s}" : ${n} runs, avg nrec=${(runsByName[s].reduce((a,r)=>a+r.nrec,0)/n).toFixed(1)}`);

// Pick the unit name with the most runs
if (runs.length === 0) {
  console.log("FATAL: no runs anchored, abort");
  process.exit(0);
}
const [pickName] = nameHist[0];
const pickedRuns = runsByName[pickName].filter(r => r.nrec >= 10);
console.log(`\n=== Picked "${pickName}" with ${pickedRuns.length} runs (nrec>=10) ===`);

function extract(r) {
  const out = [];
  for (let p = r.start; p < r.end; p += 9) {
    out.push({
      xyz: buf[p] | (buf[p+1]<<8) | (buf[p+2]<<16),
      nn: buf[p+3],
      mm: buf[p+4],
    });
  }
  return out;
}

const runRecs = pickedRuns.map(extract);
console.log(`run sizes: ${runRecs.slice(0,20).map(r=>r.length).join(", ")}${runRecs.length>20?" ...":""}`);

const xyzSets = runRecs.map(rs => new Set(rs.map(r=>r.xyz)));
let inter = new Set(xyzSets[0]);
for (let i = 1; i < xyzSets.length; i++) {
  const tmp = new Set();
  for (const v of inter) if (xyzSets[i].has(v)) tmp.add(v);
  inter = tmp;
}
let union = new Set();
for (const s of xyzSets) for (const v of s) union.add(v);

console.log(`xyz: union=${union.size}, intersection=${inter.size}`);
// Pairwise overlap %
console.log(`\npairwise xyz overlap (first 6 runs):`);
const N = Math.min(6, xyzSets.length);
let head = "    ";
for (let j=0;j<N;j++) head += `  r${j} `.padStart(6);
console.log(head + " (size)");
for (let i=0;i<N;i++) {
  let row = ` r${i} `;
  for (let j=0;j<N;j++) {
    if (j===i) row += "   --";
    else {
      let c=0;
      for (const v of xyzSets[i]) if (xyzSets[j].has(v)) c++;
      const d = Math.min(xyzSets[i].size, xyzSets[j].size);
      row += ` ${(100*c/d).toFixed(0)}%`.padStart(6);
    }
  }
  console.log(row + `  (${xyzSets[i].size})`);
}

// xyz dump for run 0
console.log(`\nrun 0 first 30 records:`);
for (const r of runRecs[0].slice(0,30)) console.log(`  xyz=0x${r.xyz.toString(16).padStart(6,"0")} (${r.xyz.toString().padStart(7)}) nn=0x${r.nn.toString(16).padStart(2,"0")} mm=0x${r.mm.toString(16).padStart(2,"0")}`);

// Range across all picked-name runs
const allXyz = [...union];
allXyz.sort((a,b)=>a-b);
console.log(`\nxyz range: min=${allXyz[0]} max=${allXyz[allXyz.length-1]} distinct=${allXyz.length}`);
console.log(`<256:${allXyz.filter(v=>v<256).length} <1024:${allXyz.filter(v=>v<1024).length} <65536:${allXyz.filter(v=>v<65536).length}`);
console.log(`sample sorted: ${allXyz.slice(0,30).map(v=>v.toString(16)).join(",")}...${allXyz.slice(-5).map(v=>v.toString(16)).join(",")}`);

// Byte-split
const hiVals = new Set(), midVals = new Set(), loVals = new Set();
for (const v of union) { loVals.add(v&0xff); midVals.add((v>>8)&0xff); hiVals.add((v>>16)&0xff); }
console.log(`byte split distinct: lo=${loVals.size} mid=${midVals.size} hi=${hiVals.size}`);
console.log(`hi values: ${[...hiVals].sort((a,b)=>a-b).join(",")}`);

// Is xyz the same for the same record-position across runs? Maybe xyz is
// keyed by the record's position in the table (= unit index in EDU), and
// the difference between runs is the NN tier.
console.log(`\nposition-wise xyz across runs (col i = i'th record):`);
const positionXyzMap = {};
for (let i = 0; i < runRecs.length; i++) {
  for (let j = 0; j < runRecs[i].length; j++) {
    if (!positionXyzMap[j]) positionXyzMap[j] = [];
    positionXyzMap[j].push(runRecs[i][j].xyz);
  }
}
// For each position j, count distinct xyz across runs
const samePos = [];
for (const [pos, xyzs] of Object.entries(positionXyzMap)) {
  const distinct = new Set(xyzs);
  samePos.push({ pos: +pos, distinct: distinct.size, total: xyzs.length, first: xyzs[0] });
}
samePos.sort((a,b)=>a.pos-b.pos);
const constPos = samePos.filter(p=>p.distinct===1).length;
console.log(`positions where xyz is constant across all runs: ${constPos}/${samePos.length}`);
console.log(`first 20 positions: ${samePos.slice(0,20).map(p=>`pos${p.pos}:${p.distinct}/${p.total}=0x${p.first.toString(16)}`).join(" ")}`);

// Hash test
function djb2(s){let h=5381;for(let i=0;i<s.length;i++)h=((h<<5)+h+s.charCodeAt(i))|0;return h>>>0;}
function fnv1a(s){let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=(h*0x01000193)>>>0;}return h;}

// Build hashmap of all EDU names (type + dictionary)
const allNames = [...typeNames, ...dictNames];
const hash24 = new Map();
for (const n of allNames) {
  hash24.set(djb2(n) & 0xffffff, { n, h: "djb2" });
  hash24.set(fnv1a(n) & 0xffffff, { n, h: "fnv1a" });
  hash24.set(djb2(n.toLowerCase()) & 0xffffff, { n, h: "djb2-lc" });
  hash24.set(fnv1a(n.toLowerCase()) & 0xffffff, { n, h: "fnv1a-lc" });
}
console.log(`\nbuilt ${hash24.size} 24-bit hash entries for ${allNames.length} EDU names`);

let matches = 0;
const sm = [];
for (const v of union) if (hash24.has(v)) { matches++; if (sm.length<10) sm.push({xyz:v, ...hash24.get(v)}); }
console.log(`hash matches: ${matches}/${union.size} (${(100*matches/union.size).toFixed(2)}%; random expected ~${(100*hash24.size/0x1000000).toFixed(2)}%)`);
for (const s of sm) console.log(`  xyz=0x${s.xyz.toString(16)} -> "${s.n}" (${s.h})`);

// Compare run 0's xyz array against the 254-row EDU table. Are run 0's xyz
// values exactly the unit-type indices in EDU? Count EDU units.
console.log(`\nEDU type-name count: ${typeNames.size}`);

// Maybe xyz is `(unit_idx << 8) | tier_idx` or something — look at low byte
const r0xyz = [...new Set(runRecs[0].map(r=>r.xyz))].sort((a,b)=>a-b);
console.log(`run0 distinct xyz count: ${r0xyz.length}`);
console.log(`run0 sorted xyz: ${r0xyz.slice(0,40).map(v=>v.toString(16)).join(",")}`);

// Is the SET of xyz in run 0 a permutation of 0..N-1 for some N?
const r0lo = new Set(r0xyz);
let isPerm = true;
for (let i = 0; i < r0xyz.length; i++) if (!r0lo.has(i)) { isPerm = false; break; }
console.log(`run0 xyz is permutation of 0..${r0xyz.length-1}? ${isPerm}`);

// What if xyz is u16 in low 16 bits with mid byte being "subtype"?
// Test: u16 = xyz & 0xffff for run 0
const r0u16 = [...new Set(runRecs[0].map(r=>r.xyz & 0xffff))].sort((a,b)=>a-b);
console.log(`run0 distinct u16 (low 16): ${r0u16.length}; min=${r0u16[0]} max=${r0u16[r0u16.length-1]}`);

// Save summary
fs.writeFileSync("C:/dev/Provincia/scripts/save-cracker/out-stride9xyz-summary.json", JSON.stringify({
  pickName,
  runsForPicked: pickedRuns.length,
  totalRuns: runs.length,
  unionXyz: union.size,
  intersectXyz: inter.size,
  hashMatches: matches,
  constPos,
  totalPos: samePos.length,
  nameHistTop: nameHist.slice(0,20),
}, null, 2));
console.log("wrote out-stride9xyz-summary.json");
