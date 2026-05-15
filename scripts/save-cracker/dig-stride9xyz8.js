// dig-stride9xyz8.js — confirm the packed-byte interpretation of xyz.
// Specifically:
//  - Is LO byte correlated with NN tier?
//  - Is HI byte constant per run? (= run-level "category" key)
//  - Is MID byte densely 0..N where N matches some entity-count?

const fs = require("fs");
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const Z0 = 0x14e5ac6, Z1 = 0x20e6e8e;
const buf = fs.readFileSync(SAVE);

function isRec(p) {
  return buf[p+5]===0 && buf[p+6]===0 && buf[p+7]===0 && buf[p+8]===0 &&
         (buf[p+3] & 0x0f)===0 && buf[p+3] <= 0x80;
}

// Collect chained runs as before
const records = [];
for (let p = Z0; p + 9 <= Z1; p++) {
  if (isRec(p) && isRec(p+9)) {
    records.push({ off: p, xyz: buf[p] | (buf[p+1]<<8) | (buf[p+2]<<16), nn: buf[p+3], mm: buf[p+4] });
    p += 8;
  }
}
const runs = [];
let cur = [];
for (let i = 0; i < records.length; i++) {
  if (cur.length === 0 || records[i].off === cur[cur.length-1].off + 9) cur.push(records[i]);
  else { if (cur.length >= 10) runs.push(cur); cur = [records[i]]; }
}
if (cur.length >= 10) runs.push(cur);
console.log(`${runs.length} runs of >=10 records`);

// Test 1: is HI byte constant within a run? (= run-level category)
let hiConst = 0, hiVary = 0;
const hiPerRun = [];
for (const r of runs) {
  const his = new Set(r.map(x => (x.xyz>>16) & 0xff));
  if (his.size === 1) hiConst++; else hiVary++;
  hiPerRun.push({ runlen: r.length, his: [...his], mm: r[0].mm });
}
console.log(`Test 1: HI byte constant within run: ${hiConst}/${runs.length} (${(100*hiConst/runs.length).toFixed(1)}%)`);

// Test 2: is LO byte constant within run?
let loConst = 0;
for (const r of runs) {
  const los = new Set(r.map(x => x.xyz & 0xff));
  if (los.size === 1) loConst++;
}
console.log(`Test 2: LO byte constant within run: ${loConst}/${runs.length} (${(100*loConst/runs.length).toFixed(1)}%)`);

// Test 3: is MID byte the only varying field within a run?
let midOnlyVaries = 0;
for (const r of runs) {
  const los = new Set(r.map(x => x.xyz & 0xff));
  const his = new Set(r.map(x => (x.xyz>>16) & 0xff));
  const mids = new Set(r.map(x => (x.xyz>>8) & 0xff));
  if (los.size === 1 && his.size === 1 && mids.size > 1) midOnlyVaries++;
}
console.log(`Test 3: only MID byte varies within run: ${midOnlyVaries}/${runs.length} (${(100*midOnlyVaries/runs.length).toFixed(1)}%)`);

// Test 4: when MID varies, are MID values dense in 0..N?
const midDensity = [];
for (const r of runs) {
  const mids = [...new Set(r.map(x => (x.xyz>>8) & 0xff))].sort((a,b)=>a-b);
  if (mids.length >= 5) {
    const max = mids[mids.length-1];
    const filled = mids.length;
    midDensity.push({ runlen: r.length, distinct: filled, max, fillPct: (100*filled/(max+1)).toFixed(1) });
  }
}
console.log(`Test 4: MID density samples (first 10):`);
for (const m of midDensity.slice(0,10)) console.log(`  runlen=${m.runlen} distinct-MID=${m.distinct} maxMID=${m.max} fill%=${m.fillPct}`);

// Test 5: Correlation between LO byte and NN
// For MM=0 records: does LO match NN nibble?
let loEqNn = 0, total5 = 0;
for (const r of records) {
  if (r.mm !== 0) continue;
  total5++;
  if ((r.xyz & 0xff) === r.nn) loEqNn++;
}
console.log(`Test 5: LO byte == NN byte (in MM=0 records): ${loEqNn}/${total5} (${(100*loEqNn/total5).toFixed(2)}%)`);

// Test 6: HI byte histogram per dominant-MM
const hi0 = {}, hi4 = {};
for (const r of records) {
  if (r.mm === 0) hi0[(r.xyz>>16)&0xff] = (hi0[(r.xyz>>16)&0xff]||0)+1;
  if (r.mm === 4) hi4[(r.xyz>>16)&0xff] = (hi4[(r.xyz>>16)&0xff]||0)+1;
}
console.log(`\nHI byte hist for MM=0 records (top 12): ${Object.entries(hi0).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([k,v])=>`${k}:${v}`).join(" ")}`);
console.log(`HI byte hist for MM=4 records: ${Object.entries(hi4).sort((a,b)=>Number(a[0])-Number(b[0])).map(([k,v])=>`${k}:${v}`).join(" ")}`);

// Test 7: LO byte hist per MM
const lo0 = {}, lo4 = {};
for (const r of records) {
  if (r.mm === 0) lo0[r.xyz&0xff] = (lo0[r.xyz&0xff]||0)+1;
  if (r.mm === 4) lo4[r.xyz&0xff] = (lo4[r.xyz&0xff]||0)+1;
}
console.log(`LO byte hist for MM=0 records: ${Object.entries(lo0).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v])=>`${k}:${v}`).join(" ")}`);
console.log(`LO byte hist for MM=4 records: ${Object.entries(lo4).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(" ")}`);

// Test 8: For dominant run-length 239 (most informative — 1451 such runs):
//   For each of the 1451 runs, what's the (HI, LO) tuple, and is MID a perm of 0..238?
const r239 = runs.filter(r => r.length === 239);
console.log(`\nTest 8: ${r239.length} runs of length 239`);
let r239midPerm = 0;
const r239HiLoFlavors = {};
for (const r of r239) {
  const mids = new Set(r.map(x => (x.xyz>>8) & 0xff));
  const his = [...new Set(r.map(x => (x.xyz>>16) & 0xff))];
  const los = [...new Set(r.map(x => x.xyz & 0xff))];
  if (mids.size === 239 && Math.max(...mids) === 238) r239midPerm++;
  const key = `hi:${his.join("|")},lo:${los.join("|")}`;
  r239HiLoFlavors[key] = (r239HiLoFlavors[key]||0)+1;
}
console.log(`  239-runs where MID exactly fills 0..238: ${r239midPerm}/${r239.length}`);
console.log(`  239-runs HI/LO flavor histogram (top 15):`);
for (const [k,v] of Object.entries(r239HiLoFlavors).sort((a,b)=>b[1]-a[1]).slice(0,15)) console.log(`    ${k} : ${v}`);

// Test 9: For runs of length 239 with constant HI and LO, what's the HI value
// distribution? (= run-level category)
const r239HiHist = {};
for (const r of r239) {
  const his = new Set(r.map(x => (x.xyz>>16) & 0xff));
  if (his.size === 1) {
    const h = [...his][0];
    r239HiHist[h] = (r239HiHist[h]||0)+1;
  }
}
console.log(`\nTest 9: 239-run HI byte distribution (constant-HI runs only):`);
for (const [k,v] of Object.entries(r239HiHist).sort((a,b)=>Number(a[0])-Number(b[0]))) console.log(`  HI=0x${Number(k).toString(16)} (${k}): ${v} runs`);

// Test 10: 239-run LO byte distribution
const r239LoHist = {};
for (const r of r239) {
  const los = new Set(r.map(x => x.xyz & 0xff));
  if (los.size === 1) {
    const l = [...los][0];
    r239LoHist[l] = (r239LoHist[l]||0)+1;
  }
}
console.log(`\nTest 10: 239-run LO byte distribution (constant-LO runs):`);
for (const [k,v] of Object.entries(r239LoHist).sort((a,b)=>Number(a[0])-Number(b[0]))) console.log(`  LO=0x${Number(k).toString(16)} (${k}): ${v} runs`);

// Test 11: For 239-runs with HI=0x04 (the dominant), are the NN values monotone?
const hi4runs = r239.filter(r => (r[0].xyz>>16 & 0xff) === 0x04);
console.log(`\nTest 11: ${hi4runs.length} 239-runs with HI=4`);
if (hi4runs.length > 0) {
  // Take first such run, dump first 20 records
  console.log(`First HI=4 run, first 20 records:`);
  for (const x of hi4runs[0].slice(0,20)) {
    console.log(`  xyz=0x${x.xyz.toString(16).padStart(6,"0")} hi=${(x.xyz>>16)&0xff} mid=${(x.xyz>>8)&0xff} lo=${x.xyz&0xff} nn=0x${x.nn.toString(16)} mm=0x${x.mm.toString(16)}`);
  }
  // Sort by MID, check NN monotone
  let m = 0, t = 0;
  for (const r of hi4runs) {
    const s = [...r].sort((a,b) => ((a.xyz>>8)&0xff) - ((b.xyz>>8)&0xff));
    for (let i = 1; i < s.length; i++) { t++; if (s[i].nn >= s[i-1].nn) m++; }
  }
  console.log(`HI=4 239-runs: NN non-decreasing when sorted by MID: ${m}/${t} (${(100*m/t).toFixed(1)}%)`);
}

// Test 12: HI=20 (= 0x14) is also super common. What does that mean?
const hi20runs = r239.filter(r => (r[0].xyz>>16 & 0xff) === 0x14);
console.log(`\nTest 12: ${hi20runs.length} 239-runs with HI=0x14 (=20)`);

// Test 13: Sum of (HI=4 count) + (HI=20 count) + (HI=21 count, =0x15)
// HI=20,21,22 might encode tier 1,2,3 of same category? Or zones?

// Test 14: Number of factions in vanilla = ~31. Number of "ranges" per faction
// = 1243 / 31 ≈ 40. Or 1243 / 254 ≈ 4.9. Or 254 runs per faction × 5 factions
// ... unclear.

// Just count distinct HI bytes:
const hiAllSet = new Set();
for (const r of records) hiAllSet.add((r.xyz>>16)&0xff);
console.log(`\ntotal distinct HI bytes: ${hiAllSet.size}`);
console.log(`sorted: ${[...hiAllSet].sort((a,b)=>a-b).join(",")}`);

// Test 15: per-run "fingerprint" = (HI, LO) pair. Categorize runs.
const runFingerprints = {};
for (const r of runs) {
  const hi = [...new Set(r.map(x => (x.xyz>>16)&0xff))].sort((a,b)=>a-b).join("|");
  const lo = [...new Set(r.map(x => x.xyz&0xff))].sort((a,b)=>a-b).join("|");
  const key = `hi:${hi}/lo:${lo}`;
  runFingerprints[key] = (runFingerprints[key]||0)+1;
}
console.log(`\nTest 15: top 20 run-fingerprints (HI-set / LO-set):`);
for (const [k,v] of Object.entries(runFingerprints).sort((a,b)=>b[1]-a[1]).slice(0,20)) console.log(`  ${k} : ${v}`);
