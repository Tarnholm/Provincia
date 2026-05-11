// Session 27 — Three quick validation tests:
// 1. Verify the sorted main block is sorted by (idB, idA) - check all years
// 2. Check the tail's "256" cluster more carefully — it has named actor hashes
// 3. Cross-validate idB→year mapping with idA structure (do early idBs have idA=0 mostly?)

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

// Find boundary
let boundary = -1;
for (let i = 1; i < valid.length; i++) {
  if (valid[i].idB < valid[i-1].idB - 10) { boundary = i; break; }
}
const main = valid.slice(0, boundary);
const tail = valid.slice(boundary);

// Test 1: verify ALL years are sorted by idA
console.log('=== Verify within-year idA sort across ALL years ===');
let totalYears = 0, sortedYears = 0;
const byYear = {};
for (const r of main) {
  if (!byYear[r.idB]) byYear[r.idB] = [];
  byYear[r.idB].push(r);
}
for (const [y, rs] of Object.entries(byYear)) {
  totalYears++;
  let asc = true;
  for (let i=1; i<rs.length; i++) if (rs[i].idA < rs[i-1].idA) { asc = false; break; }
  if (asc) sortedYears++;
  else {
    console.log('  UNSORTED year idB=' + y + ' n=' + rs.length + ' idAs=' + rs.slice(0,10).map(r=>r.idA).join(','));
  }
}
console.log('Sorted years:', sortedYears, '/', totalYears);

// Test 2: tail "256" cluster
const tail256 = tail.filter(r=>r.idB === 256);
console.log('\n=== Tail records with idB=256 ===');
console.log('Count:', tail256.length);
const hashes256 = tail256.map(r=>r.hash);
console.log('Hashes:', hashes256.map(h=>'0x' + h.toString(16).padStart(8,'0')).join(','));
const zeroCount = hashes256.filter(h=>h===0).length;
const namedCount = hashes256.filter(h=>h!==0).length;
console.log('Zero hash:', zeroCount, 'Named:', namedCount);
console.log('Named hashes:', tail256.filter(r=>r.hash!==0).map(r=>'0x' + r.hash.toString(16).padStart(8,'0')).join(','));

// Are these the SAME hashes as the longest-range main-block actors (from previous run: a2d46353, c3f71ce3, 6e0ce84a, 1bd7e234)?
// Previous: those actors had the "256" idB value in their record set
const named256 = tail256.filter(r=>r.hash!==0).map(r=>r.hash);
const previouslyKnownLong = [0xa2d46353, 0xc3f71ce3, 0x6e0ce84a, 0x1bd7e234, 0xb53a6c46];
console.log('Match with prev long-range actors:', named256.map(h=>previouslyKnownLong.includes(h)));

// In the main block, do those actors have records with idB=256?
for (const h of [0xa2d46353, 0xc3f71ce3, 0x6e0ce84a, 0x1bd7e234]) {
  const mainOccs = main.filter(r=>r.hash === h);
  const tail256Occs = tail256.filter(r=>r.hash === h);
  const has256 = mainOccs.some(r=>r.idB === 256);
  console.log('  actor 0x' + h.toString(16).padStart(8,'0') + ' — main records=' + mainOccs.length + ' (has idB=256 in main? ' + has256 + ') tail idB=256 count=' + tail256Occs.length);
}

// Test 3: idA structure for early idBs (1..50) vs main block (idB=300+)
console.log('\n=== idA distribution by year-bucket (main block) ===');
for (const [name, filter] of [
  ['idB=1..50',   r=>r.idB >= 1 && r.idB <= 50],
  ['idB=51..150', r=>r.idB > 50 && r.idB <= 150],
  ['idB=151..250', r=>r.idB > 150 && r.idB <= 250],
  ['idB=251..350', r=>r.idB > 250 && r.idB <= 350],
  ['idB=351..450', r=>r.idB > 350 && r.idB <= 450],
  ['idB=451..550', r=>r.idB > 450 && r.idB <= 550],
  ['idB=551..650', r=>r.idB > 550 && r.idB <= 650],
  ['idB=651..696', r=>r.idB > 650],
]) {
  const here = main.filter(filter);
  if (here.length === 0) continue;
  const idAs = here.map(r=>r.idA);
  console.log('  ' + name + ' n=' + here.length + ' idA min/max/mean=' + Math.min(...idAs) + '/' + Math.max(...idAs) + '/' + (idAs.reduce((s,a)=>s+a,0)/idAs.length).toFixed(0));
}

// Test 4: cross-save comparison
// Check rome10 main-block vs the ROR T1 — do they have the same idB distribution?
const ROR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav';
if (require('fs').existsSync(ROR)) {
  const rb = fs.readFileSync(ROR);
  // Find log via pattern scan
  let bestOff = -1, bestCount = 0;
  for (let cand = 0x5000; cand < 0x10000; cand += 0x100) {
    let c = 0;
    for (let j=0; j<1000; j++) {
      const o = cand + j*12;
      if (o+12 > rb.length) break;
      const flag = rb[o+4], sub = rb[o+5];
      const idA = rb.readUInt16LE(o+6);
      const idB = rb.readUInt32LE(o+8);
      if ((flag===1||flag===2||flag===4) && (sub===0||sub===0x20) && idB>0 && idB<800 && idA<4096) c++;
    }
    if (c > bestCount) { bestCount = c; bestOff = cand; }
  }
  // Parse
  const tryEnd = Math.min(bestOff + 521466, rb.length);
  const RN = Math.floor((tryEnd - bestOff) / 12);
  const rorRecs = [];
  for (let i=0; i<RN; i++) {
    const o = bestOff + i*12;
    rorRecs.push({i, o,
      hash: rb.readUInt32LE(o), flag: rb[o+4], sub: rb[o+5],
      idA: rb.readUInt16LE(o+6), idB: rb.readUInt32LE(o+8)});
  }
  const rorValid = rorRecs.filter(r=>(r.flag===1||r.flag===2||r.flag===4) && (r.sub===0||r.sub===0x20) && r.idB > 0 && r.idB < 800 && r.idA < 4096);
  console.log('\n=== RoR T1 event log ===');
  console.log('Best offset: 0x' + bestOff.toString(16) + ' valid records: ' + rorValid.length);

  const rorYearH = {};
  for (const r of rorValid) {
    const b = Math.floor(r.idB / 25) * 25;
    rorYearH[b] = (rorYearH[b]||0)+1;
  }
  console.log('RoR T1 idB distribution:');
  Object.entries(rorYearH).sort((a,b)=>parseInt(a[0])-parseInt(b[0])).forEach(([b,c])=>{
    const bar = '#'.repeat(Math.floor(c/20));
    console.log('  idB=' + b.padStart(4) + ': ' + c.toString().padStart(5) + ' ' + bar);
  });

  // Find boundary in RoR T1
  let rorBoundary = -1;
  for (let i = 1; i < rorValid.length; i++) {
    if (rorValid[i].idB < rorValid[i-1].idB - 10) { rorBoundary = i; break; }
  }
  console.log('RoR T1 sorted-block boundary: i=' + rorBoundary + ' / ' + rorValid.length);
  if (rorBoundary > 0 && rorBoundary < rorValid.length) {
    const rorTail = rorValid.slice(rorBoundary);
    console.log('RoR T1 tail size:', rorTail.length, 'records');
    if (rorTail.length > 0 && rorTail.length < 20) {
      console.log('Tail records:');
      rorTail.forEach(r=>console.log('  flag=' + r.flag + ' sub=0x' + r.sub.toString(16) + ' idA=' + r.idA + ' idB=' + r.idB + ' hash=0x' + r.hash.toString(16).padStart(8,'0')));
    }
  }
}
