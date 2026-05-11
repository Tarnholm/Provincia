// Session 26 — Narrow analysis to the dense 152.7KB main event block (0x87e9..0x2dca1)
// where records are CONTIGUOUS valid. Decode flag/sub semantics with hashes.

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

const START = 0x87e9, END = 0x2dca1;   // dense run end
const STRIDE = 12;
const N = (END - START) / STRIDE;
console.log('Dense event block:', '0x' + START.toString(16), '..', '0x' + END.toString(16), '=', (END-START), 'bytes,', N, 'records');

// Re-parse - all records assumed valid
const recs = [];
for (let i = 0; i < N; i++) {
  const o = START + i*STRIDE;
  recs.push({
    i, o,
    flag: buf[o], sub: buf[o+1],
    idA: buf.readUInt16LE(o+2),
    idB: buf.readUInt16LE(o+4),
    z: buf.readUInt16LE(o+6),
    h: buf.readUInt32LE(o+8) >>> 0
  });
}

// Flag distribution
const flagH = {};
for (const r of recs) flagH[r.flag] = (flagH[r.flag]||0)+1;
const flagS = Object.entries(flagH).sort((a,b)=>b[1]-a[1]);
console.log('\n=== Flag distribution (dense block, top 20) ===');
flagS.slice(0,20).forEach(([f,c])=>console.log('  flag=' + f.padStart(3) + ' (0x' + parseInt(f).toString(16).padStart(2,'0') + '): ' + c.toString().padStart(6) + ' (' + (100*c/N).toFixed(1) + '%)'));
console.log('Distinct flags:', flagS.length);

// Sub distribution
const subH = {};
for (const r of recs) subH[r.sub] = (subH[r.sub]||0)+1;
const subS = Object.entries(subH).sort((a,b)=>b[1]-a[1]);
console.log('\n=== Sub distribution (top 10) ===');
subS.slice(0,10).forEach(([s,c])=>console.log('  sub=' + s.padStart(3) + ' (0x' + parseInt(s).toString(16).padStart(2,'0') + '): ' + c.toString().padStart(6)));

// (flag,sub) joint
const fsH = {};
for (const r of recs) {
  const k = r.flag + ',' + r.sub;
  fsH[k] = (fsH[k]||0)+1;
}
console.log('\n=== (flag,sub) joint top 15 ===');
Object.entries(fsH).sort((a,b)=>b[1]-a[1]).slice(0,15).forEach(([k,c])=>console.log('  flag=' + k.split(',')[0].padStart(3) + ' sub=0x' + parseInt(k.split(',')[1]).toString(16).padStart(2,'0') + ' = ' + c));

// idB (year)
const yrs = {};
for (const r of recs) yrs[r.idB] = (yrs[r.idB]||0)+1;
const yrK = Object.keys(yrs).map(Number).sort((a,b)=>a-b);
console.log('\nidB year range:', yrK[0], '..', yrK[yrK.length-1], '(' + yrK.length + ' distinct)');
console.log('First 10 years:', yrK.slice(0,10).map(y=>y+'('+yrs[y]+')').join(' '));
console.log('Last 10 years:', yrK.slice(-10).map(y=>y+'('+yrs[y]+')').join(' '));

// Per-year flag distribution: is each year's events of one type or many?
console.log('\n=== Per-year flag distribution (first 10 years) ===');
for (const y of yrK.slice(0,10)) {
  const flagsAt = {};
  for (const r of recs) if (r.idB===y) flagsAt[r.flag] = (flagsAt[r.flag]||0)+1;
  const top = Object.entries(flagsAt).sort((a,b)=>b[1]-a[1]).slice(0,5);
  console.log('  year=' + y + ' (' + yrs[y] + ' events): ' + top.map(([f,c])=>'f'+f+'='+c).join(' '));
}

// Hash distribution
const hashH = {};
for (const r of recs) hashH[r.h] = (hashH[r.h]||0)+1;
const hashS = Object.entries(hashH).sort((a,b)=>b[1]-a[1]);
console.log('\n=== Top 30 actor hashes ===');
hashS.slice(0,30).forEach(([h,c])=>console.log('  0x' + (parseInt(h)>>>0).toString(16).padStart(8,'0') + ' (' + parseInt(h) + '): ' + c));
console.log('Distinct hashes:', hashS.length);

// Cross-check first 100 records
console.log('\n=== First 30 records dump ===');
recs.slice(0,30).forEach(r=>{
  console.log('  [' + r.i.toString().padStart(5) + '] f=' + r.flag.toString().padStart(3) + ' s=' + r.sub.toString().padStart(3) + ' idA=' + r.idA.toString().padStart(5) + ' idB=' + r.idB.toString().padStart(4) + ' z=' + r.z + ' h=0x' + r.h.toString(16).padStart(8,'0'));
});

// What's the highest record count for a single year? — That year had busiest history
const byCount = Object.entries(yrs).sort((a,b)=>b[1]-a[1]);
console.log('\n=== Years with most events (top 15) ===');
byCount.slice(0,15).forEach(([y,c])=>console.log('  year=' + y.padStart(4) + ' events=' + c));

// What if "flag" is really an action type + the high bits encode something?
// flag=1, sub=0x20 dominates — this is the "background event-ticker" record
// flag=2, sub=0x20 dominates as second — secondary event
// idA looks like a small target ID. Let me see what idA range each flag has
console.log('\n=== idA distribution per top flag (mean, max) ===');
for (const [f, c] of flagS.slice(0,8)) {
  const sub = recs.filter(r=>r.flag === parseInt(f));
  const idAs = sub.map(r=>r.idA);
  const mean = idAs.reduce((a,b)=>a+b,0)/idAs.length;
  const max = Math.max(...idAs);
  const min = Math.min(...idAs);
  console.log('  flag=' + f.padStart(3) + ': n=' + c + ' idA min=' + min + ' mean=' + mean.toFixed(0) + ' max=' + max);
}

// Look at the actual flag=1, sub=0x20 vs flag=2, sub=0x20 distinction
// Are they ordered by idA? Is idA monotonic per faction-hash?
console.log('\n=== Pattern test: per-hash idA monotonicity for top hash ===');
const topHashRaw = parseInt(hashS[0][0]);
const topHashRecs = recs.filter(r => r.h === topHashRaw).slice(0, 30);
console.log('Hash 0x' + topHashRaw.toString(16) + ' first 30 records:');
topHashRecs.forEach(r=>console.log('  [' + r.i + '] f=' + r.flag + ' s=' + r.sub + ' idA=' + r.idA + ' idB=' + r.idB));

// Are idAs sequential for same hash? Like character moving through tile IDs?
const hashIdAseq = {};
for (const r of recs) {
  if (!hashIdAseq[r.h]) hashIdAseq[r.h] = [];
  hashIdAseq[r.h].push({i: r.i, idA: r.idA, idB: r.idB});
}
// For top 5 hashes, check if idA is consecutive / character-path-like
console.log('\n=== Top 5 hashes idA-vs-record-order stride ===');
hashS.slice(0,5).forEach(([h,c])=>{
  const arr = hashIdAseq[parseInt(h)];
  if (arr.length < 4) return;
  const strides = [];
  for (let i = 1; i < Math.min(arr.length, 30); i++) strides.push(arr[i].idA - arr[i-1].idA);
  const strideH = {};
  strides.forEach(s=>strideH[s]=(strideH[s]||0)+1);
  const sTop = Object.entries(strideH).sort((a,b)=>b[1]-a[1]).slice(0,5);
  console.log('  hash=0x' + (parseInt(h)>>>0).toString(16).padStart(8,'0') + ' n=' + arr.length + ' idA-strides top: ' + sTop.map(([s,c])=>'Δ'+s+'×'+c).join(' '));
});

// Final: check if flag=1 records are denser in a specific year-range
console.log('\n=== flag=1 records per-year ===');
const f1byYear = {};
recs.filter(r=>r.flag===1).forEach(r=>f1byYear[r.idB]=(f1byYear[r.idB]||0)+1);
const f1Years = Object.keys(f1byYear).map(Number).sort((a,b)=>a-b);
console.log('flag=1 spans years', f1Years[0], '..', f1Years[f1Years.length-1], '(' + f1Years.length + ' distinct)');
f1Years.slice(0,5).forEach(y=>console.log('  year=' + y + ' flag1=' + f1byYear[y]));
f1Years.slice(-5).forEach(y=>console.log('  year=' + y + ' flag1=' + f1byYear[y]));
