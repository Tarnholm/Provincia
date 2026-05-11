// Session 27 — Cross-tab per-tile registry against ALL non-canonical-cell variants.
// Find best-fitting mapping.

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

const cellData = JSON.parse(fs.readFileSync('C:/dev/Provincia/scripts/save-cracker/dig-midfile-cells1-out.json'));
const W = cellData.W, H = cellData.H;

console.log('=== Cross-tab per-tile registry against ALL non-canonical-cell variants ===');
console.log('Per-tile records: 5632, map grid: ' + W + 'x' + H);
console.log('');

for (const variant of cellData.variants) {
  const nc = new Set();
  for (const c of variant.cells) nc.add(c.c + ',' + c.r);
  if (nc.size < 50) continue;  // skip trivial

  const baseline = recs.length * nc.size / (W*H);
  const hits1 = recs.filter(r=>nc.has(Math.floor(r.X*W/1024) + ',' + Math.floor(r.Y*H/768))).length;
  const hits2 = recs.filter(r=>nc.has(Math.floor(r.X*W/1024) + ',' + (H-1-Math.floor(r.Y*H/768)))).length;
  console.log('  variant ' + variant.variant.padEnd(35) + ' cells=' + nc.size.toString().padStart(4) +
              ' baseline=' + baseline.toFixed(0).padStart(4) +
              ' hits(rawY)=' + hits1 + '(' + (hits1/baseline).toFixed(2) + 'x)' +
              ' hits(flipY)=' + hits2 + '(' + (hits2/baseline).toFixed(2) + 'x)');
}

// What variant has 697 cells? Or close to it?
console.log('\n=== Variants by cell count ===');
cellData.variants.sort((a,b)=>a.cells.length-b.cells.length).forEach(v=>console.log('  ' + v.variant.padEnd(35) + ' ' + v.cells.length + ' cells'));

// Filter to (a=9, b=1, flag1=0) records — does this subset have higher enrichment?
const flag1zero = recs.filter(r=>r.flag1===0);
console.log('\n=== flag1=0 (a=9, b=1) records (' + flag1zero.length + ' records) ===');
for (const variant of cellData.variants) {
  const nc = new Set();
  for (const c of variant.cells) nc.add(c.c + ',' + c.r);
  if (nc.size < 50) continue;
  const baseline = flag1zero.length * nc.size / (W*H);
  const hits = flag1zero.filter(r=>nc.has(Math.floor(r.X*W/1024) + ',' + Math.floor(r.Y*H/768))).length;
  console.log('  ' + variant.variant.padEnd(35) + ' cells=' + nc.size + ' hits=' + hits + '(' + (hits/baseline).toFixed(2) + 'x)');
}

// And flag1=1 records
const flag1one = recs.filter(r=>r.flag1===1);
console.log('\n=== flag1=1 records (' + flag1one.length + ' records) ===');
for (const variant of cellData.variants) {
  const nc = new Set();
  for (const c of variant.cells) nc.add(c.c + ',' + c.r);
  if (nc.size < 50) continue;
  const baseline = flag1one.length * nc.size / (W*H);
  const hits = flag1one.filter(r=>nc.has(Math.floor(r.X*W/1024) + ',' + Math.floor(r.Y*H/768))).length;
  console.log('  ' + variant.variant.padEnd(35) + ' cells=' + nc.size + ' hits=' + hits + '(' + (hits/baseline).toFixed(2) + 'x)');
}

// Map per-tile records into the 240x238 grid and count records-per-cell
const cellCount = {};
for (const r of recs) {
  const c = Math.floor(r.X*W/1024), rr = Math.floor(r.Y*H/768);
  const k = c + ',' + rr;
  cellCount[k] = (cellCount[k]||0)+1;
}
const totalCells = Object.keys(cellCount).length;
console.log('\n=== Cells with at least 1 record:', totalCells, '/', W*H, '===');
const multi = Object.entries(cellCount).filter(([k,c])=>c>1);
console.log('Cells with multiple records:', multi.length);
console.log('Cells with 1 record:', totalCells - multi.length);

// Distribution of cell-record-counts
const ctH = {};
for (const c of Object.values(cellCount)) ctH[c] = (ctH[c]||0)+1;
console.log('Cell-record-count histogram:');
Object.entries(ctH).sort((a,b)=>parseInt(a[0])-parseInt(b[0])).forEach(([n,c])=>console.log('  ' + n + ' records: ' + c + ' cells'));

// Cells with most records
console.log('Cells with most records (top 5):');
multi.sort((a,b)=>b[1]-a[1]).slice(0,5).forEach(([k,c])=>console.log('  cell ' + k + ': ' + c));
