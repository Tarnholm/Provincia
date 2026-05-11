// dig-path-cache3.js — Cross-save: compare trails between T1 and T5 (rome10).
// Strong test for path-cache: if same army at same tile both saves, trail's coords match.
// Also test: do trail pairs match army uuids in tail somehow?

const fs = require("fs");
const SAVE_ROME10 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const SAVE_ROR_T1 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav";

function parseTrail(buf, start) {
  const chunks = [];
  let p = start;
  while (p + 4 < buf.length) {
    const N = buf.readUInt32LE(p);
    if (N === 0) { p += 4; continue; }
    if (N > 200) break;
    const cs = p;
    p += 4;
    const recs = [];
    let ok = true;
    for (let i = 0; i < N; i++) {
      if (p + 6 > buf.length) { ok = false; break; }
      const sp = buf.readUInt32LE(p);
      const pc = buf.readUInt16LE(p + 4);
      if (sp !== p || pc > 100) { ok = false; break; }
      const pairs = [];
      p += 6;
      for (let j = 0; j < pc; j++) {
        const x = buf.readUInt32LE(p);
        const y = buf.readUInt32LE(p + 4);
        pairs.push({ x, y });
        p += 8;
      }
      recs.push({ off: sp, pc, pairs });
    }
    if (!ok) { p = cs; break; }
    chunks.push({ N, recs });
  }
  return chunks;
}

// Find trail start by scanning end of file for chunks
function findTrailStart(buf) {
  for (let off = buf.length - 0x20000; off < buf.length - 100; off += 4) {
    const chunks = parseTrail(buf, off);
    if (chunks.length > 50) return off;
  }
  return null;
}

const buf10 = fs.readFileSync(SAVE_ROME10);
const bufT1 = fs.readFileSync(SAVE_ROR_T1);

const trail10 = parseTrail(buf10, 0x2110a24);
const trailT1Start = findTrailStart(bufT1);
const trailT1 = parseTrail(bufT1, trailT1Start);
console.log(`rome10 (T5): ${trail10.length} chunks`);
console.log(`RoR-T1     : ${trailT1.length} chunks, start=0x${trailT1Start.toString(16)}`);

// Per-chunk: collect non-empty record coords as set, and totalPairs
function chunkSummary(chunk) {
  const nonEmpty = chunk.recs.filter(r => r.pc > 0);
  const coords = new Set();
  for (const r of nonEmpty) for (const p of r.pairs) coords.add(`${p.x},${p.y}`);
  return { N: chunk.N, nonEmptyCount: nonEmpty.length, totalPairs: chunk.recs.reduce((s,r) => s + r.pc, 0), coords };
}
const sum10 = trail10.map(chunkSummary);
const sumT1 = trailT1.map(chunkSummary);

// Align: per session 16 the alignment is shift=-2 (RoR-T1 has 2 fewer chunks at front)
const shift = 2;
let nMatch = 0;
for (let i = 0; i + shift < trail10.length && i < trailT1.length; i++) {
  if (sumT1[i].N === sum10[i + shift].N) nMatch++;
}
console.log(`Chunks with matching N at shift=+${shift}: ${nMatch} / ${Math.min(trail10.length - shift, trailT1.length)}`);

// Now do coord intersection per matching chunk
let totalSharedCoords = 0, totalUnion = 0, totalChunks = 0;
let chunksWithSharedCoords = 0;
const samples = [];
for (let i = 0; i + shift < trail10.length && i < trailT1.length; i++) {
  if (sumT1[i].N !== sum10[i + shift].N) continue;
  if (sumT1[i].coords.size === 0 && sum10[i + shift].coords.size === 0) continue;
  totalChunks++;
  const c1 = sumT1[i].coords;
  const c2 = sum10[i + shift].coords;
  const shared = [...c1].filter(c => c2.has(c));
  const union = new Set([...c1, ...c2]);
  totalSharedCoords += shared.length;
  totalUnion += union.size;
  if (shared.length > 0) chunksWithSharedCoords++;
  if (samples.length < 10 && (c1.size > 0 || c2.size > 0)) {
    samples.push({
      chunkIdx_T1: i, chunkIdx_10: i + shift,
      N: sumT1[i].N,
      T1_coords: [...c1], rome10_coords: [...c2],
      shared,
    });
  }
}
console.log(`\nChunks with at least one trail coord (both saves): ${totalChunks}`);
console.log(`Chunks with at least one SHARED coord between saves: ${chunksWithSharedCoords}`);
console.log(`Total shared coords: ${totalSharedCoords}, total union: ${totalUnion}`);
console.log(`Trail coord stability T1→T5: ${(totalSharedCoords / totalUnion * 100).toFixed(1)}%`);

// Show samples
console.log(`\n--- Sample matched chunks ---`);
for (const s of samples) {
  console.log(`\n  chunk T1=${s.chunkIdx_T1} rome10=${s.chunkIdx_10} N=${s.N}`);
  console.log(`    T1     coords (${s.T1_coords.length}): ${s.T1_coords.join(" | ")}`);
  console.log(`    rome10 coords (${s.rome10_coords.length}): ${s.rome10_coords.join(" | ")}`);
  console.log(`    shared (${s.shared.length}): ${s.shared.join(" | ")}`);
}

// Test: per session 16, chunk[0] (rome10) is Romans Julii player faction with centroid (291, 405).
// If trails are per-army-tile, then in T1 the player only has a few units near Rome.
// If trails are per-faction-AI-target, the SAME tiles appear in both saves (faction's known interest).
// The shared/union ratio answers: stable per-faction state (high) vs per-army intent (low).

// Plus deeper: examine player chunk[0]
console.log(`\n--- Player chunk[0] rome10 vs T1 chunk[shift=-2 → ?] ---`);
console.log(`rome10 chunk[0] N=${trail10[0].N} nonEmpty=${sum10[0].nonEmptyCount}`);
console.log(`  trails: ${trail10[0].recs.filter(r => r.pc > 0).map(r => r.pairs.map(p => `(${p.x},${p.y})`).join("→")).join(" | ")}`);

// Find best alignment for chunk[0]: shift=-2 in T1 = compare T1[?] to rome10[0]?
// Actually the convention is "RoR-T1 has 2 fewer at the beginning". So T1[0] aligns to rome10[2].
// → rome10[0] has no T1 analogue. Try various shifts:
console.log("\nTry various rome10[0] → T1[?] candidates:");
for (let i = 0; i < Math.min(5, trailT1.length); i++) {
  const t1 = trailT1[i];
  console.log(`  T1 chunk[${i}] N=${t1.N} nonEmpty=${t1.recs.filter(r=>r.pc>0).length}`);
}
