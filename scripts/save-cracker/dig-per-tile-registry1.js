// Session 27 — Target #2: Decode the 5,632 trailing 26-byte records in scripted-events table.
// Already know per session 26: each record is [u32 a][u32 b][u32 tileX][u32 tileY][u32 hash][4×0xff][u8 0/1][u8 0x01]
// New questions:
//   - Does it cover the FULL 240×238 map grid? Or just specific tiles?
//   - Do the 7 wonder tile coords appear in this registry?
//   - Do the 22 scripted-event tile coords appear?
//   - What's the geographic distribution?
//   - Is there a 1-to-1 with the 697 mid-file non-canonical cells?

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

// Per session 26: per-tile records span 0x84efb..0xa8b3d at 26-byte stride
const REGION_START = 0x84efb;
const REGION_END = 0xa8b3d;

// Re-parse using the corrected stride
const recs = [];
let off = REGION_START;
while (off + 26 <= REGION_END) {
  recs.push({
    off,
    a: buf.readUInt32LE(off),
    b: buf.readUInt32LE(off + 4),
    X: buf.readUInt32LE(off + 8),
    Y: buf.readUInt32LE(off + 12),
    hash: buf.readUInt32LE(off + 16),
    delim4: buf.readUInt32LE(off + 20),  // should be 0xffffffff
    flag1: buf[off + 24],   // 0 or 1
    flag2: buf[off + 25],   // 0x01
  });
  off += 26;
}
console.log('Region bytes:', REGION_END - REGION_START);
console.log('Parsed records:', recs.length, '(expected 5632)');

// Validate delimiter
const validDelim = recs.filter(r=>r.delim4 === 0xffffffff && r.flag2 === 0x01).length;
console.log('Records with valid delimiter:', validDelim);

// Tile X, Y bounds
const Xs = recs.map(r=>r.X);
const Ys = recs.map(r=>r.Y);
console.log('X range:', Math.min(...Xs), '..', Math.max(...Xs));
console.log('Y range:', Math.min(...Ys), '..', Math.max(...Ys));

// Coverage: how many unique (X, Y) tiles?
const tileSet = new Set();
for (const r of recs) tileSet.add(r.X + ',' + r.Y);
console.log('Unique tiles:', tileSet.size);

// 240×238 grid = 57,120 tiles; 5632 ≈ 9.8%
// If this is a sparse registry, what fraction of map coverage?

// Check named-event tile presence
const namedEvents = [
  ['eruption_at_etna',   311, 344],
  ['eruption_at_vulcano',311, 353],
  ['eruption_at_ischia', 299, 387],
  ['eruption_at_santorini', 432, 331],
  ['eruption_at_methana',203, 173],
  ['earthquake_at_santorini', 435, 334],
  ['earthquake_in_rhodes', 465, 336],
  ['earthquake_in_iberia', 53, 459],
  ['flood_in_rome_241', 294, 403],
  ['pyramids_and_sphinx', 514, 249],
  ['pharos', 497, 266],
  ['colossus', 465, 337],
  ['temple', 452, 356],
  ['statue', 388, 345],
  ['gardens', 668, 326],
  ['mausoleum', 456, 343],
];
console.log('\n=== Named events present in per-tile registry? ===');
for (const [name, x, y] of namedEvents) {
  const present = tileSet.has(x + ',' + y);
  const nearby = recs.filter(r=>Math.abs(r.X-x) <= 2 && Math.abs(r.Y-y) <= 2).length;
  console.log('  ' + name.padEnd(28) + ' (' + x + ',' + y + '): exact=' + present + ' nearby(±2)=' + nearby);
}

// (a) and (b) distributions
const aH = {}, bH = {}, abH = {};
for (const r of recs) {
  aH[r.a] = (aH[r.a]||0)+1;
  bH[r.b] = (bH[r.b]||0)+1;
  abH[r.a+','+r.b] = (abH[r.a+','+r.b]||0)+1;
}
console.log('\n=== (a) distribution ===');
Object.entries(aH).sort((a,b)=>parseInt(a[0])-parseInt(b[0])).forEach(([a,c])=>{
  if (c > 30) console.log('  a=' + a.padStart(3) + ': ' + c);
});

console.log('\n=== (b) distribution ===');
Object.entries(bH).sort((a,b)=>parseInt(a[0])-parseInt(b[0])).forEach(([b,c])=>{
  console.log('  b=' + b + ': ' + c);
});

// Top (a, b) combos
console.log('\n=== Top (a, b) combos ===');
Object.entries(abH).sort((a,b)=>b[1]-a[1]).slice(0,15).forEach(([k,c])=>{
  const [a, b] = k.split(',');
  console.log('  a=' + a.padStart(3) + ' b=' + b + ': ' + c);
});

// Spatial coverage: how many distinct (X//4, Y//4) cells covered?
const c4Set = new Set();
for (const r of recs) c4Set.add(Math.floor(r.X/4) + ',' + Math.floor(r.Y/4));
console.log('\n=== Spatial coverage ===');
console.log('Unique 4×4-pixel cells (256×192 grid):', c4Set.size, '/', 256*192);

const c8Set = new Set();
for (const r of recs) c8Set.add(Math.floor(r.X/8) + ',' + Math.floor(r.Y/8));
console.log('Unique 8×8-pixel cells (128×96 grid):', c8Set.size, '/', 128*96);

// On the 240×238 settlement grid (tile_size = 4.25×2.94):
// X tile = X / 4.25, Y tile = Y / 2.94
const tileC = new Set();
for (const r of recs) {
  const tx = Math.floor(r.X / 4.25);
  const ty = Math.floor(r.Y / 2.94);
  tileC.add(tx + ',' + ty);
}
console.log('Unique 240×238 settlement-grid cells:', tileC.size, '/', 240*238);

// flag1 distribution (0/1)
const f1H = {};
for (const r of recs) f1H[r.flag1] = (f1H[r.flag1]||0)+1;
console.log('\n=== flag1 (penultimate byte) distribution ===');
Object.entries(f1H).forEach(([f,c])=>console.log('  flag1=' + f + ': ' + c));

// Are records with flag1=1 vs flag1=0 spatially distinct?
const flag1ones = recs.filter(r=>r.flag1 === 1);
const flag1zeros = recs.filter(r=>r.flag1 === 0);
console.log('flag1=1 record count:', flag1ones.length, '(' + (100*flag1ones.length/recs.length).toFixed(1) + '%)');
console.log('flag1=0 record count:', flag1zeros.length, '(' + (100*flag1zeros.length/recs.length).toFixed(1) + '%)');

// Compute correlation between flag1 and (a, b)
console.log('\n=== flag1 by (a, b) ===');
const f1By = {};
for (const r of recs) {
  const k = r.a + ',' + r.b;
  if (!f1By[k]) f1By[k] = {z:0, o:0};
  if (r.flag1 === 0) f1By[k].z++;
  else f1By[k].o++;
}
Object.entries(f1By).sort((a,b)=>(b[1].z+b[1].o)-(a[1].z+a[1].o)).slice(0,10).forEach(([k,vs])=>{
  console.log('  (a=' + k.split(',')[0] + ', b=' + k.split(',')[1] + ') flag1=0: ' + vs.z + '  flag1=1: ' + vs.o);
});
