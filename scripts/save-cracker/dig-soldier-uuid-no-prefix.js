// Search for the 4-byte unit UUID e4 3d 21 89 in all three saves
// (without the queue-specific 0x03 prefix)

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const PRE = fs.readFileSync(path.join(BASE_R, 'save_arretium pre retrained..sav'));
const QUEUE = fs.readFileSync(path.join(BASE_R, 'save_arretium queued retrain.sav'));
const POST = fs.readFileSync(path.join(BASE_R, 'save_arretium retrained turn 2.sav'));

const uuid = Buffer.from([0xe4, 0x3d, 0x21, 0x89]);

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

const preHits = findAll(PRE, uuid);
const queueHits = findAll(QUEUE, uuid);
const postHits = findAll(POST, uuid);

console.log('4-byte UUID e4 3d 21 89 hits:');
console.log('  PRE:   ' + preHits.length);
console.log('  QUEUE: ' + queueHits.length);
console.log('  POST:  ' + postHits.length);

// Cluster the POST hits to find concentration of soldier records
function findClusters(hits, gap) {
  if (hits.length === 0) return [];
  const clusters = [];
  let cur = [hits[0]];
  for (let i = 1; i < hits.length; i++) {
    if (hits[i] - hits[i - 1] <= gap) cur.push(hits[i]);
    else { clusters.push(cur); cur = [hits[i]]; }
  }
  if (cur.length > 0) clusters.push(cur);
  return clusters;
}

console.log('\nPOST clusters (≥4 hits within 100 bytes):');
const postClusters = findClusters(postHits, 100);
for (const c of postClusters.filter(cc => cc.length >= 4)) {
  console.log('  0x' + c[0].toString(16) + ' .. 0x' + c[c.length-1].toString(16) +
    ' (' + c.length + ' hits, span ' + (c[c.length-1] - c[0]) + ' bytes, avg stride ' +
    Math.round((c[c.length-1] - c[0]) / (c.length - 1)) + ')');
}

console.log('\nPRE clusters (≥4 hits within 100 bytes):');
const preClusters = findClusters(preHits, 100);
for (const c of preClusters.filter(cc => cc.length >= 4)) {
  console.log('  0x' + c[0].toString(16) + ' .. 0x' + c[c.length-1].toString(16) +
    ' (' + c.length + ' hits, span ' + (c[c.length-1] - c[0]) + ' bytes, avg stride ' +
    Math.round((c[c.length-1] - c[0]) / (c.length - 1)) + ')');
}

// For the BIGGEST PRE cluster, dump the bytes (these are the unit's CURRENT soldier records)
const biggestPre = preClusters.filter(cc => cc.length >= 4).sort((a, b) => b.length - a.length)[0];
if (biggestPre) {
  console.log('\nBiggest PRE cluster has ' + biggestPre.length + ' hits at 0x' + biggestPre[0].toString(16));
  console.log('Bytes around first hit (40 before, 100 after):');
  const c0 = biggestPre[0];
  for (let j = -40; j < 100; j += 16) {
    const hex = Array.from(PRE.slice(c0 + j, c0 + j + 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(PRE.slice(c0 + j, c0 + j + 16)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  ' + (j >= 0 ? '+' : '') + j.toString().padStart(4) + ': ' + hex + '  |' + ascii + '|');
  }
}
