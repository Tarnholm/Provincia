// dig-tile-trail1.js — Decode the end-of-file tile-trail array.
//
// From session 14: at 0x2110a24 .. 0x21153ae (rome10), chunks of:
//   [u32 N][N × (u32 selfPtr, u16 count, count × (u32 X, u32 Y))]
// 217 chunks, 2499 records, coords in (1..1500, 1..1500).
//
// Goal: identify what each chunk represents. If chunk selfPtrs match character
// primaryUuids, it's per-character. If they match faction record positions, it's per-faction.

const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

const TRAIL_START = 0x2110a24;
const FILE_END = buf.length;

// Walk all chunks
const chunks = [];
let p = TRAIL_START;
while (p + 4 < FILE_END) {
  const N = buf.readUInt32LE(p);
  if (N === 0 || N > 1000) break;
  const chunkStart = p;
  p += 4;
  const records = [];
  let valid = true;
  for (let i = 0; i < N; i++) {
    if (p + 6 > FILE_END) { valid = false; break; }
    const selfPtr = buf.readUInt32LE(p);
    const pairCount = buf.readUInt16LE(p + 4);
    if (selfPtr !== p) { valid = false; break; }
    if (pairCount > 100) { valid = false; break; }
    const pairs = [];
    p += 6;
    for (let j = 0; j < pairCount; j++) {
      if (p + 8 > FILE_END) { valid = false; break; }
      const x = buf.readUInt32LE(p);
      const y = buf.readUInt32LE(p + 4);
      pairs.push({ x, y });
      p += 8;
    }
    records.push({ selfPtr, pairCount, pairs });
  }
  if (!valid) { p = chunkStart; break; }
  chunks.push({ start: chunkStart, N, records });
}

console.log(`Total chunks: ${chunks.length}`);
console.log(`Last chunk ends at: 0x${p.toString(16)}, file end 0x${FILE_END.toString(16)}`);

// Stats per chunk
const recCounts = chunks.map(c => c.records.length);
const pairCounts = chunks.flatMap(c => c.records.map(r => r.pairCount));
console.log(`Records per chunk: min=${Math.min(...recCounts)} max=${Math.max(...recCounts)} avg=${(recCounts.reduce((a,b)=>a+b,0)/chunks.length).toFixed(2)}`);
console.log(`Pairs per record: total=${pairCounts.reduce((a,b)=>a+b,0)} nonzero=${pairCounts.filter(c=>c>0).length}/${pairCounts.length}`);

// Coord range
let minX=Infinity, maxX=0, minY=Infinity, maxY=0;
const coords = [];
for (const c of chunks) for (const r of c.records) for (const p of r.pairs) {
  if (p.x < minX) minX = p.x;
  if (p.x > maxX) maxX = p.x;
  if (p.y < minY) minY = p.y;
  if (p.y > maxY) maxY = p.y;
  coords.push({ x: p.x, y: p.y });
}
console.log(`Coord range: X[${minX}..${maxX}] Y[${minY}..${maxY}]`);
console.log(`Total coord pairs: ${coords.length}`);

// First 8 chunks summary
console.log("\n=== First 8 chunks ===");
for (let i = 0; i < Math.min(8, chunks.length); i++) {
  const c = chunks[i];
  const recsWithPairs = c.records.filter(r => r.pairCount > 0);
  console.log(`  chunk[${i}] @0x${c.start.toString(16)} N=${c.N}`);
  if (recsWithPairs.length > 0) {
    for (const r of recsWithPairs.slice(0, 5)) {
      console.log(`    rec @0x${r.selfPtr.toString(16)} pairs=${JSON.stringify(r.pairs)}`);
    }
  } else {
    console.log(`    (all ${c.N} records have pairCount=0)`);
  }
}

// Look at the chunks with most pairs
console.log("\n=== Top 10 chunks by total pairs ===");
const byPairs = chunks.map((c, i) => ({
  i,
  start: c.start,
  N: c.N,
  totalPairs: c.records.reduce((a, r) => a + r.pairCount, 0),
}));
byPairs.sort((a, b) => b.totalPairs - a.totalPairs);
for (const x of byPairs.slice(0, 10)) {
  console.log(`  chunk[${x.i}] @0x${x.start.toString(16)} N=${x.N} totalPairs=${x.totalPairs}`);
}

// Check: do chunk N values cluster? Is each chunk's N small (e.g. 1) or varied?
const nHist = {};
for (const c of chunks) nHist[c.N] = (nHist[c.N] || 0) + 1;
console.log("\n=== Chunk N histogram (top 20) ===");
const sortedN = Object.entries(nHist).sort((a, b) => b[1] - a[1]);
for (const [n, count] of sortedN.slice(0, 20)) {
  console.log(`  N=${n}: ${count} chunks`);
}
