// Session 26 — Re-validate the Δ=1 character-path hypothesis under unified SCHEMA-A.

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

const FULL_START = 0x51b5;
const FULL_END = 0x846af;
const STRIDE = 12;
const N = Math.floor((FULL_END - FULL_START) / STRIDE);

const recs = [];
for (let i = 0; i < N; i++) {
  const o = FULL_START + i*STRIDE;
  recs.push({
    i, o,
    hash: buf.readUInt32LE(o) >>> 0,
    flag: buf[o+4], sub: buf[o+5],
    idA: buf.readUInt16LE(o+6),
    idB: buf.readUInt32LE(o+8)
  });
}

// Valid filter
const valid = recs.filter(r=>(r.flag===1||r.flag===2||r.flag===4) && (r.sub===0||r.sub===0x20) && r.idB > 0 && r.idB < 800 && r.idA < 4096);

// Per-hash Δ=1 streak analysis
const hashRecs = {};
for (const r of valid) {
  if (r.hash === 0) continue;
  if (!hashRecs[r.hash]) hashRecs[r.hash] = [];
  hashRecs[r.hash].push(r);
}

const allStrides = {};
const runLengths = [];
for (const [h, rs] of Object.entries(hashRecs)) {
  if (rs.length < 2) continue;
  let runLen = 1;
  for (let i = 1; i < rs.length; i++) {
    if (rs[i].i === rs[i-1].i + 1) runLen++;
    else {
      if (runLen > 1) runLengths.push({h, len: runLen, year: rs[i-1].idB});
      runLen = 1;
    }
    // Stride
    if (rs[i].i === rs[i-1].i + 1) {
      const s = rs[i].idA - rs[i-1].idA;
      allStrides[s] = (allStrides[s]||0)+1;
    }
  }
  if (runLen > 1) runLengths.push({h, len: runLen, year: rs[rs.length-1].idB});
}
console.log('Δ=1 strict-consecutive runs:', runLengths.length);
const runH = {};
for (const r of runLengths) runH[r.len] = (runH[r.len]||0)+1;
console.log('Run-length distribution (top 20):');
Object.entries(runH).sort((a,b)=>parseInt(a[0])-parseInt(b[0])).slice(0,20).forEach(([l,c])=>console.log('  len=' + l + ': ' + c));

console.log('\nStride distribution (top 15):');
Object.entries(allStrides).sort((a,b)=>b[1]-a[1]).slice(0,15).forEach(([s,c])=>console.log('  Δ=' + s + ': ' + c));

// idA-as-tile cross-check: are stride values consistent with tile-adjacency?
// On a 32×32 chunked grid: idA-stride 1 = horizontal neighbor; idA-stride 32 = vertical neighbor
// On 38-wide grid: stride 38 = vertical neighbor
// Let me check 2nd-most-common strides

// Find characters with LONGEST paths
const longest = runLengths.sort((a,b)=>b.len-a.len).slice(0,10);
console.log('\nTop 10 longest runs:');
for (const run of longest) {
  // Show actual idA sequence
  const rs = hashRecs[run.h];
  const slice = rs.filter(r=>r.idB === run.year).map(r=>r.idA);
  const path = slice.slice(0, Math.min(25, slice.length));
  console.log('  hash=0x' + parseInt(run.h).toString(16) + ' year=' + run.year + ' len=' + run.len + ' idA path: ' + path.join(','));
}

// HYPOTHESIS: idA is a tile-graph node index (not a 2D grid coord)
// Maximum idA = 1018 — too small for a 240×238 grid (57120 tiles)
// 1018 is close to 1024 = 2^10. Suggests idA is a 10-bit code: tile-cluster ID? Region ID?
// Actually, descr_strat declares 1831 settlements. idA might be settlement ID.
// Or 1018 = number of "named places" / "scripted positions" on the map

// Test if idA == sequence in settlement-order
// Hmm — top idA values like 533, 557, 576 don't look like settlement IDs

// Maybe idA is a "tile-graph node" along the road/movement network
// Strider Δ=1 = move to next adjacent node in graph traversal order

// Cross-correlate with character_paths sections at 0xa8beb..0xf8f9b
// 469 sections; if those ARE per-character path caches, the idA values here should map to nodes
// in those graphs

// Let me check timing: ROR-T1 save vs rome10
const ROR_T1 = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav';
if (require('fs').existsSync(ROR_T1)) {
  const buf2 = require('fs').readFileSync(ROR_T1);
  // Find event log region. Sessions 12+ noted RoR-T1 first child end. Let me locate dynamically.
  // Find ASCII string "campaign/imperial_campaign" UTF-16LE first; then 13.9KB later = section start
  // Actually the event-log starts after the char-UUID-index. In RoR-T1, look for similar pattern.
  // Easier: scan buf2 for the pattern "01 20 11 01" (= flag=1,sub=0x20,idA=0x111) etc.
  // Or look for the first non-zero "year=1" record under SCHEMA-A

  // The schema starts with hash=0 records. After preamble. Easier: skip preamble.
  // Let's find a confirmation: rome10's main event log starts at 0x87e9 with "01 20 11 01 13 01 00 00 0b d1 22 ec"
  // Then 0x87dd has the prior record under SCHEMA-A: hash=0xec22d10b, idA=272, idB=275

  // For RoR-T1, the equivalent of 0x87e9 should be at a similar relative position.
  // Per session 12 dossier: RoR-T1 first child at 0x3ba0+, kid[0] of about same size.
  // The event-log region size is fixed by schema, so 521KB region should exist similarly.

  // Look for hash=0xec22d10b in RoR-T1
  const target = Buffer.from('0bd122ec', 'hex');
  let off = 0;
  let count = 0;
  while (off < buf2.length - 4) {
    let m = true;
    for (let j = 0; j < 4; j++) if (buf2[off+j] !== target[j]) { m = false; break; }
    if (m) {
      if (count < 5) console.log('RoR-T1: hash 0xec22d10b at 0x' + off.toString(16));
      count++;
    }
    off++;
  }
  console.log('RoR-T1: hash 0xec22d10b total occurrences:', count);
  // rome10 count for same hash
  const tgtCount = recs.filter(r=>r.hash === 0xec22d10b).length;
  console.log('rome10: same hash records:', tgtCount);
}

// SUMMARY: Provincial summary for findings
console.log('\n=== SUMMARY ===');
console.log('Total slots:', N);
console.log('Valid event records:', valid.length);
console.log('All-zero (reserved/empty):', recs.filter(r=>r.flag===0 && r.sub===0 && r.idA===0 && r.idB===0 && r.hash===0).length);
console.log('Distinct hashes:', new Set(valid.map(r=>r.hash)).size);
console.log('idB year range:', Math.min(...valid.map(r=>r.idB)), '..', Math.max(...valid.map(r=>r.idB)));
console.log('idA range:', Math.min(...valid.map(r=>r.idA)), '..', Math.max(...valid.map(r=>r.idA)));

// Flag/sub semantics
console.log('\nFlag semantics:');
console.log('  flag=1 (sub=0x20):  ' + valid.filter(r=>r.flag===1 && r.sub===0x20).length + ' — most common, 78% — primary actor event');
console.log('  flag=4 (sub=0):     ' + valid.filter(r=>r.flag===4 && r.sub===0).length + ' — 9% — unowned/unscripted event (hash often 0)');
console.log('  flag=2 (sub=0x20):  ' + valid.filter(r=>r.flag===2 && r.sub===0x20).length + ' — 7% — secondary event');
