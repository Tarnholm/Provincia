// Session 27 — Cross-tab per-tile registry with 697 mid-file non-canonical cells.
// Also check what (a, b) means by relating it to known events.

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

const REGION_START = 0x84f1f;
const STRIDE = 26;
const N_RECS = 5632;

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
    flag1: buf[o + 24],
  });
}

// Load mid-file cells
const cellData = JSON.parse(fs.readFileSync('C:/dev/Provincia/scripts/save-cracker/dig-midfile-cells1-out.json'));
const ARR_START = cellData.ARR_START;
const STRIDE_MID = cellData.STRIDE;
const W = cellData.W;
const H = cellData.H;

// Use the first variant ('200_600_2_6_600' or whatever) — or get from session 22
console.log('mid-file array: W=' + W + ' H=' + H + ' STRIDE=' + STRIDE_MID + ' START=0x' + ARR_START.toString(16));
console.log('Variants in cells file:', cellData.variants.map(v=>v.variant));

// Use the variant with closest to 697 cells (session 22)
const target697 = cellData.variants.find(v=>v.cells.length >= 600 && v.cells.length <= 800);
let variant;
if (target697) {
  variant = target697;
} else {
  // Just use the largest one for visibility
  variant = cellData.variants.reduce((a,b)=>a.cells.length > b.cells.length ? a : b);
}
console.log('Using variant:', variant.variant, 'with', variant.cells.length, 'non-canonical cells');

const nonCanonCells = new Set();
for (const c of variant.cells) nonCanonCells.add(c.c + ',' + c.r);
console.log('Non-canonical cell set size:', nonCanonCells.size);

// For each per-tile registry record, compute its grid cell and check if non-canonical
// Use the mapping: cell_c = X / (1024/W) = X / 4.27; cell_r = Y / (768/H) = Y / 3.227
// But that depends on actual tile→pixel scaling. The mid-file might use grid coordinates 0..W-1 / 0..H-1
// Per session 22 the W=240 H=238 grid corresponds to the 1024×768 map → 4.267 × 3.227 px per cell

// Test multiple mappings
const mappings = [
  {name: 'X/4.267, Y/3.227', cf: (X,Y)=>[Math.floor(X/4.267), Math.floor(Y/3.227)]},
  {name: 'X/4.25, Y/2.94', cf: (X,Y)=>[Math.floor(X/4.25), Math.floor(Y/2.94)]},
  {name: 'X/W, Y/H direct', cf: (X,Y)=>[Math.floor(X*W/1024), Math.floor(Y*H/768)]},
  {name: 'X/W flipY', cf: (X,Y)=>[Math.floor(X*W/1024), H-1-Math.floor(Y*H/768)]},
];

console.log('\n=== Cross-tab per-tile registry with non-canonical cells ===');
for (const m of mappings) {
  const hits = recs.filter(r=>{
    const [c,rr] = m.cf(r.X, r.Y);
    return nonCanonCells.has(c + ',' + rr);
  });
  // Baseline: random expectation
  const totalCells = W * H;
  const baseline = recs.length * nonCanonCells.size / totalCells;
  console.log('  ' + m.name + ': ' + hits.length + ' hits / ' + recs.length + ' (baseline=' + baseline.toFixed(0) + ', enrichment=' + (hits.length/baseline).toFixed(2) + 'x)');
}

// (a, b) combo analysis with X,Y bounds
// If (a=9, b=1) is a special category, what's the spatial distribution?
console.log('\n=== Spatial distribution by (a, b) group ===');
const groups = [
  ['(a=9, b=1)', r=>r.a===9 && r.b===1],
  ['(a=18, b=1) or (a=18, b=2)', r=>r.a===18 && (r.b===1||r.b===2)],
  ['(a=4, b=1) or (a=4, b=2)', r=>r.a===4 && (r.b===1||r.b===2)],
  ['(a=36, b=*)', r=>r.a===36],
  ['b=3', r=>r.b===3],
  ['b=4', r=>r.b===4],
  ['b=5', r=>r.b===5],
];
for (const [name, fn] of groups) {
  const here = recs.filter(fn);
  if (here.length === 0) continue;
  const xs = here.map(r=>r.X);
  const ys = here.map(r=>r.Y);
  console.log('  ' + name + ' n=' + here.length + ' X=[' + Math.min(...xs) + ',' + Math.max(...xs) + '] Y=[' + Math.min(...ys) + ',' + Math.max(...ys) + ']');
  // Heatmap small
  const NX2 = 16, NY2 = 12;
  const grid = Array.from({length: NY2}, ()=>new Array(NX2).fill(0));
  for (const r of here) {
    if (r.X >= 0 && r.X < 1024 && r.Y >= 0 && r.Y < 768) {
      grid[Math.floor(r.Y*NY2/768)][Math.floor(r.X*NX2/1024)]++;
    }
  }
  const maxC = Math.max(...grid.flat());
  const palette = ' .:=+*#%@';
  for (let y = 0; y < NY2; y++) {
    let row = '';
    for (let x = 0; x < NX2; x++) {
      const c = grid[y][x];
      const idx = Math.min(palette.length-1, Math.floor(c/Math.max(1,maxC)*(palette.length-1)));
      row += palette[idx];
    }
    console.log('    ' + row);
  }
}

// Check: flag1 vs (a, b) correlation
// All flag1=0 records have (a=9, b=1): verify
const flag1zeroAB = new Set();
for (const r of recs.filter(r=>r.flag1===0)) flag1zeroAB.add(r.a + ',' + r.b);
const flag1oneAB = new Set();
for (const r of recs.filter(r=>r.flag1===1)) flag1oneAB.add(r.a + ',' + r.b);
console.log('\n=== flag1 by (a,b) confirmation ===');
console.log('flag1=0 records (a,b) combos:', [...flag1zeroAB].slice(0,10).join(' '));
console.log('flag1=1 records (a,b) combos:', [...flag1oneAB].length + ' distinct combos');
