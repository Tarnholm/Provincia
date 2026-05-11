// Session 27 — Final investigation: what does (a, b) mean in the per-tile registry?
// Hypothesis: (a, b) encodes a scripted-event type + sub-type. The 5,632 records are pre-populated
// across the map with diverse scripted-event slots (a=event-class, b=intensity-level, X/Y=tile).

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

const REGION_START = 0x84f1f, STRIDE = 26, N_RECS = 5632;
const recs = [];
for (let i = 0; i < N_RECS; i++) {
  const o = REGION_START + i*STRIDE;
  recs.push({
    i, o, a: buf.readUInt32LE(o), b: buf.readUInt32LE(o+4),
    X: buf.readUInt32LE(o+8), Y: buf.readUInt32LE(o+12),
    hash: buf.readUInt32LE(o+16), flag1: buf[o+24]
  });
}

// (a, b) co-occurrence: are some (a, b) pairs always together?
console.log('=== All (a, b) combos with count >= 5 ===');
const abH = {};
for (const r of recs) abH[r.a+','+r.b] = (abH[r.a+','+r.b]||0)+1;
const sorted = Object.entries(abH).sort((a,b)=>b[1]-a[1]);
console.log('Total distinct (a, b) combos:', sorted.length);
sorted.filter(([k,c])=>c>=5).forEach(([k,c])=>{
  const [a,b] = k.split(',');
  console.log('  a=' + a.padStart(3) + ' b=' + b + ': ' + c);
});

// For (a=9, b=1, flag1=0) — what's the spatial distribution?
const a9b1f0 = recs.filter(r=>r.a===9 && r.b===1 && r.flag1===0);
console.log('\n=== (a=9, b=1, flag1=0) records: ' + a9b1f0.length + ' ===');
// Show extreme coords
const xs = a9b1f0.map(r=>r.X).sort((a,b)=>a-b);
const ys = a9b1f0.map(r=>r.Y).sort((a,b)=>a-b);
console.log('X range:', xs[0], '..', xs[xs.length-1]);
console.log('Y range:', ys[0], '..', ys[ys.length-1]);
console.log('X median:', xs[Math.floor(xs.length/2)]);
console.log('Y median:', ys[Math.floor(ys.length/2)]);

// Sample 30 records
console.log('Sample records:');
a9b1f0.slice(0, 30).forEach(r=>console.log('  (' + r.X.toString().padStart(4) + ',' + r.Y.toString().padStart(4) + ') hash=0x' + r.hash.toString(16).padStart(8,'0')));

// Compare against b values - are b=3,4,5 records spatially distinct?
// Looking at the heatmap, the b=5 cluster around (520, 230) might be Egypt-only
console.log('\n=== b=5 records (only 19) ===');
const b5 = recs.filter(r=>r.b===5);
b5.forEach(r=>console.log('  (' + r.X.toString().padStart(4) + ',' + r.Y.toString().padStart(4) + ') a=' + r.a.toString().padStart(3) + ' hash=0x' + r.hash.toString(16).padStart(8,'0') + ' flag1=' + r.flag1));

// Are b=5 records on specific tiles? Like settlements?
// And b=4 (101 records)?
const b4 = recs.filter(r=>r.b===4);
console.log('\n=== b=4 records (101) — sample 10 ===');
b4.slice(0,10).forEach(r=>console.log('  (' + r.X.toString().padStart(4) + ',' + r.Y.toString().padStart(4) + ') a=' + r.a + ' hash=0x' + r.hash.toString(16).padStart(8,'0')));

// Per session 26 b=1..5 = "event category". Let me try semantically:
// b=1 (3313) = most common — barbarian invasion? or rebellion zones?
// b=2 (1757) = secondary  — civil-war trigger?
// b=3 (442)  = tertiary
// b=4 (101)  = rare event
// b=5 (19)   = very rare

// Look at coordinate clustering of each b
console.log('\n=== Per-b coord clustering (centroid + spread) ===');
for (let bv = 1; bv <= 5; bv++) {
  const here = recs.filter(r=>r.b === bv);
  if (here.length === 0) continue;
  const cx = here.reduce((s,r)=>s+r.X, 0) / here.length;
  const cy = here.reduce((s,r)=>s+r.Y, 0) / here.length;
  const sx = Math.sqrt(here.reduce((s,r)=>s+(r.X-cx)**2, 0) / here.length);
  const sy = Math.sqrt(here.reduce((s,r)=>s+(r.Y-cy)**2, 0) / here.length);
  console.log('  b=' + bv + ' n=' + here.length + ' centroid=(' + cx.toFixed(0) + ',' + cy.toFixed(0) + ') stddev=(' + sx.toFixed(0) + ',' + sy.toFixed(0) + ')');
}

// Maybe (a) = "wave number" (like nth-occurrence)? With a=9 being the most common ("9 occurrences")
// And b = total occurrences (like "fired N times so far")?
// Or a/b = pairs of event-counters for different event-classes?

// Test: total records / 5 categories of b = 5632/5 = ~1126 records per category — matches (a=9,b=1) count of 1305
// So roughly each b-category gets ~1100 records on average

// Cross-check: do the (a, b) values relate to scripted-event-trigger probabilities?
// In RIS campaign script, each tile might have N=a trigger-counters across M=b event-categories

// Look at named-events more closely
const namedEvents = [
  ['eruption_at_etna',   311, 344],
  ['eruption_at_vulcano',311, 353],
  ['eruption_at_ischia', 299, 387],
  ['eruption_at_santorini', 432, 331],
];
console.log('\n=== Records WITHIN ±2 tiles of named events ===');
for (const [n, x, y] of namedEvents) {
  const nearby = recs.filter(r=>Math.abs(r.X-x) <= 2 && Math.abs(r.Y-y) <= 2);
  console.log('  ' + n + ' (' + x + ',' + y + ') — ' + nearby.length + ' nearby records:');
  nearby.forEach(r=>console.log('    rec[' + r.i + '] (' + r.X + ',' + r.Y + ') a=' + r.a + ' b=' + r.b + ' flag1=' + r.flag1 + ' hash=0x' + r.hash.toString(16).padStart(8,'0')));
}
