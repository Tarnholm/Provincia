// dig-stride9xyz6.js — restrict scan to the post-merc-pool zone where the
// actual stride-9 score tables live. Also relax the trailing-string match:
// the terminator strings may be culture/faction names like "egyptian",
// "psiloi" (which are EDU "soldier" field values, not "type" field values).

const fs = require("fs");
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const EDU  = "C:/RIS/RIS/data/export_descr_unit.txt";

// Zone start AFTER merc pool — merc pool ends at 0x1501615 per cover.js.
const Z0 = 0x1501615, Z1 = 0x20e6e8e;
const buf = fs.readFileSync(SAVE);

// Load EDU: type, dictionary, soldier, category, class
const eduText = fs.readFileSync(EDU, "utf8");
const typeNames = new Set();
const dictNames = new Set();
const soldierNames = new Set();
const categoryNames = new Set();
const classNames = new Set();
for (const l of eduText.split(/\r?\n/)) {
  let m;
  if ((m = l.match(/^\s*type\s+(.+?)\s*$/i))) typeNames.add(m[1]);
  if ((m = l.match(/^\s*dictionary\s+(\S+)/i))) dictNames.add(m[1]);
  if ((m = l.match(/^\s*soldier\s+(\S+)/i))) soldierNames.add(m[1]);
  if ((m = l.match(/^\s*category\s+(\S+)/i))) categoryNames.add(m[1]);
  if ((m = l.match(/^\s*class\s+(\S+)/i))) classNames.add(m[1]);
}
console.log(`EDU loaded: ${typeNames.size} type, ${dictNames.size} dict, ${soldierNames.size} soldier, ${categoryNames.size} category, ${classNames.size} class`);
const cultureFactionStrings = new Set([
  "egyptian","greek","roman","barbarian","carthaginian","eastern","numidian","slave","nomad","arab","asian","celtic","gaul","german","britannic","brittonic","iberian","sarmatian","indian","scythian","thracian","macedonian",
  "ptolemaic","seleucid","antigonid","epirus","sparta","athens","achaea","gortyn","knossos","crete","cyrene","libyans","saba",
  // Possible RIS additions
  "hellenic","balearic","illyrian"
]);

const allMatchSet = new Set([...typeNames, ...dictNames, ...soldierNames, ...categoryNames, ...classNames, ...cultureFactionStrings]);
console.log(`combined string set: ${allMatchSet.size}`);

// Scan for length-prefixed strings whose body matches any of these.
const stringHits = [];
let pp = Z0;
while (pp < Z1 - 2) {
  const slen = buf.readUInt16LE(pp);
  if (slen >= 4 && slen <= 64 && pp + 2 + slen <= Z1) {
    let ok = true;
    for (let i = 0; i < slen - 1; i++) {
      const c = buf[pp+2+i];
      if (c < 0x20 || c > 0x7e) { ok = false; break; }
    }
    if (ok && buf[pp+2+slen-1] === 0) {
      const s = buf.slice(pp+2, pp+2+slen-1).toString("ascii");
      if (allMatchSet.has(s)) {
        stringHits.push({ pos: pp, str: s, end: pp+2+slen });
        pp += 2 + slen;
        continue;
      }
    }
  }
  pp++;
}
console.log(`found ${stringHits.length} matching strings in zone`);

// Histogram
const byStr = {};
for (const h of stringHits) (byStr[h.str] = byStr[h.str] || []).push(h);
const strHist = Object.entries(byStr).map(([k,v])=>[k,v.length]).sort((a,b)=>b[1]-a[1]);
console.log("top 30 hits:");
for (const [s,n] of strHist.slice(0,30)) console.log(`  "${s}" : ${n}`);

// For each, check if there's a stride-9 run immediately preceding (with FFx4 inside)
function looksLikeRecord(p) {
  if (p < 0 || p + 9 > buf.length) return false;
  if (buf[p+5] !== 0 || buf[p+6] !== 0 || buf[p+7] !== 0 || buf[p+8] !== 0) return false;
  const nn = buf[p+3];
  if ((nn & 0x0f) !== 0) return false;
  if (nn > 0x80) return false;
  return true;
}

// Walk back from each string in steps of 1 byte to find a 4×0xff terminator
// within the last 256 bytes; then walk back in 9-byte strides from there.
function findFF(stringPos) {
  for (let k = 2; k <= 256; k++) {
    if (stringPos - k - 3 < 0) break;
    if (buf[stringPos-k]===0xff && buf[stringPos-k-1]===0xff && buf[stringPos-k-2]===0xff && buf[stringPos-k-3]===0xff) {
      return stringPos - k - 3; // start of 4-byte ff
    }
  }
  return -1;
}

const runs = [];
for (const h of stringHits) {
  const ffStart = findFF(h.pos);
  if (ffStart < 0) continue;
  let runStart = ffStart;
  for (let p = ffStart - 9; p >= Z0; p -= 9) {
    if (looksLikeRecord(p)) runStart = p;
    else break;
  }
  const nb = ffStart - runStart;
  if (nb >= 9*5 && nb % 9 === 0) {
    runs.push({ start: runStart, end: ffStart, nrec: nb/9, name: h.str, stringPos: h.pos });
  }
}
console.log(`\nfound ${runs.length} stride-9 runs with FF terminator + matching trail-string`);

// Histogram of run terminator names
const runsByName = {};
for (const r of runs) (runsByName[r.name] = runsByName[r.name] || []).push(r);
const nameHist = Object.entries(runsByName).map(([k,v])=>[k,v.length]).sort((a,b)=>b[1]-a[1]);
console.log("top 25 terminator-name run counts:");
for (const [s,n] of nameHist.slice(0,25)) {
  const avgN = (runsByName[s].reduce((a,r)=>a+r.nrec,0)/n).toFixed(1);
  console.log(`  "${s}" : ${n} runs, avgNrec=${avgN}`);
}

if (runs.length === 0) {
  console.log("FATAL still 0 runs"); process.exit(0);
}

// Pick the top terminator-name with >=3 runs
let pickName = null;
for (const [s, n] of nameHist) {
  if (n >= 3 && runsByName[s].some(r => r.nrec >= 10)) { pickName = s; break; }
}
if (!pickName) pickName = nameHist[0][0];

const pickedRuns = runsByName[pickName].filter(r => r.nrec >= 10);
console.log(`\n=== Picked "${pickName}" with ${pickedRuns.length} runs ===`);

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

// Overlap
const xyzSets = runRecs.map(rs => new Set(rs.map(r=>r.xyz)));
let union = new Set(); for (const s of xyzSets) for (const v of s) union.add(v);
let inter = new Set(xyzSets[0]);
for (let i = 1; i < xyzSets.length; i++) {
  const tmp = new Set();
  for (const v of inter) if (xyzSets[i].has(v)) tmp.add(v);
  inter = tmp;
}
console.log(`union xyz: ${union.size}, intersection: ${inter.size}`);

// Pairwise overlap
const N = Math.min(6, xyzSets.length);
console.log("\npairwise overlap %:");
let header = "       "; for (let j=0;j<N;j++) header += `  r${j} `.padStart(6);
console.log(header);
for (let i=0;i<N;i++) {
  let row = ` r${i}    `;
  for (let j=0;j<N;j++) {
    if (j===i) { row += "   --"; continue; }
    let c=0;
    for (const v of xyzSets[i]) if (xyzSets[j].has(v)) c++;
    const d = Math.min(xyzSets[i].size, xyzSets[j].size);
    row += ` ${(100*c/d).toFixed(0)}%`.padStart(6);
  }
  console.log(row + `  size=${xyzSets[i].size}`);
}

// Record-position overlap: does run[i][pos] == run[j][pos] (xyz)?
console.log(`\nPosition-wise xyz: how often does run[i][pos].xyz == run[j][pos].xyz?`);
let samePos=0, total=0;
const minLen = Math.min(...runRecs.map(r=>r.length));
for (let pos=0; pos<minLen; pos++) {
  for (let i=0; i<runRecs.length; i++) {
    for (let j=i+1; j<runRecs.length; j++) {
      total++;
      if (runRecs[i][pos].xyz === runRecs[j][pos].xyz) samePos++;
    }
  }
}
console.log(`  position-wise xyz equality: ${samePos}/${total} (${(100*samePos/total).toFixed(2)}%)`);

// Check: is xyz position-determined? For each position, what's the modal xyz?
let posConst = 0;
for (let pos=0; pos<minLen; pos++) {
  const counts = {};
  for (const rs of runRecs) counts[rs[pos].xyz] = (counts[rs[pos].xyz]||0)+1;
  const top = Math.max(...Object.values(counts));
  if (top === runRecs.length) posConst++;
}
console.log(`positions where xyz is identical across ALL runs: ${posConst}/${minLen}`);

// Record from run 0
console.log(`\nrun 0 first 25:`);
for (const r of runRecs[0].slice(0,25)) console.log(`  xyz=0x${r.xyz.toString(16).padStart(6,"0")} (${r.xyz.toString().padStart(7)}) nn=0x${r.nn.toString(16).padStart(2,"0")} mm=0x${r.mm.toString(16).padStart(2,"0")}`);

// Hash test
function djb2(s){let h=5381;for(let i=0;i<s.length;i++)h=((h<<5)+h+s.charCodeAt(i))|0;return h>>>0;}
function fnv1a(s){let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=(h*0x01000193)>>>0;}return h;}

const allNames = [...new Set([...typeNames, ...dictNames, ...soldierNames])];
const hash24 = new Map();
for (const n of allNames) {
  for (const variant of [n, n.toLowerCase(), n.replace(/\s+/g, "_"), n.toLowerCase().replace(/\s+/g, "_")]) {
    hash24.set(djb2(variant) & 0xffffff, { n: variant, h: "djb2" });
    hash24.set(fnv1a(variant) & 0xffffff, { n: variant, h: "fnv1a" });
  }
}
let matches = 0;
const sample = [];
for (const v of union) if (hash24.has(v)) { matches++; if (sample.length<10) sample.push({xyz:v, ...hash24.get(v)}); }
console.log(`\nhash matches: ${matches}/${union.size} (${(100*matches/union.size).toFixed(2)}%; random expected ~${(100*hash24.size/0x1000000).toFixed(2)}%)`);
for (const s of sample) console.log(`  xyz=0x${s.xyz.toString(16)} -> "${s.n}" (${s.h})`);

// Byte-split
const hiV=new Set(),midV=new Set(),loV=new Set();
for (const v of union) { loV.add(v&0xff); midV.add((v>>8)&0xff); hiV.add((v>>16)&0xff); }
console.log(`byte split distinct: lo=${loV.size} mid=${midV.size} hi=${hiV.size}`);
console.log(`hi values: ${[...hiV].sort((a,b)=>a-b).join(",")}`);

// xyz overall range
const allXyz = [...union].sort((a,b)=>a-b);
console.log(`xyz: min=${allXyz[0]} max=${allXyz[allXyz.length-1]} distinct=${allXyz.length}`);
console.log(`<256:${allXyz.filter(v=>v<256).length} <1024:${allXyz.filter(v=>v<1024).length} <4096:${allXyz.filter(v=>v<4096).length} <65536:${allXyz.filter(v=>v<65536).length}`);
console.log(`first 30: ${allXyz.slice(0,30).map(v=>v.toString(16)).join(",")}`);

// Is xyz globally a small set of fixed values (= total EDU table size)?
console.log(`\n--- Global stats across ALL ${runs.length} runs ---`);
const allRunRecs = runs.map(extract);
const globalUnion = new Set();
for (const rs of allRunRecs) for (const r of rs) globalUnion.add(r.xyz);
console.log(`Global distinct xyz: ${globalUnion.size}`);
const globalSorted = [...globalUnion].sort((a,b)=>a-b);
console.log(`Global xyz range: ${globalSorted[0]} .. ${globalSorted[globalSorted.length-1]}`);
console.log(`<65536:${globalSorted.filter(v=>v<65536).length} <0x40000:${globalSorted.filter(v=>v<0x40000).length}`);
const gHi=new Set(),gMid=new Set(),gLo=new Set();
for (const v of globalUnion) { gLo.add(v&0xff); gMid.add((v>>8)&0xff); gHi.add((v>>16)&0xff); }
console.log(`Global byte-split distinct: lo=${gLo.size} mid=${gMid.size} hi=${gHi.size}`);

// Save
fs.writeFileSync("C:/dev/Provincia/scripts/save-cracker/out-stride9xyz-summary.json", JSON.stringify({
  totalRuns: runs.length,
  totalStringHits: stringHits.length,
  pickName, pickedRunsCount: pickedRuns.length,
  unionXyz: union.size,
  intersectXyz: inter.size,
  hashMatches: matches,
  posConst, minLen,
  globalDistinct: globalUnion.size,
  globalRange: [globalSorted[0], globalSorted[globalSorted.length-1]],
  nameHistTop: nameHist.slice(0,30),
}, null, 2));
console.log("wrote out-stride9xyz-summary.json");
