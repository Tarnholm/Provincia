// Session 27 — Investigate the "append-zone tail" after the sorted main block.
// After i=13874 (file-offset 0x2e4e9), monotonicity breaks. These ~73 records have low idB (1-256).
// Hypothesis: these are events generated DURING gameplay (T1..T5), appended to the log in insertion order.

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

// Find boundary: where does monotonicity break?
let boundary = -1;
for (let i = 1; i < valid.length; i++) {
  if (valid[i].idB < valid[i-1].idB - 10) {  // Big regression
    boundary = i;
    break;
  }
}
console.log('Sorted-block ends at i=' + boundary + ' file-offset=0x' + valid[boundary].o.toString(16));
console.log('Sorted block size:', boundary, 'records');
console.log('Tail (append-zone) size:', valid.length - boundary, 'records');

// Tail records — show all
console.log('\n=== Append-zone tail (' + (valid.length - boundary) + ' records) ===');
const tailRecs = valid.slice(boundary);
console.log('idB values:', tailRecs.map(r=>r.idB).sort((a,b)=>a-b).join(','));
console.log('idA values:', tailRecs.map(r=>r.idA).join(','));
console.log('flags:', tailRecs.map(r=>r.flag).join(','));

console.log('\nFull tail records:');
tailRecs.forEach((r,i)=>{
  console.log('  [' + i + '] o=0x' + r.o.toString(16) + ' flag=' + r.flag + ' sub=0x' + r.sub.toString(16) + ' idA=' + r.idA + ' idB=' + r.idB + ' hash=0x' + r.hash.toString(16).padStart(8,'0'));
});

// Test: compare tail-hashes against the most-frequent main-block hashes
const mainBlock = valid.slice(0, boundary);
const tailHashes = new Set(tailRecs.map(r=>r.hash));
const mainHashes = new Set(mainBlock.map(r=>r.hash));
const overlap = [...tailHashes].filter(h=>mainHashes.has(h));
console.log('\n=== Tail vs main block hash overlap ===');
console.log('Tail distinct hashes:', tailHashes.size);
console.log('Main distinct hashes:', mainHashes.size);
console.log('Overlap:', overlap.length);

// If tail represents recently-generated events, low overlap = new characters not in main
// High overlap = same characters but new events

// What's the actual byte structure between main-block end and tail start?
// At i=13874, file offset is 0x2e4e9. Find first append in same byte zone:
console.log('\n=== Byte context at sorted-block boundary ===');
const boundaryOff = valid[boundary].o;
for (let off = boundaryOff - 24; off < boundaryOff + 36; off += 12) {
  const slice = buf.subarray(off, off+12);
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  console.log('  0x' + off.toString(16) + ': ' + hex);
}

// Are sorted-block records sorted by (idB, hash, idA)? Check secondary-key
console.log('\n=== Sorted-block: secondary-key analysis (within same idB) ===');
const sampleYear = 412;
const sampleRecs = mainBlock.filter(r=>r.idB === sampleYear);
console.log('idB=' + sampleYear + ' records:');
sampleRecs.slice(0,15).forEach(r=>console.log('  i=' + r.i + ' flag=' + r.flag + ' hash=0x' + r.hash.toString(16).padStart(8,'0') + ' idA=' + r.idA));

// Are records sorted by hash within a year? Or by idA?
// Show sequential idA for same year
console.log('\n  idAs for year ' + sampleYear + ':', sampleRecs.map(r=>r.idA).join(','));
// Are they sorted ascending?
const idAs = sampleRecs.map(r=>r.idA);
let asc = true;
for (let i=1; i<idAs.length; i++) if (idAs[i] < idAs[i-1]) { asc = false; break; }
console.log('  idAs sorted ascending?', asc);

// Check 5 random years
const rng = (a,b)=>a + Math.floor(Math.random()*(b-a));
console.log('\n=== Secondary-sort within year (5 sample years) ===');
const sampledYears = [301, 350, 400, 475, 525];
for (const y of sampledYears) {
  const here = mainBlock.filter(r=>r.idB === y);
  if (here.length < 3) continue;
  let ascA = true;
  for (let i=1;i<here.length;i++) if (here[i].idA < here[i-1].idA) { ascA = false; break; }
  console.log('  idB=' + y + ' n=' + here.length + ' idAs sorted ascending? ' + ascA + ' first 10 idAs: ' + here.slice(0,10).map(r=>r.idA).join(','));
}

// Sub-byte and rare-flag tail behaviour
console.log('\n=== Tail flag/sub combos ===');
const tailFs = {};
for (const r of tailRecs) tailFs[r.flag+','+r.sub] = (tailFs[r.flag+','+r.sub]||0)+1;
Object.entries(tailFs).forEach(([k,c])=>console.log('  flag=' + k.split(',')[0] + ' sub=0x' + parseInt(k.split(',')[1]).toString(16) + ': ' + c));

// CONFIRMATION: What's the largest "valid record" gap (file-offset gap) between consecutive sorted-block records?
// If the sorted block is contiguous, there should be NO non-zero slots between idB values
// If there ARE gaps, those gaps are filled with empty/zero slots (the 22315 zero slots)
let gaps = [];
for (let i = 1; i < boundary; i++) {
  const gap = valid[i].i - valid[i-1].i;
  if (gap > 1) gaps.push({i, gap, idB: valid[i].idB});
}
gaps.sort((a,b)=>b.gap-a.gap);
console.log('\n=== Sorted-block: largest record-index gaps (zero-fill regions) ===');
gaps.slice(0,10).forEach(g=>console.log('  i=' + g.i + ' (idB=' + g.idB + ') gap=' + g.gap));
console.log('Mean gap:', gaps.reduce((s,g)=>s+g.gap,0)/gaps.length);
console.log('Total gaps (non-adjacent valid records):', gaps.length);
