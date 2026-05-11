// dig-tile-trail4.js — Try to map chunks to factions or characters.
// Approach: take chunk[0]'s coords and see if they cluster around a known faction's territory.
// Then try chunk[5]'s coords and see if they cluster differently.
// If each chunk's coords cluster around ONE faction's capital, it's per-faction.
// If they cluster diffusely, it's per-character.

const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

function parseTrail(buf, trailStart) {
  const chunks = [];
  let p = trailStart;
  while (p + 4 < buf.length) {
    const N = buf.readUInt32LE(p);
    if (N === 0) { p += 4; continue; }
    if (N > 200) break;
    const chunkStart = p;
    p += 4;
    const records = [];
    let valid = true;
    for (let i = 0; i < N; i++) {
      if (p + 6 > buf.length) { valid = false; break; }
      const selfPtr = buf.readUInt32LE(p);
      const pairCount = buf.readUInt16LE(p + 4);
      if (selfPtr !== p || pairCount > 100) { valid = false; break; }
      const pairs = [];
      p += 6;
      for (let j = 0; j < pairCount; j++) {
        if (p + 8 > buf.length) { valid = false; break; }
        pairs.push({ x: buf.readUInt32LE(p), y: buf.readUInt32LE(p + 4) });
        p += 8;
      }
      if (!valid) break;
      records.push({ selfPtr, pairCount, pairs });
    }
    if (!valid) { p = chunkStart; break; }
    chunks.push({ start: chunkStart, N, records });
  }
  return chunks;
}

const chunks = parseTrail(buf, 0x2110a24);

// For each chunk, compute centroid of coords
function centroid(coords) {
  if (coords.length === 0) return null;
  let sx = 0, sy = 0;
  for (const c of coords) { sx += c.x; sy += c.y; }
  return { x: sx / coords.length, y: sy / coords.length };
}

console.log("=== Per-chunk centroids (top 25 chunks by total pairs) ===");
const stats = chunks.map((c, i) => {
  const coords = c.records.flatMap(r => r.pairs);
  return { i, start: c.start, N: c.N, recs: c.records.length, coords, totalPairs: coords.length, centroid: centroid(coords) };
});
const top = stats.slice().sort((a, b) => b.totalPairs - a.totalPairs).slice(0, 25);
for (const s of top) {
  console.log(`  chunk[${s.i}] start=0x${s.start.toString(16)} N=${s.N} pairs=${s.totalPairs} centroid=${s.centroid ? `(${s.centroid.x.toFixed(0)},${s.centroid.y.toFixed(0)})` : "-"}`);
}

// Key question: chunk[0] is the FIRST chunk. Its coords cluster around (285, 410) — that's a tight area.
// Player faction (Romans Julii in RIS rome10) — Rome city is at approximately (270-285, 440-460).
// So chunk[0] centroid (285, 411) is in Italy = player Romans Julii area.
//
// Chunk[5] centroid (395, 380) — that's Greece area = Macedon or similar.
// Chunk[6] centroid — let me compute.
// Chunk[7] centroid — let me compute.

// Per-chunk centroids for first 25 chunks
console.log("\n=== First 25 chunks in file order ===");
for (let i = 0; i < 25; i++) {
  const s = stats[i];
  console.log(`  chunk[${i}] start=0x${s.start.toString(16)} N=${s.N} pairs=${s.totalPairs} centroid=${s.centroid ? `(${s.centroid.x.toFixed(0)},${s.centroid.y.toFixed(0)})` : "-"}`);
}

// Now correlate with major faction record positions (sessions 5-7 said 23 majors).
// Without explicit faction-record locations the best I can do is check if there are exactly 23 chunks with N >= some threshold.
const bigChunks = chunks.filter(c => c.N >= 50);
console.log(`\nChunks with N >= 50: ${bigChunks.length}`);
for (const c of bigChunks) console.log(`  @0x${c.start.toString(16)} N=${c.N}`);

// Chunks with N=7 are 111 — that's the "default" baseline for non-major or empty factions.
// 23 majors + 216 minors = 239. We see 221 chunks. Missing 18.
// Distinct N counts:
//   7 (default): 111
//   non-7 (real): 110
// So 110 unique-N chunks could be the 110 most-active entities, with 111 default-shape entries for the rest.

// Total chunks 221 ≈ 239 RIS factions - 18 vacant slots = 221. Plausible!
// Hypothesis (STRONG): each chunk = one faction's strategic-intent record.
//   - N = number of intent slots (varies by faction's activity level)
//   - N=7 is the default slot count (most minor factions)
//   - Pairs(X,Y) = the actual tile coords being "tracked"
//   - pairCount usually 0 (most slots are empty/no current intent)
//   - First chunk = player faction, biggest N

// To strengthen this, see if RoR-T1 has the same N pattern (chunks should match 1:1 by faction).

// Test: same chunk-N sequence in both saves.
const SAVE_ROR_T1 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav";
const buf2 = fs.readFileSync(SAVE_ROR_T1);
const chunks2 = parseTrail(buf2, 0x20e8237);
console.log(`\nRoR-T1 chunk count: ${chunks2.length}`);
const ns1 = chunks.map(c => c.N);
const ns2 = chunks2.map(c => c.N);
// Compare alignment
let matchCount = 0;
const minLen = Math.min(ns1.length, ns2.length);
for (let i = 0; i < minLen; i++) {
  if (ns1[i] === ns2[i]) matchCount++;
}
console.log(`N values matching at same chunk index: ${matchCount}/${minLen}`);

// If first few don't align, maybe rome10 has an extra chunk at start. Try shifting:
for (let shift = -3; shift <= 3; shift++) {
  let m = 0;
  const L = Math.min(ns1.length, ns2.length - shift);
  for (let i = Math.max(0, -shift); i < L; i++) {
    if (ns1[i] === ns2[i + shift]) m++;
  }
  console.log(`  shift=${shift}: ${m}/${L}`);
}
