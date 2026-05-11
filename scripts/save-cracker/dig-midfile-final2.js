// Session 27 — Stretch: look at the f28=54/55 cells (rare non-canonical) and see what's there.
// Also: revisit whether the 697 cells might correspond to AI campaign zones (kingdoms/borders).

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

const ARR_START = 0xf8fd2;
const STRIDE = 267;
const W = 240, H = 238;

// Find cells with rare f28 values
const f28_54_cells = [];
const f28_55_cells = [];
const f28_6_with_f32_600 = [];
const non_f28_6 = [];

for (let r = 0; r < H; r++) {
  for (let c = 0; c < W; c++) {
    const i = r*W + c;
    const o = ARR_START + i*STRIDE;
    if (o + 36 > buf.length) break;
    const f16 = buf.readUInt32LE(o + 16);
    const f20 = buf.readUInt32LE(o + 20);
    const f24 = buf.readUInt32LE(o + 24);
    const f28 = buf.readUInt32LE(o + 28);
    const f32 = buf.readUInt32LE(o + 32);
    if (f28 === 54) f28_54_cells.push({c, r, f16, f20, f24, f28, f32, o});
    if (f28 === 55) f28_55_cells.push({c, r, f16, f20, f24, f28, f32, o});
    if (f28 === 6 && f32 === 600) f28_6_with_f32_600.push({c, r, f16, f20, f24, f28, f32, o});
    if (f28 !== 6 && f28 !== 54 && f28 !== 55) non_f28_6.push({c, r, f28});
  }
}

console.log('=== f28 value cells ===');
console.log('f28=54 cells:', f28_54_cells.length);
console.log('f28=55 cells:', f28_55_cells.length);
console.log('f28=6, f32=600 cells:', f28_6_with_f32_600.length);
console.log('f28 other (not 6/54/55):', non_f28_6.length);

// f28 distribution beyond 6/54/55
const f28H = {};
for (const r of non_f28_6) f28H[r.f28] = (f28H[r.f28]||0)+1;
console.log('Other f28 values:', Object.entries(f28H).map(([v,c])=>v+':'+c).join(' '));

// Look at f28=54 cells spatially
if (f28_54_cells.length > 0) {
  const xs = f28_54_cells.map(c=>c.c);
  const ys = f28_54_cells.map(c=>c.r);
  console.log('\nf28=54 cells: c-range', Math.min(...xs), '..', Math.max(...xs), 'r-range', Math.min(...ys), '..', Math.max(...ys));
  console.log('Sample f28=54 cells (first 20):');
  f28_54_cells.slice(0, 20).forEach(c=>{
    console.log('  (' + c.c.toString().padStart(3) + ',' + c.r.toString().padStart(3) + ') f16=' + c.f16 + ' f20=' + c.f20 + ' f24=' + c.f24 + ' f28=' + c.f28 + ' f32=' + c.f32);
  });

  // Are these clustered? Heatmap
  console.log('\nf28=54 spatial heatmap (24x12):');
  const NX = 24, NY = 12;
  const grid = Array.from({length: NY}, ()=>new Array(NX).fill(0));
  for (const cell of f28_54_cells) {
    grid[Math.floor(cell.r*NY/H)][Math.floor(cell.c*NX/W)]++;
  }
  const maxC = Math.max(...grid.flat());
  const palette = ' .:=+*#%@';
  for (let y = 0; y < NY; y++) {
    let row = '';
    for (let x = 0; x < NX; x++) {
      const c = grid[y][x];
      const idx = Math.min(palette.length-1, Math.floor(c/Math.max(1,maxC)*(palette.length-1)));
      row += palette[idx];
    }
    console.log('  ' + row);
  }
}

// f28=54 cells - what are their (c, r) → likely region IDs?
// Try mapping (c, r) → tile center → settlement region from public/regions_large.json
const REGS_PATH = 'C:/dev/Provincia/public/regions_large.json';
if (require('fs').existsSync(REGS_PATH)) {
  const regs = JSON.parse(fs.readFileSync(REGS_PATH));
  // regions are keyed like "52,13,198" — these look like (R,G,B) color values for map_regions_large.tga
  // Not directly mappable to (c, r) without the tga lookup
  console.log('\nFirst 3 region keys:', Object.keys(regs).slice(0,3));
  console.log('Sample region structure:', JSON.stringify(regs[Object.keys(regs)[0]]).slice(0, 300));
}

// Look at the 697-cell mystery from yet another angle: f32=600 cells
console.log('\n=== f28=6, f32=600 cells (' + f28_6_with_f32_600.length + ') ===');
if (f28_6_with_f32_600.length > 0) {
  console.log('First 20:');
  f28_6_with_f32_600.slice(0, 20).forEach(c=>console.log('  (' + c.c + ',' + c.r + ')'));
}

// Now: are f28=54 cells COASTAL? Let me check by looking at nearby cells' fields
console.log('\n=== f28=54 cells: check if coastal (neighbor f28 values) ===');
let neighbor_zero = 0, neighbor_canon = 0;
for (const cell of f28_54_cells.slice(0, 50)) {
  const c = cell.c, r = cell.r;
  // Check 4-neighbors
  for (const [dc, dr] of [[-1,0],[1,0],[0,-1],[0,1]]) {
    const nc = c+dc, nr = r+dr;
    if (nc < 0 || nc >= W || nr < 0 || nr >= H) continue;
    const ni = nr*W + nc;
    const no = ARR_START + ni*STRIDE;
    const nf28 = buf.readUInt32LE(no + 28);
    if (nf28 === 6) neighbor_canon++;
    else if (nf28 === 0) neighbor_zero++;
  }
}
console.log('f28=54 neighbors with f28=6:', neighbor_canon);
console.log('f28=54 neighbors with f28=0:', neighbor_zero);

// Maybe f28=54/55 marks "rebellion regions" or "scripted-script-zone" tiles
// Final test: any cell with f28 != 6 — list all
console.log('\n=== All non-(f28=6) cells in mid-file array ===');
const allNonCanon = [];
for (let r = 0; r < H; r++) {
  for (let c = 0; c < W; c++) {
    const i = r*W + c;
    const o = ARR_START + i*STRIDE;
    if (o + 36 > buf.length) break;
    const f28 = buf.readUInt32LE(o + 28);
    if (f28 !== 6) allNonCanon.push({c, r, f28});
  }
}
console.log('Total non-(f28=6) cells:', allNonCanon.length);
const f28HH = {};
for (const c of allNonCanon) f28HH[c.f28] = (f28HH[c.f28]||0)+1;
console.log('f28 distribution among non-canon:');
Object.entries(f28HH).sort((a,b)=>b[1]-a[1]).forEach(([v,c])=>console.log('  f28=' + v + ': ' + c));

// Show f28=54 in proper map context (use shading)
console.log('\n=== Full map showing f28!=6 cells ===');
const display = Array.from({length: H}, ()=>new Array(W).fill('.'));
for (const c of allNonCanon) {
  if (c.f28 === 54) display[c.r][c.c] = '#';
  else if (c.f28 === 55) display[c.r][c.c] = '%';
  else display[c.r][c.c] = '?';
}
// Compact: 60x30 view
const SX = 80, SY = 30;
for (let y = 0; y < SY; y++) {
  let row = '';
  for (let x = 0; x < SX; x++) {
    const mapX = Math.floor(x * W / SX);
    const mapY = Math.floor(y * H / SY);
    // Find best symbol in this region
    let sym = '.';
    let cell54 = 0, cell55 = 0, cellOther = 0;
    for (let r = Math.floor(y*H/SY); r < Math.floor((y+1)*H/SY); r++) {
      for (let c = Math.floor(x*W/SX); c < Math.floor((x+1)*W/SX); c++) {
        if (r >= H || c >= W) continue;
        if (display[r][c] === '#') cell54++;
        else if (display[r][c] === '%') cell55++;
        else if (display[r][c] === '?') cellOther++;
      }
    }
    if (cell54 > 0) sym = '#';
    else if (cell55 > 0) sym = '%';
    else if (cellOther > 0) sym = '?';
    row += sym;
  }
  console.log('  ' + row);
}
