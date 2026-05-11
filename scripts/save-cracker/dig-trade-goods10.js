// Pivot: forget Rome record offsets. Look for **resource records** at fixed positions in the body.
// 5,633 resources × (x,y,type) ≈ 12 bytes/each = 67KB of data.
// Find a region of the body that has dense (x,y) hits matching known resources at a fixed stride.

const fs = require('fs');
const buf = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav');
const res = JSON.parse(fs.readFileSync('C:/dev/Provincia/public/resources_large.json'));

const MAP_H = 700;
const resSet = new Map();
const resList = [];
for (const region of Object.keys(res)) {
  for (const r of res[region]) {
    resSet.set(r.x + ',' + r.y, { region, type: r.type, amount: r.amount });
    resList.push({ region, ...r });
  }
}
console.log('total resources:', resList.length);

// Try unflipped: see if every (X, Y) appears as a u32 pair at any byte alignment somewhere
let countAny = 0, countAt4 = 0;
const seenOffsets = [];
const allXY = new Set();
for (const r of resList) {
  // try X then Y(unflipped) AND X then Y(flipped)
  allXY.add(r.x + ',' + r.y);
}

// Scan and bucket
const yToX = new Map();
for (let i = 0; i < buf.length - 8; i++) {
  const x = buf.readUInt32LE(i);
  if (x < 1 || x > 1020) continue;
  const y = buf.readUInt32LE(i+4);
  if (y < 1 || y > 700) continue;
  if (allXY.has(x + ',' + y) || allXY.has(x + ',' + (MAP_H - y))) {
    countAny++;
    if (i % 4 === 0) countAt4++;
    if (seenOffsets.length < 30) seenOffsets.push(i);
  }
}
console.log('hits any byte alignment:', countAny, 'on 4-byte alignment:', countAt4);

// Try: scan for sequences where stride is ~12 (one record per resource ~5633 records ≈ 67KB)
// Look for the densest cluster
function findDenseRegion(stride) {
  const hits = [];
  for (let i = 0; i < buf.length - 8; i += 4) {
    const x = buf.readUInt32LE(i);
    if (x < 1 || x > 1020) continue;
    const y = buf.readUInt32LE(i + 4);
    if (y < 1 || y > 700) continue;
    if (resSet.has(x + ',' + y) || resSet.has(x + ',' + (MAP_H - y))) hits.push(i);
  }
  // Find dense cluster: longest run where consecutive hits have gap stride
  let bestLen = 0, bestStart = -1;
  let curLen = 0, curStart = -1, lastHit = -1;
  for (const h of hits) {
    if (lastHit > 0 && h - lastHit === stride) {
      curLen++;
    } else {
      curLen = 1;
      curStart = h;
    }
    lastHit = h;
    if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
  }
  return { bestLen, bestStart, hitCount: hits.length };
}

for (const s of [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 48, 52, 56, 64]) {
  const r = findDenseRegion(s);
  console.log('stride', s, ':', r);
}

// Try y-flipped: 700 - y
console.log('\nNow with explicit y-flip hits only:');
function scanFlipped() {
  let hits = [];
  for (let i = 0; i < buf.length - 8; i += 4) {
    const x = buf.readUInt32LE(i);
    if (x < 1 || x > 1020) continue;
    const y = buf.readUInt32LE(i + 4);
    if (y < 1 || y > 700) continue;
    // y here is the save format; check if (x, 700-y) is a resource location (Y stored flipped)
    if (resSet.has(x + ',' + (MAP_H - y))) hits.push({ i, x, y, type: 'flipped' });
  }
  return hits;
}
function scanUnflipped() {
  let hits = [];
  for (let i = 0; i < buf.length - 8; i += 4) {
    const x = buf.readUInt32LE(i);
    if (x < 1 || x > 1020) continue;
    const y = buf.readUInt32LE(i + 4);
    if (y < 1 || y > 700) continue;
    if (resSet.has(x + ',' + y)) hits.push({ i, x, y, type: 'raw' });
  }
  return hits;
}
const flipped = scanFlipped();
const unflipped = scanUnflipped();
console.log('flipped Y hits:', flipped.length);
console.log('unflipped Y hits:', unflipped.length);

// Print first 30 flipped hits
console.log('\nfirst 30 flipped hits:');
for (const h of flipped.slice(0, 30)) {
  const m = resSet.get(h.x + ',' + (MAP_H - h.y));
  console.log(' 0x' + h.i.toString(16), 'x:', h.x, 'y:', h.y, 'res:', m.region, m.type, 'amt:', m.amount);
}

// Look at strides between consecutive flipped hits
console.log('\nflipped hit-position deltas:');
const fposes = flipped.map(h => h.i).sort((a,b)=>a-b);
const deltas = {};
for (let k = 1; k < Math.min(fposes.length, 500); k++) {
  const d = fposes[k] - fposes[k-1];
  deltas[d] = (deltas[d] || 0) + 1;
}
const sortedDeltas = Object.entries(deltas).sort((a,b) => b[1]-a[1]).slice(0, 20);
console.log('top 20 deltas between flipped hits:');
for (const [d, c] of sortedDeltas) console.log(' delta=' + d, 'count=' + c);
