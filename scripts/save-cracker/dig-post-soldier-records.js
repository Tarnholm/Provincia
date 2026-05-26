// In the POST save, find where Arretium's unit's soldier records ended up.
// The parent UUID marker is `03 e4 3d 21 89` (5 bytes). Search for it.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const POST = fs.readFileSync(path.join(BASE_R, 'save_arretium retrained turn 2.sav'));
const PRE = fs.readFileSync(path.join(BASE_R, 'save_arretium pre retrained..sav'));
const QUEUE = fs.readFileSync(path.join(BASE_R, 'save_arretium queued retrain.sav'));

// Search for parent UUID marker `03 e4 3d 21 89` in all three saves
const marker = Buffer.from([0x03, 0xe4, 0x3d, 0x21, 0x89]);
function findAll(buf, m) {
  const positions = [];
  let p = 0;
  while (true) {
    const idx = buf.indexOf(m, p);
    if (idx === -1) break;
    positions.push(idx);
    p = idx + 1;
  }
  return positions;
}

const preHits = findAll(PRE, marker);
const queueHits = findAll(QUEUE, marker);
const postHits = findAll(POST, marker);

console.log('Parent UUID marker hits:');
console.log('  PRE:   ' + preHits.length);
console.log('  QUEUE: ' + queueHits.length);
console.log('  POST:  ' + postHits.length);

// Show first/last 5 hits per save with context
console.log('\nPRE first 5 hits:');
for (const h of preHits.slice(0, 5)) console.log('  0x' + h.toString(16));
console.log('PRE last 5 hits:');
for (const h of preHits.slice(-5)) console.log('  0x' + h.toString(16));

console.log('\nQUEUE first 5 hits:');
for (const h of queueHits.slice(0, 5)) console.log('  0x' + h.toString(16));
console.log('QUEUE last 5 hits:');
for (const h of queueHits.slice(-5)) console.log('  0x' + h.toString(16));

console.log('\nPOST first 5 hits:');
for (const h of postHits.slice(0, 5)) console.log('  0x' + h.toString(16));
console.log('POST last 5 hits:');
for (const h of postHits.slice(-5)) console.log('  0x' + h.toString(16));

// Total soldier count per save (if marker is per soldier record)
console.log('\nIf each hit = 1 soldier:');
console.log('  PRE has   ' + preHits.length + ' soldier records for this unit');
console.log('  QUEUE has ' + queueHits.length + ' (= ' + (queueHits.length - preHits.length) + ' more than PRE — the queued recruits)');
console.log('  POST has  ' + postHits.length + ' (= ' + (postHits.length - queueHits.length) + ' more than QUEUE; +' + (postHits.length - preHits.length) + ' vs PRE)');

// Identify CLUSTERED hits (consecutive within ~50 bytes)
function findClusters(hits) {
  const clusters = [];
  let cur = [hits[0]];
  for (let i = 1; i < hits.length; i++) {
    if (hits[i] - hits[i - 1] <= 50) cur.push(hits[i]);
    else { clusters.push(cur); cur = [hits[i]]; }
  }
  if (cur.length > 0) clusters.push(cur);
  return clusters;
}

const preClus = findClusters(preHits);
const postClus = findClusters(postHits);
console.log('\nPRE clusters (≥3 in 50 bytes):');
for (const c of preClus.filter(cc => cc.length >= 3).slice(0, 10)) {
  console.log('  0x' + c[0].toString(16) + ' .. 0x' + c[c.length-1].toString(16) + ' (' + c.length + ' hits, spread ' + (c[c.length-1] - c[0]) + ' bytes)');
}
console.log('POST clusters (≥3 in 50 bytes):');
for (const c of postClus.filter(cc => cc.length >= 3).slice(0, 10)) {
  console.log('  0x' + c[0].toString(16) + ' .. 0x' + c[c.length-1].toString(16) + ' (' + c.length + ' hits, spread ' + (c[c.length-1] - c[0]) + ' bytes)');
}
