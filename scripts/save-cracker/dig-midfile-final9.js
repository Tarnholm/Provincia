// Session 27 — RoR-T1 has 696 f600 cells but they're NOT on the diagonal. What pattern do they form?

const fs = require('fs');
const ROR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav';
const buf = fs.readFileSync(ROR);
const STRIDE = 267;
const W = 240, H = 238;
const ARR_START = 0x108a22;

const cells = [];
for (let r = 0; r < H; r++) {
  for (let c = 0; c < W; c++) {
    const o = ARR_START + (r*W + c)*STRIDE;
    const f28 = buf.readUInt32LE(o + 28);
    const f32 = buf.readUInt32LE(o + 32);
    if (f28 === 6 && f32 === 600) cells.push({c, r});
  }
}
console.log('RoR-T1 f600 cells:', cells.length);

// Heatmap
const DW = 80, DH = 30;
const grid = Array.from({length: DH}, ()=>new Array(DW).fill(0));
for (const cell of cells) grid[Math.floor(cell.r*DH/H)][Math.floor(cell.c*DW/W)]++;
const maxC = Math.max(...grid.flat());
const palette = ' .:=+*#%@';
console.log('Heatmap (80x30):');
for (let y = 0; y < DH; y++) {
  let row = '';
  for (let x = 0; x < DW; x++) {
    const c = grid[y][x];
    const idx = Math.min(palette.length-1, Math.floor(c/Math.max(1,maxC)*(palette.length-1)));
    row += palette[idx];
  }
  console.log('  ' + row);
}

// Sum H
const sumH = {};
for (const c of cells) sumH[c.r+c.c] = (sumH[c.r+c.c]||0)+1;
const topSums = Object.entries(sumH).sort((a,b)=>b[1]-a[1]).slice(0,10);
console.log('\nTop (r+c) sums:');
topSums.forEach(([s, c])=>console.log('  sum=' + s + ': ' + c));

// Diff H
const diffH = {};
for (const c of cells) diffH[c.r-c.c] = (diffH[c.r-c.c]||0)+1;
const topDiffs = Object.entries(diffH).sort((a,b)=>b[1]-a[1]).slice(0,10);
console.log('\nTop (r-c) diffs:');
topDiffs.forEach(([s, c])=>console.log('  diff=' + s + ': ' + c));

// Rows with most cells
const rowH = {};
for (const c of cells) rowH[c.r] = (rowH[c.r]||0)+1;
console.log('\nTop rows:');
Object.entries(rowH).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([r, n])=>console.log('  row=' + r + ': ' + n));

const colH = {};
for (const c of cells) colH[c.c] = (colH[c.c]||0)+1;
console.log('\nTop columns:');
Object.entries(colH).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([c, n])=>console.log('  col=' + c + ': ' + n));

// What's a common feature? Is RoR-T1 a different map (smaller?) than rome10's RIS-imperial?
// RoR = Republic of Rome (vanilla campaign) vs RIS imperial
// Different map → different cells
// But same engine → same SIZE 240x238 grid?

// Check rome10 f600 cells distribution
const SAV2 = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf2 = fs.readFileSync(SAV2);
const ARR2 = 0xf8fd2;

const cells2 = [];
for (let r = 0; r < H; r++) {
  for (let c = 0; c < W; c++) {
    const o = ARR2 + (r*W + c)*STRIDE;
    const f28 = buf2.readUInt32LE(o + 28);
    const f32 = buf2.readUInt32LE(o + 32);
    if (f28 === 6 && f32 === 600) cells2.push({c, r});
  }
}

// Cross-tab rome10 vs RoR-T1 — how many cells are SHARED?
const set1 = new Set(cells.map(c=>c.c + ',' + c.r));
const set2 = new Set(cells2.map(c=>c.c + ',' + c.r));
const shared = [...set1].filter(c=>set2.has(c));
console.log('\nrome10 f600 cells:', cells2.length);
console.log('RoR-T1 f600 cells:', cells.length);
console.log('Shared (same coords):', shared.length);
console.log('rome10-only:', cells2.length - shared.length);
console.log('RoR-T1-only:', cells.length - shared.length);

// If they're entirely different = save-specific data. If shared = engine constant.
