// Session 27 — Test new hypothesis: event log is "scheduled future events" pre-populated by RIS script.
// If true: events span many "future years" because the RIS campaign script schedules them all at start
// (e.g. "in year 350, character X comes of age"; "in year 412, scripted rebellion at region Y")

// Test 1: in the T5 save (turn=5 = elapsed 5 years), how many events have already fired?
// We need a "fired/pending" flag. Let's look at neighboring bytes to the 12B record to see if there's metadata

// Test 2: compare T1 archive vs T5 — if idB is "scheduled year", T5 should have FEWER pending (more fired)
// But the archive shows ~100 records consistent across turns => log size doesn't change with turns
// So they're not "events that have fired" but "events that will fire"

// Test 3: check if the densest records cluster around RIS calendar events: Punic Wars at 264 BC = year 6,
// Carthaginian fall at 146 BC = year 124, etc. Map idB→year: if idB=270 = 0 BC = year 0, max idB=696 = year 426 AD.

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

// Test 1: Strictly verify monotonicity in file order
console.log('=== File-order vs idB monotonicity (global) ===');
let prevIdb = 0;
let breakCount = 0;
let lastBreakAt = -1;
for (let i = 0; i < valid.length; i++) {
  if (valid[i].idB < prevIdb) {
    breakCount++;
    if (breakCount <= 5) console.log('  break at i=' + i + ' file-offset=0x' + valid[i].o.toString(16) + ' idB went ' + prevIdb + ' -> ' + valid[i].idB);
    lastBreakAt = i;
  }
  prevIdb = valid[i].idB;
}
console.log('Total monotonic-breaks:', breakCount);
console.log('Last break at i=' + lastBreakAt);

// Show the records near the last break
if (lastBreakAt > 0) {
  console.log('Records around last break:');
  for (let i = Math.max(0, lastBreakAt-3); i < Math.min(valid.length, lastBreakAt+3); i++) {
    const r = valid[i];
    console.log('  i=' + i + ' o=0x' + r.o.toString(16) + ' flag=' + r.flag + ' idB=' + r.idB);
  }
}

// Test 2: Compute "transition offsets" where idB jumps. Each year-block should be contiguous.
const yearBlocks = [];
let curYear = -1, blockStart = -1;
for (let i = 0; i < valid.length; i++) {
  if (valid[i].idB !== curYear) {
    if (curYear !== -1) yearBlocks.push({year: curYear, start: blockStart, end: i, count: i-blockStart});
    curYear = valid[i].idB;
    blockStart = i;
  }
}
if (curYear !== -1) yearBlocks.push({year: curYear, start: blockStart, end: valid.length, count: valid.length-blockStart});
console.log('\nDistinct year-blocks in file order:', yearBlocks.length, ' (expected =', new Set(valid.map(r=>r.idB)).size, ')');

// Test 3: Are the densest years actually concentrated around historically meaningful Roman years?
// RIS imperial = 270 BC start. If idB=year_BC_or_AD with offset 0=270BC:
// idB=270 = 0 (transition BC->AD)
// idB=350 = AD 80 — peak of empire under Domitian
// idB=400 = AD 130 — Hadrian
// idB=450 = AD 180 — end of Antonines
// peaks at 350-450 = AD 80-180 = roughly "Pax Romana"
//
// Alternative: idB=year_offset_from_game_start (so 0 BC = idB=0, 270 BC = idB=0)
// Then game start = idB=0, peak = idB=350 = 80 BC ... doesn't match anyway

// Plot: by mapping idB -> historical year
console.log('\n=== Map idB -> calendar year if game-start = idB=270 (270 BC) ===');
const eventsByCalYear = {};
for (const r of valid) {
  if (r.idB < 270) continue;
  const calYr = -270 + (r.idB - 0);  // Should idB=270 = -270 BC? Then year_BC = -(idB - 0)
  // Wait actually: per session 26 idB=270 = game start = 270 BC = year -270
  // So calYr = idB - 540?
  // Or: calYr = idB - 270 - 270 = idB - 540? Let's check.
  // If idB=270 = 270 BC and idB=696 = AD 426, then idB->calYear is linear:
  // idB=270 -> -270, idB=696 -> +426
  // slope = (426 - (-270)) / (696-270) = 696/426 ≈ 1.63 — NOT linear
  // Linear if idB=year_AD_or_BC_offset_by_270:
  // idB=270 -> 0 BC (year 0); idB=696 -> AD 426 - 270 = ?
  // Doesn't work.
  // Try: idB=270 -> 270 BC; idB=696 -> AD 426. Then calYr_BC = -idB+270 if idB<=270 else +(idB-540)
  // No, the simplest: idB IS the year number, with year 270 = AD start? Let's try:
  // idB=270 corresponds to year 0, so idB=270 = year 0, idB=1 = year -269... but session 26 said idB=270 = game start = 270 BC.
  // I think idB is just a 1-indexed year-of-campaign: idB=1 = first year, idB=696 = last year. T5 save = year 5
  // would have events at idB=1..5, but log shows most at idB=350-450. Sigh.
  //
  // Let me just present the raw distribution
}

// Distribution of idB across the file
console.log('\n=== Raw idB distribution by buckets of 25 ===');
const b25 = {};
for (const r of valid) {
  const b = Math.floor(r.idB / 25) * 25;
  b25[b] = (b25[b]||0)+1;
}
Object.entries(b25).sort((a,b)=>parseInt(a[0])-parseInt(b[0])).forEach(([b,c])=>{
  const bar = '#'.repeat(Math.floor(c/20));
  console.log('  idB ' + b.padStart(4) + '..' + (parseInt(b)+24).toString().padStart(3) + ': ' + c.toString().padStart(5) + ' ' + bar);
});

// Test 4: Are there gaps in the year-blocks? E.g., are there missing years?
const yearsWithEvents = new Set(valid.map(r=>r.idB));
const allYears = Array.from(yearsWithEvents).sort((a,b)=>a-b);
console.log('\n=== Years with valid events: ===');
console.log('Total distinct years:', allYears.length);
console.log('Min year:', allYears[0], 'Max year:', allYears[allYears.length-1]);
const missing = [];
for (let y = allYears[0]; y <= allYears[allYears.length-1]; y++) {
  if (!yearsWithEvents.has(y)) missing.push(y);
}
console.log('Missing years in range:', missing.length);
console.log('First 30 missing:', missing.slice(0,30).join(','));

// Test 5: Check the "anti-record" at i=30454 — the one at idB=8 that broke monotonicity
console.log('\n=== Anti-record context (records around i=30454 in raw recs) ===');
// recs is full unfiltered. Find idx
const breakRec = valid.find((r,i)=>i>20 && r.idB < valid[i-1].idB);
if (breakRec) {
  console.log('First valid-array break at file-offset 0x' + breakRec.o.toString(16) + ' idB=' + breakRec.idB);
  // Look at file context
  const idxInRecs = recs.findIndex(r=>r.o === breakRec.o);
  console.log('Raw context records around offset 0x' + breakRec.o.toString(16) + ':');
  for (let i = Math.max(0, idxInRecs-3); i < Math.min(recs.length, idxInRecs+5); i++) {
    const r = recs[i];
    console.log('  i=' + i + ' o=0x' + r.o.toString(16) + ' flag=' + r.flag + ' sub=' + r.sub + ' idA=' + r.idA + ' idB=' + r.idB + ' hash=0x' + r.hash.toString(16).padStart(8,'0'));
  }
}
