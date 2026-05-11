// Session 27 — Verify the diagonal pattern in f32=600 cells.
// Hypothesis: this is the "longitudinal" axis or a fixed geometric overlay
// Or: it's the path of a scripted-event-trigger sweep

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

const ARR_START = 0xf8fd2;
const STRIDE = 267;
const W = 240, H = 238;

// Collect f32=600 cells (with f28=6 to exclude edge cases)
const cells = [];
for (let r = 0; r < H; r++) {
  for (let c = 0; c < W; c++) {
    const i = r*W + c;
    const o = ARR_START + i*STRIDE;
    const f28 = buf.readUInt32LE(o + 28);
    const f32 = buf.readUInt32LE(o + 32);
    if (f28 === 6 && f32 === 600) cells.push({c, r});
  }
}

// EXCLUDE the bottom row (r=237) and analyze the rest
const nonBot = cells.filter(c=>c.r !== 237);
console.log('f32=600 cells excluding bottom-row r=237:', nonBot.length);

// Plot the remaining 697-234 = 463 cells
const DW = 100, DH = 50;
const sgrid = Array.from({length: DH}, ()=>new Array(DW).fill(0));
for (const cell of nonBot) {
  sgrid[Math.floor(cell.r*DH/H)][Math.floor(cell.c*DW/W)]++;
}
const maxC = Math.max(...sgrid.flat());
const palette = ' .:=+*#%@';
console.log('Heatmap excluding bottom row (max=' + maxC + '):');
for (let y = 0; y < DH; y++) {
  let row = '';
  for (let x = 0; x < DW; x++) {
    const c = sgrid[y][x];
    const idx = Math.min(palette.length-1, Math.floor(c/Math.max(1,maxC)*(palette.length-1)));
    row += palette[idx];
  }
  console.log(row);
}

// Identify the diagonal stripe — cells that fall on a line c+r=K
// Find consecutive runs of cells lying on a diagonal
const diag = nonBot.filter(c=>{
  const sum = c.r + c.c;
  // Find similar sum cells
  return nonBot.some(d=>d !== c && Math.abs((d.r+d.c) - sum) <= 5 && Math.abs(d.r-c.r) >= 1 && Math.abs(d.r-c.r) <= 10);
});
console.log('Cells with diagonal-neighbors:', diag.length);

// Look at the specific diagonal: starting from (~0, ~237) up to (~240, ~0)
// Line equation: c + r = 237 (constant)
const onMainDiag = nonBot.filter(c=>Math.abs(c.r + c.c - 237) <= 3);
console.log('Cells near c+r=237 (±3):', onMainDiag.length);

// Print
console.log('Sample cells on main diagonal:');
onMainDiag.slice(0,30).forEach(c=>console.log('  (' + c.c.toString().padStart(3) + ',' + c.r.toString().padStart(3) + ') sum=' + (c.r+c.c)));

// Or maybe the line is c+r = K varies
// Compute the line that best fits the diagonal cells (excluding scatter)
// For each diagonal sum value (0..474), count cells
const sumH = {};
for (const c of nonBot) sumH[c.r+c.c] = (sumH[c.r+c.c]||0)+1;

// The most common sum values reveal the line
const topSums = Object.entries(sumH).sort((a,b)=>b[1]-a[1]).slice(0,15);
console.log('\nMost common (r+c) sums:');
topSums.forEach(([s, c])=>console.log('  sum=' + s + ': ' + c + ' cells'));

// Conclusion: Most likely the diagonal is a fixed line — perhaps representing
//   - a map-coordinate-system axis (45° tilted)
//   - a scripted-event path
//   - a precomputed lighting / shadow line
//   - a wind/current direction overlay

// Try: are the non-diag, non-bottom cells just random clusters?
const offDiag = nonBot.filter(c=>Math.abs(c.r + c.c - 237) > 10);
console.log('\nOff-main-diagonal cells:', offDiag.length);
// Cluster these
const xs2 = offDiag.map(c=>c.c);
const ys2 = offDiag.map(c=>c.r);
console.log('Off-diag c-range:', Math.min(...xs2), '..', Math.max(...xs2));
console.log('Off-diag r-range:', Math.min(...ys2), '..', Math.max(...ys2));

// Now: does the bottom-row r=237 pattern + diagonal correspond to a known game feature?
// The MAP TGA is 1024×768 pixels, 240×238 cell grid = 4.27 × 3.23 pixels per cell.
// Row r=237 is the bottom (south) of the map → could be "south map-boundary marker" or "Sahara desert tiles"
// In RIS imperial, the southern map edge crosses Mauritania, Sahara, southern Egypt, Arabia

// To validate: read public/map_regions_large.tga first byte of the bottom row
const TGA_PATH = 'C:/dev/Provincia/public/map_regions_large.tga';
if (require('fs').existsSync(TGA_PATH)) {
  const tga = fs.readFileSync(TGA_PATH);
  // TGA: 18-byte header + image data (1024×768 RGB(A))
  // header[12,13] = width LE, [14,15] = height LE, [16] = bpp
  const tgaW = tga.readUInt16LE(12), tgaH = tga.readUInt16LE(14), tgaBpp = tga[16];
  console.log('\nTGA dims:', tgaW, 'x', tgaH, 'bpp=' + tgaBpp);
  // TGA stores rows bottom-to-top by default (origin at bottom-left)
  // For 32 bpp: pixel = [B, G, R, A]
  // Row 0 in TGA = bottom of map
  // Cell (c, r) in save → pixel (X, Y) where X = c*4.27, Y depends on orientation

  // Sample the bottom row in TGA
  const bytesPerPixel = tgaBpp / 8;
  const offset = 18 + 0 * tgaW * bytesPerPixel; // row 0
  console.log('TGA row 0 first 10 pixels (BGR):');
  for (let i = 0; i < 10; i++) {
    const px = i * 4 + offset;
    console.log('  pix[' + i + '] B=' + tga[px] + ' G=' + tga[px+1] + ' R=' + tga[px+2]);
  }
}
