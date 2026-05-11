// Session 27 — Final: verify f32=600 cells form a diagonal stripe pattern.
// Plot full map at 240x238 resolution to see the structure clearly.

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

const ARR_START = 0xf8fd2;
const STRIDE = 267;
const W = 240, H = 238;

// Full map of f32 values
const map = Array.from({length: H}, ()=>new Array(W).fill(0));
for (let r = 0; r < H; r++) {
  for (let c = 0; c < W; c++) {
    const i = r*W + c;
    const o = ARR_START + i*STRIDE;
    map[r][c] = buf.readUInt32LE(o + 32);
  }
}

// Plot just the 697 f32=600 cells (excluding f28=54)
console.log('=== f32=600 cells, f28 must = 6: 697 cells ===');
const cells697 = [];
for (let r = 0; r < H; r++) {
  for (let c = 0; c < W; c++) {
    const i = r*W + c;
    const o = ARR_START + i*STRIDE;
    const f28 = buf.readUInt32LE(o + 28);
    const f32 = buf.readUInt32LE(o + 32);
    if (f28 === 6 && f32 === 600) cells697.push({c, r});
  }
}
console.log('Total:', cells697.length);

// Compact-printing: 120-col wide
const DW = 120, DH = 60;
const sgrid = Array.from({length: DH}, ()=>new Array(DW).fill(0));
for (const cell of cells697) {
  sgrid[Math.floor(cell.r*DH/H)][Math.floor(cell.c*DW/W)]++;
}
const maxC = Math.max(...sgrid.flat());
console.log('Max bin density:', maxC);
const palette = ' .:=+*#%@';
for (let y = 0; y < DH; y++) {
  let row = '';
  for (let x = 0; x < DW; x++) {
    const c = sgrid[y][x];
    const idx = Math.min(palette.length-1, Math.floor(c/Math.max(1,maxC)*(palette.length-1)));
    row += palette[idx];
  }
  console.log(row);
}

// What's at the bottom row? Maybe the entire row r=237 has f32=600?
console.log('\n=== Bottom-row scan (r=237, r=236, r=235) ===');
for (let r = 235; r <= 237; r++) {
  const here = [];
  for (let c = 0; c < W; c++) {
    if (map[r][c] === 600) here.push(c);
  }
  console.log('  row r=' + r + ' f32=600 columns:', here.length, 'cols (sample:', here.slice(0,20).join(','), ')');
}

// Try mapping: cell (c, r) -> map coord (X, Y)
// X tile size: 1024/240 = 4.267 pixels/cell
// Y tile size: 768/238 = 3.227 pixels/cell
// Cell (0, 0) = map top-left or bottom-left?
// In RTW, tile (0,0) is typically southwest corner. So r=0 = south?
// Cell (0, 237) might be NORTH or SOUTH...

// Let me check: does the bottom-row stripe (r=237 with many f32=600 cells) correspond to map's south or north edge?
// In RIS imperial, the bottom of the map (south) is Africa - Sahara/Egypt. The northern edge is Britain/Germania.
// The TGA file public/map_regions_large.tga is 1024×768. Tile r=0 in save = which Y?

// Looking at the heatmap, the diagonal goes from BOTTOM-LEFT (r=237, c=0) to TOP-RIGHT (r=0, c~239)
// In game coords: the diagonal axis is from low-left to high-right
// This could be: solar elevation, scripted-event-density-gradient, or border-zone-marker

// Check edge cells of f32=600 — what's special about them?
// Maybe f32 = "battle replay tile" or "victory zone"

// Let me try one more semantic interpretation: are the 697 f32=600 cells correlated with the FIRST 697 tiles in some traversal order?
// 697 cells = 2.92% of 23,800 land tiles
// Or maybe they're the SHIPPING LANES (coastline-adjacent water tiles)?

// Count tiles by Manhattan dist from r=237 (bottom)
const f600 = cells697;
let distFromBottom = 0;
for (const cell of f600) distFromBottom += (H-1 - cell.r);
console.log('\nMean distance of f32=600 cells from bottom row r=237:', (distFromBottom / f600.length).toFixed(1));

// Cells in r >= 220
const lowerCells = f600.filter(c=>c.r >= 220);
console.log('f32=600 cells in lower 7% of map (r>=220):', lowerCells.length);

// First 20 (sorted by r descending, then c)
console.log('\nFirst 20 f32=600 cells (sorted r desc, c asc):');
f600.sort((a,b)=>b.r-a.r || a.c-b.c);
f600.slice(0,20).forEach(c=>console.log('  (' + c.c + ',' + c.r + ')'));

// Last 20 (top of map)
console.log('\nLast 20 f32=600 cells (sorted r asc):');
f600.sort((a,b)=>a.r-b.r || a.c-b.c);
f600.slice(0,20).forEach(c=>console.log('  (' + c.c + ',' + c.r + ')'));

// Test: is f32=600 cells correlated with cell-index modulo something?
// Or with diagonal: r + c = const?
const sumH = {};
for (const c of f600) {
  const k = c.r + c.c;
  sumH[k] = (sumH[k]||0)+1;
}
console.log('\n=== f32=600 cells by (r+c) sum ===');
const sumStats = Object.entries(sumH).map(([k,v])=>[parseInt(k),v]).sort((a,b)=>a[0]-b[0]);
console.log('Sum range:', sumStats[0][0], '..', sumStats[sumStats.length-1][0]);
console.log('Mean cell count per sum:', (f600.length / sumStats.length).toFixed(1));
// Bin by 10
const binH = {};
for (const c of f600) {
  const b = Math.floor((c.r + c.c) / 20) * 20;
  binH[b] = (binH[b]||0)+1;
}
Object.entries(binH).sort((a,b)=>parseInt(a[0])-parseInt(b[0])).forEach(([k,v])=>console.log('  (r+c)=' + k.padStart(3) + '..+19: ' + v));

// Diff: (r - c) bands
const dH = {};
for (const c of f600) {
  const b = Math.floor((c.r - c.c) / 20) * 20;
  dH[b] = (dH[b]||0)+1;
}
console.log('\n=== f32=600 cells by (r-c) diff ===');
Object.entries(dH).sort((a,b)=>parseInt(a[0])-parseInt(b[0])).forEach(([k,v])=>console.log('  (r-c)=' + k.padStart(4) + '..+19: ' + v));
