// Session 27 — Investigate f28=54 cells: are they right-edge / map-boundary?
// And f32=600: what coords have it?

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

const ARR_START = 0xf8fd2;
const STRIDE = 267;
const W = 240, H = 238;

// Collect all cells with their (f16, f20, f24, f28, f32)
const allCells = [];
for (let r = 0; r < H; r++) {
  for (let c = 0; c < W; c++) {
    const i = r*W + c;
    const o = ARR_START + i*STRIDE;
    if (o + 36 > buf.length) break;
    allCells.push({
      c, r, o,
      f0: buf.readUInt32LE(o),
      f4: buf.readUInt32LE(o + 4),
      f8: buf.readUInt32LE(o + 8),
      f12: buf.readUInt32LE(o + 12),
      f16: buf.readUInt32LE(o + 16),
      f20: buf.readUInt32LE(o + 20),
      f24: buf.readUInt32LE(o + 24),
      f28: buf.readUInt32LE(o + 28),
      f32: buf.readUInt32LE(o + 32),
    });
  }
}

// Distribution of f28=54 by column
console.log('=== f28=54 cells by column ===');
const colH = {};
for (const cell of allCells.filter(c=>c.f28===54)) colH[cell.c] = (colH[cell.c]||0)+1;
const topCols = Object.entries(colH).sort((a,b)=>b[1]-a[1]).slice(0,10);
console.log('Top columns with f28=54:');
topCols.forEach(([c, n])=>console.log('  col=' + c + ': ' + n + ' f28=54 cells'));

// Distribution of f28=54 by row
const rowH = {};
for (const cell of allCells.filter(c=>c.f28===54)) rowH[cell.r] = (rowH[cell.r]||0)+1;
console.log('\nTop rows with f28=54:');
Object.entries(rowH).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([r, n])=>console.log('  row=' + r + ': ' + n + ' f28=54 cells'));

// Are f28=54 cells always at map-edge (c=0,239 or r=0,237)?
const edge_only_54 = allCells.filter(c=>c.f28===54 && (c.c===0 || c.c===239 || c.r===0 || c.r===237)).length;
const total_54 = allCells.filter(c=>c.f28===54).length;
console.log('\nf28=54 on map-edge (c=0/239 or r=0/237):', edge_only_54, '/', total_54);

// Cells in column 239 — count by f28 value
const col239 = allCells.filter(c=>c.c === 239);
const col239_f28H = {};
for (const cell of col239) col239_f28H[cell.f28] = (col239_f28H[cell.f28]||0)+1;
console.log('\nColumn c=239 f28 distribution:');
Object.entries(col239_f28H).forEach(([v, c])=>console.log('  f28=' + v + ': ' + c + ' / 238'));

// Column 0
const col0 = allCells.filter(c=>c.c === 0);
const col0_f28H = {};
for (const cell of col0) col0_f28H[cell.f28] = (col0_f28H[cell.f28]||0)+1;
console.log('\nColumn c=0 f28 distribution:');
Object.entries(col0_f28H).forEach(([v, c])=>console.log('  f28=' + v + ': ' + c + ' / 238'));

// f32 distribution
const f32H = {};
for (const cell of allCells) f32H[cell.f32] = (f32H[cell.f32]||0)+1;
console.log('\n=== f32 distribution ===');
Object.entries(f32H).sort((a,b)=>b[1]-a[1]).forEach(([v, c])=>console.log('  f32=' + v + ': ' + c));

// 697 f32=600 cells — but we just confirmed f28=6 AND f32=600 = 697 cells
// Check: are ALL f32=600 cells also f28=6? Or is there a (f28=54, f32=600) subset?
const f32_600 = allCells.filter(c=>c.f32 === 600);
console.log('\nTotal f32=600 cells:', f32_600.length);
const sub = {};
for (const c of f32_600) sub[c.f28+','+c.f20] = (sub[c.f28+','+c.f20]||0)+1;
console.log('f32=600 sub-breakdown by (f28, f20):');
Object.entries(sub).sort((a,b)=>b[1]-a[1]).forEach(([k, n])=>console.log('  (f28=' + k.split(',')[0] + ', f20=' + k.split(',')[1] + '): ' + n));

// Look at the actual 697 f32=600 cells with f28=6 — are they coastal? Check neighborhood
console.log('\n=== 697 cells of (f28=6, f32=600) — spatial layout ===');
const cells697 = allCells.filter(c=>c.f28===6 && c.f32===600);
const xs = cells697.map(c=>c.c);
const ys = cells697.map(c=>c.r);
console.log('c-range:', Math.min(...xs), '..', Math.max(...xs));
console.log('r-range:', Math.min(...ys), '..', Math.max(...ys));

// Heatmap
const NX = 60, NY = 30;
const grid = Array.from({length: NY}, ()=>new Array(NX).fill(0));
for (const cell of cells697) grid[Math.floor(cell.r*NY/H)][Math.floor(cell.c*NX/W)]++;
const maxC = Math.max(...grid.flat());
const palette = ' .:=+*#%@';
console.log('Heatmap (60x30, max bin=' + maxC + '):');
for (let y = 0; y < NY; y++) {
  let row = '';
  for (let x = 0; x < NX; x++) {
    const c = grid[y][x];
    const idx = Math.min(palette.length-1, Math.floor(c/Math.max(1,maxC)*(palette.length-1)));
    row += palette[idx];
  }
  console.log('  ' + row);
}

// Now: does the per-tile registry coords map to cells with (f28=6, f32=600)?
const REGION_START = 0x84f1f, S2 = 26, N2 = 5632;
const ptRecs = [];
for (let i = 0; i < N2; i++) {
  const o = REGION_START + i*S2;
  ptRecs.push({X: buf.readUInt32LE(o+8), Y: buf.readUInt32LE(o+12)});
}
const cellSet = new Set();
for (const c of cells697) cellSet.add(c.c + ',' + c.r);
// Map per-tile coords to grid cells
const ptHits = ptRecs.filter(r=>{
  const c = Math.floor(r.X*W/1024), rr = Math.floor(r.Y*H/768);
  return cellSet.has(c + ',' + rr);
}).length;
console.log('\nPer-tile registry coords landing in 697 f32=600 cells:', ptHits, '/', ptRecs.length);
console.log('Expected if random:', (ptRecs.length * 697 / (W*H)).toFixed(1));
console.log('Enrichment:', (ptHits / (ptRecs.length * 697 / (W*H))).toFixed(2) + 'x');

// Try flipY mapping
const ptHitsFlip = ptRecs.filter(r=>{
  const c = Math.floor(r.X*W/1024), rr = H-1-Math.floor(r.Y*H/768);
  return cellSet.has(c + ',' + rr);
}).length;
console.log('FlipY enrichment:', (ptHitsFlip / (ptRecs.length * 697 / (W*H))).toFixed(2) + 'x');
