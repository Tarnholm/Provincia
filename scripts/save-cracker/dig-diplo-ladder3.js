// dig-diplo-ladder3.js
// Catalogue the per-cell +20 and +32 fields. session 32 noted that
// [r][237] (vettones column) had +20=600 in EVERY row. Verify this and
// look for other "non-default" cells.

const fs = require('fs');
const path = require('path');
const SAVES_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const STRIDE = 267;
const N = 239;
const MAT = 0xf8fd2;

const buf = fs.readFileSync(path.join(SAVES_DIR, 'save_1.1.sav'));

// Count distinct (u20, u32) pairs per column
const colStats = []; // for each c, distribution
for (let c = 0; c < N; c++) {
  const dist = {};
  for (let r = 0; r < N; r++) {
    const off = MAT + (r*N+c)*STRIDE;
    const v20 = buf.readUInt32LE(off+20);
    const v32 = buf.readUInt32LE(off+32);
    const key = v20+'/'+v32;
    dist[key] = (dist[key]||0) + 1;
  }
  colStats.push({c, dist});
}

// Print columns where the dominant value isn't 200/200
console.log('Columns with non-200/200 dominant (u20/u32) values:');
for (const cs of colStats) {
  const entries = Object.entries(cs.dist).sort((a,b)=>b[1]-a[1]);
  const dom = entries[0];
  if (dom[0] !== '200/200') {
    console.log(`  col ${cs.c}: dominant=${dom[0]} (${dom[1]}/${N}) others: ${entries.slice(1,3).map(e=>e[0]+'×'+e[1]).join(',')}`);
  }
}

// Same for rows
console.log('\nRows with non-200/200 dominant (u20/u32) values:');
for (let r = 0; r < N; r++) {
  const dist = {};
  for (let c = 0; c < N; c++) {
    const off = MAT + (r*N+c)*STRIDE;
    const v20 = buf.readUInt32LE(off+20);
    const v32 = buf.readUInt32LE(off+32);
    const key = v20+'/'+v32;
    dist[key] = (dist[key]||0) + 1;
  }
  const entries = Object.entries(dist).sort((a,b)=>b[1]-a[1]);
  const dom = entries[0];
  if (dom[0] !== '200/200') {
    console.log(`  row ${r}: dominant=${dom[0]} (${dom[1]}/${N}) others: ${entries.slice(1,3).map(e=>e[0]+'×'+e[1]).join(',')}`);
  }
}

// Also: per-cell scan, find cells where v20/v32 is NEITHER 200/200 NOR matching its column/row dominant
console.log('\nNon-default cells (sampling 100 most exceptional):');
const exceptional = [];
for (let r = 0; r < N; r++) {
  for (let c = 0; c < N; c++) {
    const off = MAT + (r*N+c)*STRIDE;
    const v20 = buf.readUInt32LE(off+20);
    const v32 = buf.readUInt32LE(off+32);
    if (v20 !== 200 || v32 !== 200) {
      exceptional.push({r, c, v20, v32});
    }
  }
}
console.log('  total non-200/200 cells:', exceptional.length);
// Histogram of v20 values
const v20Hist = {};
for (const e of exceptional) v20Hist[e.v20] = (v20Hist[e.v20]||0)+1;
console.log('  v20 histogram:', JSON.stringify(v20Hist));
const v32Hist = {};
for (const e of exceptional) v32Hist[e.v32] = (v32Hist[e.v32]||0)+1;
console.log('  v32 histogram:', JSON.stringify(v32Hist));

// Sample some unique (r,c) pairs with exceptional values
console.log('  sample exceptional cells (r,c,v20,v32):');
for (const e of exceptional.slice(0,30)) console.log(`    [${e.r}][${e.c}] v20=${e.v20} v32=${e.v32}`);
