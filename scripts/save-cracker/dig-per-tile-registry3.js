// Session 27 — Full decode of per-tile registry with correct offsets.
// 5632 records starting at 0x84f1f, ending at 0xa8b39 (delim at 0xa8b33 + 6 = 0xa8b39).

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

const REGION_START = 0x84f1f;
const STRIDE = 26;
const N_RECS = 5632;
const REGION_END = REGION_START + N_RECS * STRIDE;
console.log('Region:', '0x' + REGION_START.toString(16), '..', '0x' + REGION_END.toString(16));

const recs = [];
for (let i = 0; i < N_RECS; i++) {
  const o = REGION_START + i*STRIDE;
  recs.push({
    i, o,
    a: buf.readUInt32LE(o),
    b: buf.readUInt32LE(o + 4),
    X: buf.readUInt32LE(o + 8),
    Y: buf.readUInt32LE(o + 12),
    hash: buf.readUInt32LE(o + 16),
    delim: buf.readUInt32LE(o + 20),
    flag1: buf[o + 24],
    flag2: buf[o + 25],
  });
}

// Validate
const okDelim = recs.filter(r=>r.delim === 0xffffffff && r.flag2 === 0x01).length;
console.log('Records with valid delimiter:', okDelim, '/', recs.length);

// Bounds checks
const Xs = recs.map(r=>r.X);
const Ys = recs.map(r=>r.Y);
console.log('X range:', Math.min(...Xs), '..', Math.max(...Xs));
console.log('Y range:', Math.min(...Ys), '..', Math.max(...Ys));

// (a) and (b) distributions
const aH = {}, bH = {};
for (const r of recs) {
  aH[r.a] = (aH[r.a]||0)+1;
  bH[r.b] = (bH[r.b]||0)+1;
}
console.log('\n=== (a) distribution (full) ===');
Object.entries(aH).sort((a,b)=>parseInt(a[0])-parseInt(b[0])).forEach(([a,c])=>console.log('  a=' + a.padStart(3) + ': ' + c));

console.log('\n=== (b) distribution ===');
Object.entries(bH).sort((a,b)=>parseInt(a[0])-parseInt(b[0])).forEach(([b,c])=>console.log('  b=' + b + ': ' + c));

// Joint (a, b)
const abH = {};
for (const r of recs) abH[r.a+','+r.b] = (abH[r.a+','+r.b]||0)+1;
console.log('\n=== Top (a, b) combos ===');
Object.entries(abH).sort((a,b)=>b[1]-a[1]).slice(0,15).forEach(([k,c])=>{
  const [a,b] = k.split(',');
  console.log('  a=' + a.padStart(3) + ' b=' + b + ': ' + c);
});

// flag1 dist
const f1H = {};
for (const r of recs) f1H[r.flag1] = (f1H[r.flag1]||0)+1;
console.log('\n=== flag1 (penultimate byte) ===');
Object.entries(f1H).forEach(([f,c])=>console.log('  flag1=' + f + ': ' + c));

// Are any X,Y out of map range?
const NOT_MAP = recs.filter(r=>r.X > 1024 || r.Y > 768);
console.log('\nRecords with X>1024 or Y>768:', NOT_MAP.length);

// Tile coverage at 240x238 grid
const tileC = new Set();
for (const r of recs) {
  const tx = Math.floor(r.X / 4.25);
  const ty = Math.floor(r.Y / 2.94);
  tileC.add(tx + ',' + ty);
}
console.log('Unique 240x238 grid cells:', tileC.size);

const uniXY = new Set();
for (const r of recs) uniXY.add(r.X + ',' + r.Y);
console.log('Unique exact (X,Y):', uniXY.size);

// Named-event presence
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
  const exact = recs.filter(r=>r.X===x && r.Y===y);
  const nearby = recs.filter(r=>Math.abs(r.X-x) <= 2 && Math.abs(r.Y-y) <= 2);
  console.log('  ' + name.padEnd(28) + ' (' + x.toString().padStart(4) + ',' + y.toString().padStart(4) + '): exact=' + exact.length + ' nearby(±2)=' + nearby.length);
}

// Heatmap
console.log('\n=== Spatial heatmap (32x24) ===');
const NX = 32, NY = 24;
const grid = Array.from({length: NY}, ()=>new Array(NX).fill(0));
for (const r of recs) {
  if (r.X >= 0 && r.X < 1024 && r.Y >= 0 && r.Y < 768) {
    const bx = Math.floor(r.X * NX / 1024);
    const by = Math.floor(r.Y * NY / 768);
    grid[by][bx]++;
  }
}
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

// Per-coord record count (some tiles may have many records)
const xyCount = {};
for (const r of recs) {
  const k = r.X + ',' + r.Y;
  xyCount[k] = (xyCount[k]||0)+1;
}
const multiRecCoords = Object.entries(xyCount).filter(([k,c])=>c>1);
console.log('\nCoords with >1 record:', multiRecCoords.length);
console.log('Max records at one coord:', Math.max(...Object.values(xyCount)));
console.log('Coords with most records (top 5):');
multiRecCoords.sort((a,b)=>b[1]-a[1]).slice(0,5).forEach(([k,c])=>console.log('  (' + k + '): ' + c));

// Cross-tab with mid-file 697 non-canonical cells
// Get the cell list from previous dig-midfile-cells1-out.json
const cellFile = 'C:/dev/Provincia/scripts/save-cracker/dig-midfile-cells1-out.json';
if (require('fs').existsSync(cellFile)) {
  const cellData = JSON.parse(fs.readFileSync(cellFile));
  console.log('\n=== Cross-tab with mid-file non-canonical cells ===');
  console.log('Type of saved data:', typeof cellData);
  if (Array.isArray(cellData)) console.log('Count:', cellData.length);
  else if (cellData.cells) console.log('Keys:', Object.keys(cellData), 'cells:', cellData.cells?.length);
  // Just dump first few entries
  console.log('First entries:', JSON.stringify(cellData).slice(0, 300));
}
