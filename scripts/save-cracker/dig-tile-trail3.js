// dig-tile-trail3.js — Correlate chunks with factions and characters.
// 221 chunks in rome10. RIS has 239 factions (23+216). Not matching.
// Maybe chunks = characters in the file. Session 12 noted ~3000+ characters,
// so 221 is much less than that.
//
// What does 221 correlate with? Hypotheses:
// 1. Number of "named generals" (vs captains). Captains have no record per session 14.
// 2. Number of regions × something.
// 3. Number of factions in play (RIS may have only some factions actually playable).
// 4. Number of armies/settlements with strategic intent.

const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

// Re-parse the trail
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
  return chunks;
}

const chunks = parseTrail(buf, 0x2110a24);
console.log(`Total chunks: ${chunks.length}`);

// Histogram of chunk N values
const nFreq = {};
for (const c of chunks) nFreq[c.N] = (nFreq[c.N] || 0) + 1;
console.log("\nN histogram (all values, sorted by N):");
for (const [n, freq] of Object.entries(nFreq).sort((a, b) => +a[0] - +b[0])) {
  console.log(`  N=${n}: ${freq}`);
}

// Total records sum
const totalRecs = chunks.reduce((a, c) => a + c.records.length, 0);
console.log(`\nTotal records across all chunks: ${totalRecs}`);

// Sum of N values (should equal totalRecs if N matches record count)
const sumN = chunks.reduce((a, c) => a + c.N, 0);
console.log(`Sum of N: ${sumN}`);

// Per session 9 we have 23 majors + 216 minors = 239 factions.
// 221 chunks ≈ 239 with some missing. Maybe 18 factions don't have entries.
// Total records 2503 — if each chunk maps to a faction, records inside could be regions/armies/characters.
// Avg records per chunk = 2503/221 = 11.32

// Check distribution of records-per-chunk. Many chunks have 7 records — that's almost a "default" baseline.
// Maybe 7 records = 7 standard "tile-trail categories" per faction (e.g., recently visited tiles for X scoring criteria).

// Let me cross-validate against the start of body — does the chunk count match the count
// at body root?
// From session 12: body root direct children = CHARACTER_PATHS records (one per known character).
// Sessions reported ~3000+ characters.

// Possibility: 221 chunks correspond to FACTIONS, with one chunk per faction's strategic targets.
// The 23 majors are the first 23 chunks? Let me see if first 23 chunks have higher N values.
console.log("\nFirst 24 chunks N values:");
for (let i = 0; i < 24; i++) {
  if (chunks[i]) console.log(`  chunk[${i}] N=${chunks[i].N}`);
}

// Total pairs across all chunks
const totalPairs = chunks.reduce((a, c) => a + c.records.reduce((b, r) => b + r.pairCount, 0), 0);
console.log(`\nTotal coord pairs: ${totalPairs}`);

// Chunks with pairCount > 0 in any record — that's the "active" chunks
const activeChunks = chunks.filter(c => c.records.some(r => r.pairCount > 0));
console.log(`Chunks with at least one non-empty pair: ${activeChunks.length}/${chunks.length}`);

// Geographical cluster: chunk 0 (N=104) — biggest single chunk. What's its coords?
console.log("\n=== chunk[0] all non-empty coords ===");
const c0 = chunks[0];
for (let i = 0; i < c0.records.length; i++) {
  const r = c0.records[i];
  if (r.pairCount > 0) {
    console.log(`  rec[${i}] @0x${r.selfPtr.toString(16)}: ${JSON.stringify(r.pairs)}`);
  }
}

// chunk[5] N=155 — the BIGGEST chunk by N.
console.log("\n=== chunk[5] (N=155) all non-empty coords ===");
const c5 = chunks[5];
for (let i = 0; i < c5.records.length; i++) {
  const r = c5.records[i];
  if (r.pairCount > 0) {
    console.log(`  rec[${i}] @0x${r.selfPtr.toString(16)}: ${JSON.stringify(r.pairs)}`);
  }
}

// Sum of records-per-chunk: what's the cumulative for the first 23 (potential majors)?
let cumRecs = 0;
console.log("\nCumulative recs in first 23 chunks:");
for (let i = 0; i < 23; i++) {
  if (chunks[i]) cumRecs += chunks[i].records.length;
}
console.log(`  cumRecs[0..22]=${cumRecs} (vs total ${totalRecs})`);

// Player faction (Romans Julii in rome10) — likely chunk[0] with N=104
// If N=records is "settlements/armies belonging to this faction", 104 settlements is plausible for player.
