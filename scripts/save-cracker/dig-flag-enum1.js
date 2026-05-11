// Session 27 — Decode flag/sub enums in the unified event log.
// Map flag/sub -> { years, repeating actors, year-density, pre/post game-start }

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

// Use ALL non-zero records (do not filter by flag yet, want to see ALL flag/sub combos)
const nonzero = recs.filter(r=>!(r.hash===0 && r.flag===0 && r.sub===0 && r.idA===0 && r.idB===0));
console.log('Non-zero records:', nonzero.length, '/', recs.length);

// Flag distribution
const flagH = {};
for (const r of nonzero) flagH[r.flag] = (flagH[r.flag]||0)+1;
console.log('\n=== Flag-byte frequency (ALL non-zero records) ===');
Object.entries(flagH).sort((a,b)=>b[1]-a[1]).forEach(([f,c])=>{
  console.log('  flag=0x' + parseInt(f).toString(16).padStart(2,'0') + ' (' + f.padStart(3) + '): ' + c.toString().padStart(6));
});

// Sub distribution
const subH = {};
for (const r of nonzero) subH[r.sub] = (subH[r.sub]||0)+1;
console.log('\n=== Sub-byte frequency ===');
Object.entries(subH).sort((a,b)=>b[1]-a[1]).slice(0,15).forEach(([s,c])=>{
  console.log('  sub=0x' + parseInt(s).toString(16).padStart(2,'0') + ' (' + s.padStart(3) + '): ' + c.toString().padStart(6));
});

// Joint (flag, sub) distribution
const fsH = {};
for (const r of nonzero) {
  const k = r.flag + ',' + r.sub;
  fsH[k] = (fsH[k]||0)+1;
}
console.log('\n=== (flag, sub) joint distribution (top 30) ===');
Object.entries(fsH).sort((a,b)=>b[1]-a[1]).slice(0,30).forEach(([k,c])=>{
  const [f,s] = k.split(',').map(Number);
  console.log('  flag=0x' + f.toString(16).padStart(2,'0') + ' sub=0x' + s.toString(16).padStart(2,'0') + ': ' + c.toString().padStart(5));
});

console.log('\nDistinct (flag, sub) combos:', Object.keys(fsH).length);

// Apply validity filter and continue
const valid = recs.filter(r=>(r.flag===1||r.flag===2||r.flag===4) && (r.sub===0||r.sub===0x20) && r.idB > 0 && r.idB < 800 && r.idA < 4096);
console.log('\n=== After validity filter ===');
console.log('Valid records:', valid.length);

// Per-(flag, sub) — year distribution + actor repetition
console.log('\n=== Per (flag, sub) — year-density + actor-repetition ===');
const FSCombos = Object.entries(fsH).sort((a,b)=>b[1]-a[1]).slice(0, 12);
for (const [k, totalCount] of FSCombos) {
  const [f, s] = k.split(',').map(Number);
  // Get only "valid" records with this (f, s)
  const here = valid.filter(r=>r.flag===f && r.sub===s);
  if (here.length === 0) continue;
  const years = here.map(r=>r.idB);
  const yearH = {};
  for (const y of years) yearH[y] = (yearH[y]||0)+1;
  const minY = Math.min(...years), maxY = Math.max(...years);
  const distinctY = Object.keys(yearH).length;

  // Actor repetition
  const hashes = here.map(r=>r.hash);
  const hashH = {};
  for (const h of hashes) hashH[h] = (hashH[h]||0)+1;
  const distinctH = Object.keys(hashH).length;
  const zerohashCnt = hashH[0] || 0;
  const maxPerHash = Math.max(...Object.values(hashH));

  // Pre/post game-start (idB < 270 vs idB >= 270)
  const preGame = here.filter(r=>r.idB < 270).length;
  const postGame = here.filter(r=>r.idB >= 270).length;

  console.log('  flag=0x' + f.toString(16).padStart(2,'0') + ' sub=0x' + s.toString(16).padStart(2,'0') + ' n=' + here.length +
              ' yearRange=' + minY + '-' + maxY + ' distinctYears=' + distinctY +
              ' distinctActors=' + distinctH + ' maxPerActor=' + maxPerHash +
              ' zeroHash=' + zerohashCnt + ' preGame=' + preGame + ' postGame=' + postGame);
}

// Look at distribution per-year for each (flag, sub)
// Per-year-count histogram
console.log('\n=== Per (flag, sub) — events-per-year histogram (post-game-start years 270..) ===');
for (const [k, totalCount] of FSCombos) {
  const [f, s] = k.split(',').map(Number);
  const here = valid.filter(r=>r.flag===f && r.sub===s && r.idB >= 270);
  if (here.length === 0) continue;
  const yearCt = {};
  for (const r of here) yearCt[r.idB] = (yearCt[r.idB]||0)+1;
  const cts = Object.values(yearCt);
  cts.sort((a,b)=>b-a);
  const top5 = cts.slice(0,5).join(',');
  const median = cts[Math.floor(cts.length/2)];
  console.log('  flag=' + f + ' sub=0x' + s.toString(16) + ' n=' + here.length +
              ' years=' + Object.keys(yearCt).length + ' top5 ct=' + top5 + ' median ct=' + median);
}
