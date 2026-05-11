// Look for a contiguous run of resource-coord records.
// We have 5,633 placed resources total. Look for a dense cluster of 5,633 (X,Y) matches.

const fs = require('fs');
const buf = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav');
const res = JSON.parse(fs.readFileSync('C:/dev/Provincia/public/resources_large.json'));

const MAP_H = 700;

const resSet = new Map();
for (const region of Object.keys(res)) {
  for (const r of res[region]) {
    resSet.set(r.x + ',' + r.y, { region, type: r.type, amount: r.amount });
  }
}

// Try a range of strides (stride 8 = just X,Y; stride 12/16/20 = X,Y + extra)
for (const stride of [8, 12, 16, 20, 24, 28, 32, 36, 40]) {
  let bestRunStart = -1, bestRunLen = 0;
  let curStart = -1, curLen = 0;
  const MAP_W = 1020;
  for (let i = 0; i < buf.length - stride; i += 4) {
    const x = buf.readUInt32LE(i);
    if (x < 1 || x > MAP_W) {
      // end run
      if (curLen > bestRunLen) { bestRunLen = curLen; bestRunStart = curStart; }
      curStart = -1; curLen = 0;
      continue;
    }
    const y = buf.readUInt32LE(i + 4);
    if (y < 1 || y > 700) {
      if (curLen > bestRunLen) { bestRunLen = curLen; bestRunStart = curStart; }
      curStart = -1; curLen = 0;
      continue;
    }
    // is this (x, y) a placed resource?
    const m1 = resSet.get(x + ',' + y);
    const m2 = resSet.get(x + ',' + (MAP_H - y));
    if (m1 || m2) {
      if (curStart < 0) curStart = i;
      curLen++;
    } else {
      // tolerate single misses? for now strict
      if (curLen > bestRunLen) { bestRunLen = curLen; bestRunStart = curStart; }
      curStart = -1; curLen = 0;
    }
  }
  if (curLen > bestRunLen) { bestRunLen = curLen; bestRunStart = curStart; }
  console.log('stride', stride, ': best run len=', bestRunLen, '@ 0x' + (bestRunStart>=0?bestRunStart.toString(16):'-1'));
}

// Different approach: just see what stride-12 / stride-16 records contain resource coords
// scan stride-16 (typical "uuid + x + y + something" record):
console.log('\nStride-16 hit count and dense regions:');
const stride16Hits = [];
for (let i = 0; i < buf.length - 16; i += 4) {
  const x = buf.readUInt32LE(i);
  if (x < 1 || x > 1020) continue;
  const y = buf.readUInt32LE(i + 4);
  if (y < 1 || y > 700) continue;
  const m = resSet.get(x + ',' + y) || resSet.get(x + ',' + (MAP_H - y));
  if (m) stride16Hits.push({ pos: i, x, y, m });
}
console.log('stride16 hits:', stride16Hits.length);

// Look at clusters in pos
stride16Hits.sort((a,b) => a.pos - b.pos);
const clusters = [];
let cur = { start: -1, end: -1, count: 0 };
for (let k = 0; k < stride16Hits.length; k++) {
  const h = stride16Hits[k];
  if (cur.start < 0 || h.pos - cur.end > 64) {
    if (cur.count >= 5) clusters.push({ ...cur });
    cur = { start: h.pos, end: h.pos, count: 1 };
  } else {
    cur.end = h.pos;
    cur.count++;
  }
}
if (cur.count >= 5) clusters.push({ ...cur });
console.log('clusters (>=5 consecutive hits within 64 bytes):', clusters.length);
clusters.sort((a,b) => b.count - a.count);
console.log('top 20 clusters:');
for (const c of clusters.slice(0, 20)) {
  console.log(' 0x' + c.start.toString(16), '..', '0x' + c.end.toString(16), 'count:', c.count, 'span:', (c.end-c.start));
}
