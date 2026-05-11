// Session 26 — Decode flag/sub fields of the per-year event log at 0x87e9..0x846af.
// Goal: classify event-type enum by flag byte, cross-reference actor_hash against
// the 60 faction IDs from session 23's lua footer.

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

// Event log range
const START = 0x87e9, END = 0x846af;
const STRIDE = 12;
const N = (END - START) / STRIDE;
console.log('Event log: 0x' + START.toString(16) + '..0x' + END.toString(16) + ' = ' + (END-START) + ' bytes, ' + N + ' slots @ 12B');

// Build faction-ID map from lua footer parse
const FOOTER_START = 0x210f56f, FOOTER_END = 0x2110a23;
const factionIds = {};  // hash int -> faction name (lowercase)
{
  let p = FOOTER_START;
  while (p < FOOTER_END - 8) {
    const nameLen = buf.readUInt32LE(p);
    if (nameLen > 0 && nameLen < 100 && p + 4 + nameLen*2 + 4 <= FOOTER_END) {
      let s = ''; let valid = true;
      for (let i = 0; i < nameLen; i++) {
        const lo = buf[p+4+i*2], hi = buf[p+4+i*2+1];
        if (hi !== 0 || lo < 0x20 || lo > 0x7e) { valid = false; break; }
        s += String.fromCharCode(lo);
      }
      if (valid) {
        const valOff = p + 4 + nameLen*2;
        const v = buf.readUInt32LE(valOff);
        if (/^id_/.test(s)) factionIds[v >>> 0] = s.replace(/^id_/, '');
        p = valOff + 4;
        continue;
      }
    }
    p++;
  }
}
console.log('Loaded ' + Object.keys(factionIds).length + ' faction IDs from lua footer.');

// Parse all 12-byte records
const recs = [];
for (let i = 0; i < N; i++) {
  const o = START + i*STRIDE;
  const flag = buf[o];
  const sub  = buf[o+1];
  const idA  = buf.readUInt16LE(o+2);
  const idB  = buf.readUInt16LE(o+4);
  const z    = buf.readUInt16LE(o+6);
  const h    = buf.readUInt32LE(o+8) >>> 0;
  recs.push({i, off:o, flag, sub, idA, idB, z, h});
}

// Filter to "real" records: flag !=0 OR any field non-zero
const real = recs.filter(r => !(r.flag===0 && r.sub===0 && r.idA===0 && r.idB===0 && r.z===0 && r.h===0));
console.log('Real (non-zero) records:', real.length);

// FLAG byte distribution (full histogram)
const flagH = {};
for (const r of real) flagH[r.flag] = (flagH[r.flag]||0)+1;
console.log('\n=== FLAG byte distribution (top 20) ===');
Object.entries(flagH).sort((a,b)=>b[1]-a[1]).slice(0,20).forEach(([f,c])=>{
  console.log('  flag=0x' + parseInt(f).toString(16).padStart(2,'0') + ' (' + f + '): ' + c);
});
console.log('Distinct flag values:', Object.keys(flagH).length);

// SUB byte distribution
const subH = {};
for (const r of real) subH[r.sub] = (subH[r.sub]||0)+1;
console.log('\n=== SUB byte distribution (top 20) ===');
Object.entries(subH).sort((a,b)=>b[1]-a[1]).slice(0,20).forEach(([s,c])=>{
  console.log('  sub=0x' + parseInt(s).toString(16).padStart(2,'0') + ' (' + s + '): ' + c);
});
console.log('Distinct sub values:', Object.keys(subH).length);

// (flag, sub) joint distribution
const fsH = {};
for (const r of real) {
  const k = r.flag + ',' + r.sub;
  fsH[k] = (fsH[k]||0)+1;
}
console.log('\n=== (flag,sub) joint top 25 ===');
Object.entries(fsH).sort((a,b)=>b[1]-a[1]).slice(0,25).forEach(([k,c])=>{
  console.log('  (flag=' + k.split(',')[0] + ', sub=0x' + parseInt(k.split(',')[1]).toString(16).padStart(2,'0') + '): ' + c);
});

// Hash distribution - check against faction IDs
const hashH = {};
for (const r of real) hashH[r.h] = (hashH[r.h]||0)+1;
console.log('\n=== ACTOR HASH cross-reference with faction IDs (top 30) ===');
const topHash = Object.entries(hashH).sort((a,b)=>b[1]-a[1]).slice(0,30);
let factionHits = 0;
for (const [h, c] of topHash) {
  const hi = parseInt(h);
  const factName = factionIds[hi];
  if (factName) factionHits++;
  console.log('  0x' + hi.toString(16).padStart(8,'0') + ' (' + hi.toString().padStart(10) + '): ' + c.toString().padStart(5) + (factName ? ' = id_' + factName : ''));
}
console.log('Distinct hashes:', Object.keys(hashH).length);
console.log('Top-30 hashes matching faction IDs:', factionHits + '/30');

// Check ALL hashes against faction IDs
let allFactionHashHits = 0;
let allFactionRecordCount = 0;
for (const r of real) {
  if (factionIds[r.h]) {
    allFactionHashHits++;
    allFactionRecordCount += 1;
  }
}
let uniqueFactionHashes = 0;
for (const h of Object.keys(hashH)) {
  if (factionIds[parseInt(h)]) uniqueFactionHashes++;
}
console.log('\nFACTION HASH MATCHING:');
console.log('  Total records with actor_hash ∈ faction-IDs:', allFactionRecordCount, '/', real.length, '(' + (100*allFactionRecordCount/real.length).toFixed(1) + '%)');
console.log('  Unique faction-IDs found as actor_hash:', uniqueFactionHashes, '/', Object.keys(factionIds).length);

// Distribution by (flag, faction)
console.log('\n=== Top (flag, faction) pairings ===');
const flagFaction = {};
for (const r of real) {
  const fn = factionIds[r.h];
  if (!fn) continue;
  const k = r.flag + '|' + fn;
  flagFaction[k] = (flagFaction[k]||0)+1;
}
Object.entries(flagFaction).sort((a,b)=>b[1]-a[1]).slice(0,30).forEach(([k,c])=>{
  console.log('  flag=' + k.split('|')[0].padStart(3) + ' faction=' + k.split('|')[1].padEnd(20) + ' = ' + c);
});

// idB distribution (game year)
const idBmin = Math.min(...real.map(r=>r.idB));
const idBmax = Math.max(...real.map(r=>r.idB));
console.log('\nidB (year) range:', idBmin, '..', idBmax);

// Per-year event counts
const yearCounts = {};
for (const r of real) yearCounts[r.idB] = (yearCounts[r.idB]||0)+1;
const sortedYears = Object.keys(yearCounts).map(Number).sort((a,b)=>a-b);
console.log('Distinct years:', sortedYears.length);
if (sortedYears.length>0) {
  console.log('First 8 years (events/year):');
  sortedYears.slice(0,8).forEach(y=>console.log('  year=' + y + ' events=' + yearCounts[y]));
  console.log('Last 8 years:');
  sortedYears.slice(-8).forEach(y=>console.log('  year=' + y + ' events=' + yearCounts[y]));
}

// Cross-check: idB might not be year. Show histogram of idB ranges
const idBranges = {
  '0..100':0, '100..200':0, '200..275':0, '275..300':0, '300..400':0,
  '400..500':0, '500..600':0, '600..700':0, '700+':0,
};
for (const r of real) {
  const b = r.idB;
  if (b<100) idBranges['0..100']++;
  else if (b<200) idBranges['100..200']++;
  else if (b<275) idBranges['200..275']++;
  else if (b<300) idBranges['275..300']++;
  else if (b<400) idBranges['300..400']++;
  else if (b<500) idBranges['400..500']++;
  else if (b<600) idBranges['500..600']++;
  else if (b<700) idBranges['600..700']++;
  else idBranges['700+']++;
}
console.log('\nidB range histogram:');
Object.entries(idBranges).forEach(([k,v])=>console.log('  ' + k.padEnd(12) + ': ' + v));

// What is idA? Range?
const idAmin = Math.min(...real.map(r=>r.idA));
const idAmax = Math.max(...real.map(r=>r.idA));
console.log('\nidA range:', idAmin, '..', idAmax);
// Range of idA suggests target ID (settlement / region / character)

// Count flag=1 events at year <= 275 (lua footer's "num_battles_*" should match if flag=1=battle)
// Note: lua footer turn_number = 0, num_battles_seleucids_rome = 0 etc — all zero counters
// because rome10 is at game year ~275 (T5 = 5 turns after start)
// Just observe count per flag at first year
const firstYear = sortedYears[0];
const flagAtFirstYear = {};
for (const r of real) if (r.idB === firstYear) flagAtFirstYear[r.flag] = (flagAtFirstYear[r.flag]||0)+1;
console.log('\n=== Flag distribution AT FIRST YEAR ' + firstYear + ' ===');
Object.entries(flagAtFirstYear).sort((a,b)=>b[1]-a[1]).forEach(([f,c])=>{
  console.log('  flag=' + f + ': ' + c);
});

// Dump 20 sample records for each top flag
console.log('\n=== Sample records by flag (5 per flag) ===');
const flagSample = {};
for (const r of real) {
  if (!flagSample[r.flag]) flagSample[r.flag] = [];
  if (flagSample[r.flag].length < 5) flagSample[r.flag].push(r);
}
Object.keys(flagSample).sort((a,b)=>flagH[b]-flagH[a]).slice(0,8).forEach(f=>{
  console.log('flag=' + f + ' (' + flagH[f] + ' total):');
  flagSample[f].forEach(r=>{
    const fn = factionIds[r.h];
    console.log('  [' + r.i.toString().padStart(4) + '] off=0x' + r.off.toString(16) +
      ' f=' + r.flag + ' s=0x' + r.sub.toString(16).padStart(2,'0') +
      ' idA=' + r.idA.toString().padStart(5) + ' idB=' + r.idB.toString().padStart(4) +
      ' h=0x' + r.h.toString(16).padStart(8,'0') + (fn ? ' [' + fn + ']' : ''));
  });
});
