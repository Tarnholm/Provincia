// Session 26 — VALIDATE the scripted-event firing log schema with named events.
// Schema (per 20B record + 6B delimiter):
//   c (u32 @ +8) = tile X
//   d (u32 @ +12) = tile Y
//   a (u32 @ +0) = iteration counter / index (0..43)
//   b (u32 @ +4) = event category (1..5)
//   e (u32 @ +16) = UUID hash

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

const REGION_START = 0x84f1c, REGION_END = 0xa8b3d;

const matches = [];
for (let o = REGION_START; o < REGION_END - 6; o++) {
  if (buf[o]===0xff && buf[o+1]===0xff && buf[o+2]===0xff && buf[o+3]===0xff
      && (buf[o+4]===0x00 || buf[o+4]===0x01) && buf[o+5]===0x01) {
    matches.push(o);
  }
}

const recs = [];
for (let i = 0; i < matches.length; i++) {
  const start = i===0 ? REGION_START+3 : matches[i-1]+6;  // start at +3 to skip leading 3B
  const end = matches[i];
  if (end - start !== 20) continue;
  const a = buf.readUInt32LE(start);
  const b = buf.readUInt32LE(start+4);
  const X = buf.readUInt32LE(start+8);
  const Y = buf.readUInt32LE(start+12);
  const e = buf.readUInt32LE(start+16);
  const delim4 = buf[matches[i]+4];
  recs.push({i, off:start, a, b, X, Y, hash:e, delim4});
}

// Cross-reference: for each named event location, find ALL records within ±3 tiles
const namedEvents = [
  {name:'eruption_at_etna', X:311, Y:344},
  {name:'eruption_at_vulcano', X:311, Y:353},
  {name:'eruption_at_ischia', X:299, Y:387},
  {name:'eruption_at_santorini', X:432, Y:331},
  {name:'eruption_at_methana', X:203, Y:173},
  {name:'earthquake_at_santorini', X:435, Y:334},
  {name:'earthquake_in_rhodes', X:465, Y:336},
  {name:'earthquake_in_iberia', X:53, Y:459},
  {name:'flood_in_rome_241', X:294, Y:403},
  {name:'pyramids_and_sphinx', X:514, Y:249},
  {name:'pharos', X:497, Y:266},
  {name:'colossus', X:465, Y:337},
  {name:'temple', X:452, Y:356},
  {name:'statue', X:388, Y:345},
  {name:'gardens', X:668, Y:326},
  {name:'mausoleum', X:456, Y:343},
];

console.log('=== Records within ±2 tiles of each named event ===');
for (const ev of namedEvents) {
  const nearby = recs.filter(r=>Math.abs(r.X-ev.X) <= 2 && Math.abs(r.Y-ev.Y) <= 2);
  console.log('  ' + ev.name.padEnd(28) + ' @ (' + ev.X.toString().padStart(4) + ',' + ev.Y.toString().padStart(4) + '): ' + nearby.length + ' records');
  if (nearby.length > 0 && nearby.length <= 5) {
    nearby.forEach(r=>console.log('    rec[' + r.i + '] (' + r.X + ',' + r.Y + ') a=' + r.a + ' b=' + r.b + ' hash=0x' + r.hash.toString(16).padStart(8,'0')));
  } else if (nearby.length > 5) {
    nearby.slice(0,3).forEach(r=>console.log('    rec[' + r.i + '] (' + r.X + ',' + r.Y + ') a=' + r.a + ' b=' + r.b));
  }
}

// Look at where Y > 700 -- those are out of map range
const offMap = recs.filter(r=>r.Y > 700);
console.log('\n=== Records with Y > 700 (outside map): ' + offMap.length + ' ===');
const offY = {};
offMap.forEach(r=>offY[r.Y] = (offY[r.Y]||0)+1);
Object.entries(offY).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([y,c])=>console.log('  Y=' + y + ': ' + c));

// Distribution of records by region
// Spatial heatmap: which regions get most records?
// Sample: 16x12 bins on 1024x768
console.log('\n=== Spatial heatmap (32x24 bins on 1024x768 map) ===');
const NX = 32, NY = 24;
const grid = Array.from({length:NY}, ()=>new Array(NX).fill(0));
for (const r of recs) {
  if (r.X >= 0 && r.X < 1024 && r.Y >= 0 && r.Y < 768) {
    const bx = Math.floor(r.X * NX / 1024);
    const by = Math.floor(r.Y * NY / 768);
    grid[by][bx]++;
  }
}
// Print
const maxC = Math.max(...grid.flat());
console.log('Max bin density:', maxC);
const palette = ' .:-=+*#%@';
for (let y = 0; y < NY; y++) {
  let row = '';
  for (let x = 0; x < NX; x++) {
    const c = grid[y][x];
    const idx = Math.min(palette.length-1, Math.floor(c/maxC*(palette.length-1)));
    row += palette[idx];
  }
  console.log('  ' + row);
}

// Count by (a) field — 9 dominates with 1305 records (= 23%)
// (a) might be an event-class counter that resets per type
console.log('\n=== Records per (a, b) joint group (top 15) ===');
const abH = {};
for (const r of recs) {
  const k = r.a + ',' + r.b;
  abH[k] = (abH[k]||0)+1;
}
Object.entries(abH).sort((a,b)=>b[1]-a[1]).slice(0,15).forEach(([k,c])=>console.log('  (a=' + k.split(',')[0].padStart(3) + ', b=' + k.split(',')[1] + '): ' + c));

// HYPOTHESIS: this is the migration / barbarian / horde spawn registry
// 5632 records is a LOT for scripted events.
// Could it be the per-tile-per-year volcano-eruption schedule? 25 volcanoes × ~226 years = 5650. Close!
// Or per-tile horde-spawn registry?
// Let me check year information — is there a year field?

// Actually let me check (a) bounds: 0..43 — 44 distinct. If 270 BC start + 696 turn = 426 turns,
// the campaign spans 426 years. So (a) is NOT a year counter.

// (b) bounds 1..5 — 5 categories. The named-event categories are:
// 1=eruption, 2=earthquake, 3=flood, 4=wonder, 5=??? Or 1=volcano, 2=earthquake-static, 3=earthquake-dynamic
// Let me check (b) value by event-type
const bByEv = {};
for (const ev of namedEvents) {
  const nearby = recs.filter(r=>Math.abs(r.X-ev.X) <= 2 && Math.abs(r.Y-ev.Y) <= 2);
  if (nearby.length > 0) {
    bByEv[ev.name] = nearby.map(r=>r.b);
  }
}
console.log('\n=== (b) values per named event ===');
for (const [n, bs] of Object.entries(bByEv)) {
  const counts = {};
  bs.forEach(b=>counts[b]=(counts[b]||0)+1);
  console.log('  ' + n.padEnd(28) + ': ' + Object.entries(counts).map(([b,c])=>'b'+b+'×'+c).join(' '));
}

// Now: what's (a)? Distribution across records
const aH = {};
for (const r of recs) aH[r.a] = (aH[r.a]||0)+1;
console.log('\n(a) distribution full:');
Object.entries(aH).sort((a,b)=>parseInt(a[0])-parseInt(b[0])).forEach(([a,c])=>console.log('  a=' + a.padStart(3) + ': ' + c));

// Test: is (a) a "fire count" for repeated events? E.g. 9 means "fired 9 times"?
// Check: for records sharing exact (X,Y), what (a) values appear?
const xyA = {};
for (const r of recs) {
  const k = r.X + ',' + r.Y;
  if (!xyA[k]) xyA[k] = [];
  xyA[k].push(r.a);
}
// Coords with multiple records
const multi = Object.entries(xyA).filter(([k,as])=>as.length>1).sort((a,b)=>b[1].length-a[1].length);
console.log('\n=== Coordinates with multiple records (top 10) ===');
multi.slice(0,10).forEach(([k,as])=>{
  console.log('  (' + k + '): n=' + as.length + ' a-values=' + as.slice(0,15).join(','));
});

// Maybe (a) is the "delay" or "interval" between consecutive firings of a per-tile event
// 9 = next firing in 9 years
// 18 = next firing in 18 years
// 36 = next firing in 36 years
// These are common eruption-interval values for Mediterranean volcanoes (Etna: 12-20 years)

// Distribution of (a, b) WITHIN one coord
console.log('\n=== Coords with most records — full (a, b) distribution ===');
multi.slice(0,5).forEach(([k,as])=>{
  const ev = namedEvents.find(e=>Math.abs(e.X - parseInt(k.split(',')[0])) <= 3 && Math.abs(e.Y - parseInt(k.split(',')[1])) <= 3);
  const recsHere = recs.filter(r=>(r.X + ',' + r.Y) === k);
  console.log('  (' + k + ')' + (ev ? ' [' + ev.name + ']' : '') + ':');
  recsHere.slice(0,20).forEach(r=>console.log('    rec[' + r.i + '] a=' + r.a + ' b=' + r.b + ' hash=0x' + r.hash.toString(16).padStart(8,'0') + ' delim=' + r.delim4));
});
