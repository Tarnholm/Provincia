// Session 27 — Revise idB semantics. idB distribution peaks at 350-450 in T5 save.
// Hypothesis: idB is NOT a campaign year, but maybe...
//   - A character/event hash-bucket (binned distribution shaped like # of characters per bucket)
//   - A character creation-year (most characters created mid-campaign)
//   - The CHARACTER's birth-year? Or a turn the actor first appeared?
//   - Or just a per-record sequence number?

// Method: check idB per actor — if idB == actor's birth-year, all records for one actor should have SAME idB
// If idB == event-year, records for one actor should span MANY idB values

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

const FULL_START = 0x51b5;
const FULL_END = 0x846af;
const STRIDE = 12;
const N = Math.floor((FULL_END - FULL_START) / STRIDE);

const recs = [];
for (let i = 0; i < N; i++) {
  const o = FULL_START + i*STRIDE;
  recs.push({
    i, o,
    hash: buf.readUInt32LE(o) >>> 0,
    flag: buf[o+4], sub: buf[o+5],
    idA: buf.readUInt16LE(o+6),
    idB: buf.readUInt32LE(o+8)
  });
}
const valid = recs.filter(r=>(r.flag===1||r.flag===2||r.flag===4) && (r.sub===0||r.sub===0x20) && r.idB > 0 && r.idB < 800 && r.idA < 4096);

// Per-actor idB-spread: do records for one actor span 1 year, few years, or many?
const actorIdb = {};
for (const r of valid) {
  if (r.hash === 0) continue;
  if (!actorIdb[r.hash]) actorIdb[r.hash] = [];
  actorIdb[r.hash].push(r.idB);
}

// Distribution: per-actor # distinct idB values
const spreadH = {};
const sameYearActors = [];
const multiYearActors = [];
for (const [h, idbs] of Object.entries(actorIdb)) {
  const distinct = new Set(idbs).size;
  spreadH[distinct] = (spreadH[distinct]||0)+1;
  if (distinct === 1) sameYearActors.push({h, count: idbs.length, year: idbs[0]});
  else multiYearActors.push({h, count: idbs.length, distinct, range: Math.max(...idbs) - Math.min(...idbs)});
}
console.log('=== Per-actor idB-spread distribution ===');
Object.entries(spreadH).sort((a,b)=>parseInt(a[0])-parseInt(b[0])).slice(0,15).forEach(([s,c])=>console.log('  ' + s + ' distinct idB: ' + c + ' actors'));

console.log('\nSame-year actors:', sameYearActors.length);
console.log('Multi-year actors:', multiYearActors.length);

// For multi-year actors, what's the typical idB-range?
const ranges = multiYearActors.map(a=>a.range).sort((a,b)=>a-b);
console.log('Multi-year actors idB-range distribution:');
console.log('  min:', ranges[0], 'median:', ranges[Math.floor(ranges.length/2)], 'max:', ranges[ranges.length-1]);
console.log('  ranges <= 10:', ranges.filter(r=>r<=10).length);
console.log('  ranges <= 50:', ranges.filter(r=>r<=50).length);
console.log('  ranges > 100:', ranges.filter(r=>r>100).length);

// Top multi-year actors by spread
console.log('\nTop multi-year actors (longest idB range):');
multiYearActors.sort((a,b)=>b.range-a.range).slice(0,5).forEach(a=>{
  console.log('  0x' + parseInt(a.h).toString(16).padStart(8,'0') + ' n=' + a.count + ' distinct=' + a.distinct + ' range=' + a.range);
  // Show first 10 idBs
  const idbs = actorIdb[a.h].sort((a,b)=>a-b);
  console.log('    idBs:', idbs.slice(0,15).join(','));
});

console.log('\nTop multi-year actors (most records):');
multiYearActors.sort((a,b)=>b.count-a.count).slice(0,10).forEach(a=>{
  console.log('  0x' + parseInt(a.h).toString(16).padStart(8,'0') + ' n=' + a.count + ' distinct=' + a.distinct + ' range=' + a.range);
});

// CHECK: is idB monotonic in record order for a given actor?
// If idB increases with record order, then it's a per-event timestamp
// If idB is constant per actor, it's a per-actor static value
console.log('\n=== Is idB monotonic per actor? ===');
let monoCount = 0, antiMonoCount = 0;
for (const [h, idbs] of Object.entries(actorIdb)) {
  if (idbs.length < 3) continue;
  // Get records in file order for this actor
  const actorRecs = valid.filter(r=>r.hash === parseInt(h)).sort((a,b)=>a.i-b.i);
  let mono = true, antiMono = true;
  for (let j = 1; j < actorRecs.length; j++) {
    if (actorRecs[j].idB < actorRecs[j-1].idB) mono = false;
    if (actorRecs[j].idB > actorRecs[j-1].idB) antiMono = false;
  }
  if (mono && !antiMono) monoCount++;
  else if (antiMono && !mono) antiMonoCount++;
}
console.log('Monotonic (idB non-decreasing in file order):', monoCount);
console.log('Anti-monotonic:', antiMonoCount);
console.log('Total actors with >= 3 records:', Object.values(actorIdb).filter(a=>a.length>=3).length);

// Distribution of idB ranges for actors with 2+ records
const idbDeltas = [];
for (const [h, idbs] of Object.entries(actorIdb)) {
  if (idbs.length < 2) continue;
  const sorted = idbs.slice().sort((a,b)=>a-b);
  for (let j = 1; j < sorted.length; j++) {
    idbDeltas.push(sorted[j] - sorted[j-1]);
  }
}
idbDeltas.sort((a,b)=>a-b);
console.log('\n=== idB-delta distribution (consecutive idBs per actor) ===');
console.log('Total deltas:', idbDeltas.length);
console.log('  delta=0: ', idbDeltas.filter(d=>d===0).length);
console.log('  delta=1: ', idbDeltas.filter(d=>d===1).length);
console.log('  delta=2..5: ', idbDeltas.filter(d=>d>=2 && d<=5).length);
console.log('  delta=6..15: ', idbDeltas.filter(d=>d>=6 && d<=15).length);
console.log('  delta=16..40: ', idbDeltas.filter(d=>d>=16 && d<=40).length);
console.log('  delta>40: ', idbDeltas.filter(d=>d>40).length);

// What does the file-order vs idB look like?
console.log('\n=== file-position vs idB correlation ===');
// Sample idB for every 1000th record
console.log('Record-i, file-offset, idB:');
for (let k = 0; k < valid.length; k += Math.floor(valid.length/20)) {
  const r = valid[k];
  console.log('  i=' + r.i.toString().padStart(5) + ' o=0x' + r.o.toString(16) + ' flag=' + r.flag + ' idB=' + r.idB + ' idA=' + r.idA);
}
