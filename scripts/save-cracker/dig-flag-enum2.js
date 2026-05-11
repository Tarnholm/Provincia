// Session 27 — Verify flag=4 "engine tick" hypothesis + sample top actors per (flag, sub).
// Hypotheses to test:
//   * flag=4 sub=0 = per-year engine-tick (hash=0; one per year?)
//   * flag=1 sub=0x20 = primary actor event
//   * flag=2 sub=0x20 = secondary actor event (maybe target-actor or counter-actor?)
//   * flag=0x35 (53) sub=0 (225 records) — what is this?
//   * sub=0x01 (221 records w/ flag=0) — distinct sub-event-class?

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

// Test 1: flag=4 sub=0 — one per year?
const f4 = recs.filter(r=>r.flag===4 && r.sub===0 && r.idB>0 && r.idB<800);
console.log('=== flag=4 sub=0 detailed analysis ===');
console.log('Total:', f4.length);
const yearH = {};
for (const r of f4) yearH[r.idB] = (yearH[r.idB]||0)+1;
const cts = Object.values(yearH);
const cthist = {};
for (const c of cts) cthist[c] = (cthist[c]||0)+1;
console.log('Events-per-year histogram (flag=4):');
Object.entries(cthist).sort((a,b)=>parseInt(a[0])-parseInt(b[0])).forEach(([n,c])=>console.log('  ' + n + ' events/year: ' + c + ' years'));
console.log('Min/max events/year:', Math.min(...cts), '/', Math.max(...cts));
console.log('Distinct years:', Object.keys(yearH).length, '(of 696 total)');

// Top actor hashes for flag=4
const f4hash = {};
for (const r of f4) f4hash[r.hash] = (f4hash[r.hash]||0)+1;
console.log('flag=4 distinct hashes:', Object.keys(f4hash).length);
console.log('Top 5 hashes:');
Object.entries(f4hash).sort((a,b)=>b[1]-a[1]).slice(0,5).forEach(([h,c])=>console.log('  0x' + parseInt(h).toString(16).padStart(8,'0') + ': ' + c));

// idA distribution for flag=4
const f4idA = f4.map(r=>r.idA);
console.log('flag=4 idA range:', Math.min(...f4idA), '..', Math.max(...f4idA));
const f4idAH = {};
for (const r of f4) f4idAH[r.idA] = (f4idAH[r.idA]||0)+1;
console.log('flag=4 most common idA values:');
Object.entries(f4idAH).sort((a,b)=>b[1]-a[1]).slice(0,8).forEach(([a,c])=>console.log('  idA=' + a + ': ' + c));

// Years with >1 flag=4 record — what's repeating?
const dupYears = Object.entries(yearH).filter(([y,c])=>c>1);
console.log('\nYears with >1 flag=4 record:', dupYears.length);
if (dupYears.length > 0) {
  dupYears.slice(0,5).forEach(([y,c])=>{
    console.log('  year=' + y + ' has ' + c + ' flag=4 records');
    const here = f4.filter(r=>r.idB===parseInt(y));
    here.slice(0,5).forEach(r=>console.log('    idA=' + r.idA + ' hash=0x' + r.hash.toString(16).padStart(8,'0')));
  });
}

// What about idB=270 — game start year? How many flag=4 there?
console.log('\nflag=4 records at idB=270 (game start):', f4.filter(r=>r.idB===270).length);
console.log('flag=4 records at idB=275 (T5):', f4.filter(r=>r.idB===275).length);
console.log('flag=4 records at idB=696 (last year):', f4.filter(r=>r.idB===696).length);

// Test 2: flag=1 vs flag=2 — are the same actors involved? Or different sets?
console.log('\n=== flag=1 vs flag=2 actor overlap ===');
const f1 = recs.filter(r=>r.flag===1 && r.sub===0x20 && r.idB>0 && r.idB<800);
const f2 = recs.filter(r=>r.flag===2 && r.sub===0x20 && r.idB>0 && r.idB<800);
const f1h = new Set(f1.map(r=>r.hash));
const f2h = new Set(f2.map(r=>r.hash));
const overlap = [...f2h].filter(h=>f1h.has(h));
console.log('flag=1 distinct hashes:', f1h.size);
console.log('flag=2 distinct hashes:', f2h.size);
console.log('overlap:', overlap.length, '(' + (100*overlap.length/f2h.size).toFixed(1) + '% of flag=2 actors)');

// For overlapping actors — are flag=2 records co-located in TIME with flag=1?
const co = {};
const f1byh = {};
for (const r of f1) {
  if (!f1byh[r.hash]) f1byh[r.hash] = [];
  f1byh[r.hash].push(r);
}
let same_year = 0, diff_year = 0;
for (const r of f2) {
  if (f1byh[r.hash]) {
    const hasSameYear = f1byh[r.hash].some(r2=>r2.idB === r.idB);
    if (hasSameYear) same_year++;
    else diff_year++;
  }
}
console.log('flag=2 records with overlapping actor — same-year as flag=1:', same_year, 'different-year:', diff_year);

// Test 3: flag=0x35 (53) — 225 records, what's their pattern?
console.log('\n=== flag=0x35 (53) sub=0 ===');
const f53 = recs.filter(r=>r.flag===0x35 && r.sub===0);
const f53yH = {};
for (const r of f53) f53yH[r.idB] = (f53yH[r.idB]||0)+1;
const f53years = Object.keys(f53yH).map(Number).sort((a,b)=>a-b);
console.log('Total:', f53.length, 'distinct years:', f53years.length);
console.log('Year range:', f53years[0], '..', f53years[f53years.length-1]);
const f53hashes = new Set(f53.map(r=>r.hash));
console.log('Distinct hashes:', f53hashes.size);
const f53hH = {};
for (const r of f53) f53hH[r.hash] = (f53hH[r.hash]||0)+1;
console.log('Top hashes:');
Object.entries(f53hH).sort((a,b)=>b[1]-a[1]).slice(0,5).forEach(([h,c])=>console.log('  0x' + parseInt(h).toString(16).padStart(8,'0') + ': ' + c));
console.log('idB values (first 30):', f53years.slice(0,30).join(','));

// Test 4: sub=0x01 with flag=0 — 221 records
console.log('\n=== flag=0 sub=0x01 (221 records) ===');
const f0s1 = recs.filter(r=>r.flag===0 && r.sub===1);
const f0s1yH = {};
for (const r of f0s1) f0s1yH[r.idB] = (f0s1yH[r.idB]||0)+1;
const f0s1years = Object.keys(f0s1yH).map(Number).sort((a,b)=>a-b);
console.log('Total:', f0s1.length, 'distinct years:', f0s1years.length);
console.log('Year range:', f0s1years[0], '..', f0s1years[f0s1years.length-1]);
console.log('idB values (first 30):', f0s1years.slice(0,30).join(','));
console.log('Distinct hashes:', new Set(f0s1.map(r=>r.hash)).size);
const f0s1hH = {};
for (const r of f0s1) f0s1hH[r.hash] = (f0s1hH[r.hash]||0)+1;
console.log('Top hashes:');
Object.entries(f0s1hH).sort((a,b)=>b[1]-a[1]).slice(0,5).forEach(([h,c])=>console.log('  0x' + parseInt(h).toString(16).padStart(8,'0') + ': ' + c));
console.log('Sample 5 records:');
f0s1.slice(0,5).forEach(r=>console.log('  o=0x' + r.o.toString(16) + ' hash=0x' + r.hash.toString(16).padStart(8,'0') + ' idA=' + r.idA + ' idB=' + r.idB));

// Test 5: How often does a given actor appear in (flag=1, sub=0x20) only? In flag=2 only? Or BOTH?
console.log('\n=== Actor flag-profile distribution ===');
const actorProfile = {};
const validRecs = recs.filter(r=>(r.flag===1||r.flag===2||r.flag===4) && (r.sub===0||r.sub===0x20) && r.idB > 0 && r.idB < 800);
for (const r of validRecs) {
  if (!actorProfile[r.hash]) actorProfile[r.hash] = new Set();
  actorProfile[r.hash].add(r.flag + ',' + r.sub);
}
const profileH = {};
for (const [h, ps] of Object.entries(actorProfile)) {
  const k = [...ps].sort().join('|');
  profileH[k] = (profileH[k]||0)+1;
}
console.log('Profiles (actor → flag-set):');
Object.entries(profileH).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([k,c])=>console.log('  ' + k + ': ' + c + ' actors'));
