// dig-tile-trail2.js — Better tile-trail parser. Skip zero-padding between chunks.

const fs = require("fs");

const SAVE_ROME10 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const SAVE_ROR_T1 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav";

function parseTrail(buf, trailStart) {
  const chunks = [];
  let p = trailStart;
  while (p + 4 < buf.length) {
    const N = buf.readUInt32LE(p);
    if (N === 0) {
      // Skip zero bytes
      p += 4;
      continue;
    }
    if (N > 200) break;
    const chunkStart = p;
    p += 4;
    const records = [];
    let valid = true;
    for (let i = 0; i < N; i++) {
      if (p + 6 > buf.length) { valid = false; break; }
      const selfPtr = buf.readUInt32LE(p);
      const pairCount = buf.readUInt16LE(p + 4);
      if (selfPtr !== p) { valid = false; break; }
      if (pairCount > 100) { valid = false; break; }
      const pairs = [];
      p += 6;
      for (let j = 0; j < pairCount; j++) {
        if (p + 8 > buf.length) { valid = false; break; }
        const x = buf.readUInt32LE(p);
        const y = buf.readUInt32LE(p + 4);
        pairs.push({ x, y });
        p += 8;
      }
      if (!valid) break;
      records.push({ selfPtr, pairCount, pairs });
    }
    if (!valid) { p = chunkStart; break; }
    chunks.push({ start: chunkStart, N, records });
  }
  return { chunks, endOffset: p };
}

for (const [name, savePath, trailStart] of [
  ["rome10",  SAVE_ROME10, 0x2110a24],
  ["RoR-T1",  SAVE_ROR_T1, null],
]) {
  console.log(`\n=== ${name} ===`);
  const buf = fs.readFileSync(savePath);
  let start = trailStart;
  if (!start) {
    // Find trail start. session 14 says it's after lua counters which start at 0x210f56f in rome10.
    // For RoR-T1, the lua counters are at similar offset relative to end.
    // Find by scanning from EOF backward for the first chunk N value that makes sense.
    // Easier: find the last spot where chunks parse cleanly from buf.length-X backward.
    // For RoR-T1 file ends at 0x20ec903; trail likely at ~0x20e8xxx.
    // Let's just scan from end-30KB for self-pointing chunks.
    for (let off = buf.length - 0x10000; off < buf.length - 100; off += 4) {
      const r = parseTrail(buf, off);
      if (r.chunks.length > 20 && r.endOffset > buf.length - 100) {
        start = off;
        break;
      }
    }
    console.log(`Found trail start: 0x${start ? start.toString(16) : "?"}`);
    if (!start) continue;
  }
  const r = parseTrail(buf, start);
  console.log(`Total chunks: ${r.chunks.length}, endOffset 0x${r.endOffset.toString(16)} (file end 0x${buf.length.toString(16)})`);

  const totalRecs = r.chunks.reduce((a, c) => a + c.records.length, 0);
  const totalPairs = r.chunks.reduce((a, c) => a + c.records.reduce((b, rr) => b + rr.pairCount, 0), 0);
  console.log(`Total records: ${totalRecs}  total pairs: ${totalPairs}`);

  // Histogram of N values
  const nHist = {};
  for (const c of r.chunks) nHist[c.N] = (nHist[c.N] || 0) + 1;
  console.log("N histogram (top 15):");
  for (const [n, count] of Object.entries(nHist).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  N=${n}: ${count} chunks`);
  }

  // Spatial clustering: where are the coords?
  const allCoords = [];
  for (const c of r.chunks) for (const rec of c.records) for (const pp of rec.pairs) allCoords.push(pp);
  if (allCoords.length > 0) {
    const xs = allCoords.map(c => c.x);
    const ys = allCoords.map(c => c.y);
    console.log(`  Coord range: X=[${Math.min(...xs)}..${Math.max(...xs)}] Y=[${Math.min(...ys)}..${Math.max(...ys)}]`);
  }

  // First few chunks with their first non-zero coord
  console.log("First 20 chunks (start, N, recCount, firstNonZeroCoord):");
  for (let i = 0; i < Math.min(20, r.chunks.length); i++) {
    const c = r.chunks[i];
    const firstPair = c.records.flatMap(rr => rr.pairs)[0];
    console.log(`  chunk[${i}] @0x${c.start.toString(16)} N=${c.N} recs=${c.records.length}` +
      (firstPair ? ` firstCoord=(${firstPair.x},${firstPair.y})` : " noCoords"));
  }
  // Last 5 chunks
  console.log("Last 5 chunks:");
  for (let i = Math.max(0, r.chunks.length - 5); i < r.chunks.length; i++) {
    const c = r.chunks[i];
    const firstPair = c.records.flatMap(rr => rr.pairs)[0];
    console.log(`  chunk[${i}] @0x${c.start.toString(16)} N=${c.N} recs=${c.records.length}` +
      (firstPair ? ` firstCoord=(${firstPair.x},${firstPair.y})` : " noCoords"));
  }
}
