// Search for (X, Y) coord pairs of placed resources in the save.
// All 5,633 resources have known (X, Y) — if any are stored as u32 pairs we can find them.
// Map height = 700. Try both raw Y and (700 - Y) flip.

const fs = require('fs');
const buf = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav');
const res = JSON.parse(fs.readFileSync('C:/dev/Provincia/public/resources_large.json'));

// Build set of (X,Y) keys for all resources
const resSet = new Map(); // key "X,Y" -> {region,type,amount}
for (const region of Object.keys(res)) {
  for (const r of res[region]) {
    const key = r.x + ',' + r.y;
    resSet.set(key, { region, type: r.type, amount: r.amount, x: r.x, y: r.y });
  }
}
console.log('total unique (X,Y) pairs:', resSet.size);

// Pick a sample: Roma slaves at (284, 292) - save y_flip = 408
// All Roma resources for Y values
const romaRes = res['Roma'];
console.log('Roma resources:');
for (const r of romaRes) console.log('  (', r.x, ',', r.y, ') flipped Y=', 700-r.y, 'type:', r.type);

// Strategy 1: scan the entire save for adjacent u32 pairs that match any (X,Y) from resSet
// Try both Y orientations and within reasonable coord bounds
const MAP_H = 700;
const allowedXmin = 1, allowedXmax = 1020;
const allowedYmin = 1, allowedYmax = 700;

console.log('\nScanning save for (X,Y) u32 pairs matching ANY resource location...');
const hits = []; // {pos, x, y, isFlipped, match}
let count = 0;
for (let i = 0; i < buf.length - 8; i += 4) {
  const x = buf.readUInt32LE(i);
  if (x < allowedXmin || x > allowedXmax) continue;
  const y = buf.readUInt32LE(i + 4);
  if (y < allowedYmin || y > allowedYmax) continue;
  // try both raw and flipped
  let m = resSet.get(x + ',' + y);
  let flipped = false;
  if (!m) {
    m = resSet.get(x + ',' + (MAP_H - y));
    if (m) flipped = true;
  }
  if (m) {
    hits.push({ pos: i, x, y, flipped, match: m });
    count++;
    if (count >= 5000) break;
  }
}
console.log('total hits:', hits.length);

// Cluster by position - any contiguous regions in the file?
const positions = hits.map(h => h.pos);
positions.sort((a,b) => a - b);
console.log('first 20 hit positions:', positions.slice(0,20).map(p => '0x' + p.toString(16)));
console.log('last 20 hit positions:', positions.slice(-20).map(p => '0x' + p.toString(16)));

// Histogram: bucket by 64KB region
const buckets = new Map();
for (const p of positions) {
  const b = Math.floor(p / 65536);
  buckets.set(b, (buckets.get(b)||0)+1);
}
const sortedBuckets = [...buckets.entries()].sort((a,b) => b[1] - a[1]).slice(0, 20);
console.log('\nTop 20 hit-dense 64KB buckets:');
for (const [b, c] of sortedBuckets) {
  console.log(' bucket 0x' + (b*65536).toString(16), 'count:', c);
}
