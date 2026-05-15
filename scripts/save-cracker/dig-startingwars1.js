// dig-startingwars1.js - Session 50 attempt 1.
// Find where the 255 starting WARS declared in RIS imperial's descr_strat.txt
// are stored in save_1.2 (RIS imperial turn 1).
//
// Session 49 confirmed the bilateral 239x239 matrix at 0xf8fd2 is all-default
// (prev=5, curr=0, +8=0) at turn 1 - so wars are NOT preloaded there. They
// must be encoded elsewhere.
//
// Strategy: build ground-truth list of 255 (idxA, idxB) war pairs, then
// test all four hypotheses in turn:
//   H1: per-faction trailing data (look for u32 arrays of faction indices)
//   H2: separate compact matrix (u8 bitmap of 7140 bytes or u16 of 14281)
//   H3: AI policy array values encode war pairs as a*239+b
//   H4: f0 0a af f0 RLE TAIL holds per-faction known-wars
//
// Hard early-stop after 3 attempts: this is attempt 1, tests H1-H4 in one go.

const fs = require('fs');
const path = require('path');

const SM_PATH = 'C:/RIS/RIS/data/descr_sm_factions.txt';
const DS_PATH = 'C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt';
const SAVE_PATH = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';

const N = 239;

// ---- Parse faction list (same as session 49) ----
function parseFactionList(text) {
  const factions = [];
  const lines = text.split(/\r?\n/);
  let inArr = false;
  let depth = 0;
  for (const raw of lines) {
    const stripped = raw.replace(/;.*$/, '');
    if (!inArr) {
      if (/^"factions"\s*:/.test(stripped.trim())) inArr = true;
      continue;
    }
    for (const ch of stripped) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth === 0 && /^\s*\]/.test(stripped)) break;
    if (depth !== 0) continue;
    const m = stripped.match(/^\s*"([a-z_][a-z_0-9]*)"\s*:/);
    if (m) factions.push(m[1]);
  }
  return factions;
}

let smText;
try { smText = fs.readFileSync(SM_PATH, 'utf8'); }
catch { smText = fs.readFileSync('C:/dev/Provincia/public/descr_sm_factions.txt', 'utf8'); }
let factions = parseFactionList(smText);
if (factions.length !== N) {
  factions = parseFactionList(fs.readFileSync('C:/dev/Provincia/public/descr_sm_factions.txt', 'utf8'));
}
if (factions.length !== N) { console.error(`Got ${factions.length}, want ${N}`); process.exit(1); }
const idxOf = new Map(factions.map((n, i) => [n, i]));
console.log(`Parsed ${factions.length} factions. romans_julii=${idxOf.get('romans_julii')} messapians=${idxOf.get('messapians')} taras=${idxOf.get('taras')} vettones=${idxOf.get('vettones')} slave=${idxOf.get('slave')}`);

// ---- Parse descr_strat for war declarations ----
const dsText = fs.readFileSync(DS_PATH, 'utf8');
const warPairsSet = new Set();   // 'min|max' for unordered
const warPairsArr = [];          // ordered as declared (idxA, idxB)

for (const raw of dsText.split(/\r?\n/)) {
  const semi = raw.indexOf(';');
  let line = semi >= 0 ? raw.slice(0, semi) : raw;
  line = line.trim();
  if (!line) continue;
  const m = line.match(/^faction_relationships\s+([a-z_][a-z_0-9]*)\s*,?\s+(-?\d+)\s+([a-z_][a-z_0-9]*)/);
  if (!m) continue;
  const [, a, vStr, b] = m;
  const v = parseInt(vStr, 10);
  if (v < 201) continue;  // not a war
  const ia = idxOf.get(a);
  const ib = idxOf.get(b);
  if (ia == null || ib == null) continue;
  const key = ia < ib ? `${ia}|${ib}` : `${ib}|${ia}`;
  if (!warPairsSet.has(key)) {
    warPairsSet.add(key);
    warPairsArr.push([ia, ib]);
  }
}
console.log(`Parsed ${warPairsArr.length} unique war pairs from descr_strat (target ~255)`);

// Build per-faction enemy lists
const enemiesOf = new Map();
for (const [a, b] of warPairsArr) {
  if (!enemiesOf.has(a)) enemiesOf.set(a, new Set());
  if (!enemiesOf.has(b)) enemiesOf.set(b, new Set());
  enemiesOf.get(a).add(b);
  enemiesOf.get(b).add(a);
}
// Show a few faction enemy counts
const factionsByEnemyCount = [...enemiesOf.entries()].sort((a, b) => b[1].size - a[1].size);
console.log('\nTop 10 factions by enemy count:');
for (const [idx, set] of factionsByEnemyCount.slice(0, 10)) {
  console.log(`  ${factions[idx]} (idx ${idx}): ${set.size} enemies`);
}
console.log('Romans Julii enemies:', enemiesOf.has(0) ? [...enemiesOf.get(0)].sort((a,b)=>a-b).map(i => `${factions[i]}(${i})`).join(', ') : 'NONE');

// ---- Load save ----
const buf = fs.readFileSync(SAVE_PATH);
console.log(`\nLoaded save size=${buf.length} (0x${buf.length.toString(16)})`);

// ---- Locate major faction records ----
function findMajors(buf) {
  const out = [];
  for (let p = 0; p < buf.length - 64; p += 4) {
    if (buf.readUInt32LE(p + 8) !== 100) continue;
    if (buf.readUInt32LE(p + 12) !== 1) continue;
    if (buf.readUInt32LE(p + 44) !== 6) continue;
    if (buf.readUInt32LE(p + 24) !== p + 24) continue;
    if (buf.readUInt32LE(p + 40) !== p + 40) continue;
    out.push(p);
  }
  return out;
}
const majors = findMajors(buf);
console.log(`Found ${majors.length} major-faction records: ${majors.map(p => '0x' + p.toString(16)).join(' ')}`);

// Read region list to identify each record's faction (per session 9)
function readRecord(buf, base) {
  const treasury = buf.readInt32LE(base + 0);
  const regionCount = buf.readUInt32LE(base + 48);
  const regions = [];
  for (let i = 0; i < regionCount && i < 200; i++) {
    regions.push(buf.readUInt32LE(base + 52 + i * 4));
  }
  return { base, treasury, regionCount, regions };
}

const records = majors.map(p => readRecord(buf, p));
console.log('\nMajor records:');
records.forEach((r, i) => {
  console.log(`  [${i}] @0x${r.base.toString(16)} treasury=${r.treasury} regions=${r.regionCount}`);
});

// ---- Identify each record by region fingerprint ----
// Parse descr_strat for faction owns -> region list
function parseStartingRegions(dsText) {
  // descr_strat blocks like:
  //   faction <name>, ...
  //   ...
  //   own <regionName>
  // But we want region IDs. Cross-check with public/regions_large.json.
  // SIMPLER: per session 9, the region list at +52 is the faction's starting
  // territory. The 23 major factions in RIS have a known set. We'll use a
  // fingerprint mapper: read all 23 records' regionCount and use that as a
  // disambiguator. Major faction count per descr_strat:
  const factionStart = new Map(); // faction name -> Set of region names
  const lines = dsText.split(/\r?\n/);
  let curFaction = null;
  for (const raw of lines) {
    const semi = raw.indexOf(';');
    let line = semi >= 0 ? raw.slice(0, semi) : raw;
    line = line.trim();
    if (!line) continue;
    let m = line.match(/^faction\s+([a-z_][a-z_0-9]*)\s*,/);
    if (m) {
      curFaction = m[1];
      if (!factionStart.has(curFaction)) factionStart.set(curFaction, new Set());
      continue;
    }
    m = line.match(/^own\s+([A-Za-z_][A-Za-z_0-9]*)/);
    if (m && curFaction) {
      factionStart.get(curFaction).add(m[1]);
    }
  }
  return factionStart;
}
const facStarting = parseStartingRegions(dsText);
console.log('\nFactions with starting regions parsed (count -> name):');
const byCount = [...facStarting.entries()].sort((a,b)=>b[1].size-a[1].size);
for (const [name, set] of byCount.slice(0, 30)) {
  console.log(`  ${name}: ${set.size}`);
}

// Match record -> faction via regionCount (loose) since region IDs from JSON
// to descr_strat names is a separate mapping. Just print regionCount per record
// alongside each candidate faction with that count.
console.log('\nRecord regionCount candidates:');
records.forEach((r, i) => {
  const cands = byCount.filter(([n, s]) => s.size === r.regionCount).map(([n]) => n);
  console.log(`  [${i}] regionCount=${r.regionCount} -> candidates: ${cands.join(', ')}`);
});

// ---- HYPOTHESIS 2 (cheapest): scan save for u8 bitmap of 239x239 wars ----
// 239*239 = 57121 bits = 7140 bytes
// 239*238/2 = 28441 bits = 3555 bytes (symmetric upper-triangular bitmap)
// 239*239 bytes = 57121 bytes (u8 cell array)
// 239*239*4 bytes = 228484 bytes (u32 cell array)
//
// Plan: produce expected bitmap from war pairs, slide it through buf as
// a 7140-byte target, score matches. Also test the upper-triangular form.

console.log('\n=== H2: search for war bitmaps in save ===');

function buildSquareBitmap() {
  const bm = Buffer.alloc(Math.ceil(N * N / 8));
  for (const [a, b] of warPairsArr) {
    const i1 = a * N + b;
    bm[i1 >> 3] |= 1 << (i1 & 7);
    const i2 = b * N + a;
    bm[i2 >> 3] |= 1 << (i2 & 7);
  }
  return bm;
}
function buildTriangularBitmap() {
  // (a*N + b) where a<b, indexed by k = a*(2N-a-1)/2 + (b-a-1)
  // or simpler: pair to index map. Just enumerate all pairs.
  const numBits = N * (N - 1) / 2;
  const bm = Buffer.alloc(Math.ceil(numBits / 8));
  function pairIdx(a, b) {
    if (a > b) [a, b] = [b, a];
    return a * (2 * N - a - 1) / 2 + (b - a - 1);
  }
  for (const [a, b] of warPairsArr) {
    const i = pairIdx(a, b);
    bm[i >> 3] |= 1 << (i & 7);
  }
  return bm;
}
function buildSquareU8() {
  // u8 cell with 1 = war, 0 = no
  const bm = Buffer.alloc(N * N);
  for (const [a, b] of warPairsArr) {
    bm[a * N + b] = 1;
    bm[b * N + a] = 1;
  }
  return bm;
}

const sqBm = buildSquareBitmap();
const triBm = buildTriangularBitmap();
const sqU8 = buildSquareU8();
console.log(`  Square bitmap: ${sqBm.length} bytes (popcount ${popCount(sqBm)})`);
console.log(`  Triangular bitmap: ${triBm.length} bytes (popcount ${popCount(triBm)})`);
console.log(`  Square u8 array: ${sqU8.length} bytes (sum ${sumU8(sqU8)})`);

function popCount(buf) {
  let n = 0;
  for (const b of buf) {
    let x = b;
    while (x) { n += x & 1; x >>>= 1; }
  }
  return n;
}
function sumU8(buf) {
  let s = 0; for (const b of buf) s += b; return s;
}

// Slide each target through save, score = byte equality count per offset.
// For perf we use a coarse scan: stride 1 with early-out at 16 mismatches.
function scanForBuffer(haystack, needle, label, maxStride = 1) {
  const nL = needle.length;
  const hL = haystack.length;
  console.log(`  Scanning for "${label}" (${nL} bytes) through ${hL} bytes save (stride=${maxStride})...`);
  let best = -1, bestOff = -1, hits = [];
  const tic = Date.now();
  // For huge bitmaps (7140), exhaustive scan = expensive. Use a heuristic
  // first: find positions where popcount of haystack[off..off+nL] matches
  // needle popcount within ~5%, then full-compare.
  const needPop = popCount(needle);
  for (let off = 0; off < hL - nL; off += maxStride) {
    // Quick filter: first 16 bytes match >= 12 of needle's first 16 bytes
    let pre = 0;
    for (let i = 0; i < 16 && i < nL; i++) {
      if (haystack[off + i] === needle[i]) pre++;
    }
    if (pre < 12) continue;
    // Full byte-by-byte score
    let score = pre;
    for (let i = 16; i < nL; i++) {
      if (haystack[off + i] === needle[i]) score++;
    }
    if (score > best) { best = score; bestOff = off; hits = [[off, score]]; }
    else if (score === best) { hits.push([off, score]); }
  }
  console.log(`  best=${best}/${nL} (${((best/nL)*100).toFixed(1)}%) @ 0x${bestOff.toString(16)}  in ${((Date.now()-tic)/1000).toFixed(1)}s`);
  if (hits.length > 1) console.log(`    ${hits.length} positions tied at this score`);
  return { best, bestOff, target: nL };
}

// The full O(N*save) scan would be ~250GB ops; instead use a smarter
// approach: hash the bitmap into 32-byte blocks and look for high-overlap
// regions via FNV check on every 32-byte boundary. For now skip the full
// scan and instead scan only the gap region 0x80000..0x600000 (settlement
// zone) which is where compact bitmaps tend to live, and outside the giant
// 9.78MB matrix gap (0x633c50..0xf84632).
console.log(`  (skipping H2 full-save scan, too expensive; doing targeted scan)`);

// Targeted scan: scan in chunks outside the known huge gaps (matrix is at
// 0xf8fd2). Just sample popcount-density.
const sqPop = popCount(sqBm);
const triPop = popCount(triBm);
console.log(`  sq popcount=${sqPop}, tri popcount=${triPop}`);

// Scan window: find any 7140-byte region whose popcount is within ±5 of sqPop,
// or 3555-byte region within ±5 of triPop. These are candidate bitmap locations.
function findPopcountWindows(buf, winLen, targetPop, tolerance) {
  const hits = [];
  // Sliding window popcount, stride 16 (cheap; we just want order-of-magnitude
  // candidates).
  const stride = 16;
  let curPop = 0;
  // initial window
  for (let i = 0; i < winLen; i++) {
    let x = buf[i]; while (x) { curPop += x & 1; x >>>= 1; }
  }
  for (let off = 0; off < buf.length - winLen; off += stride) {
    if (Math.abs(curPop - targetPop) <= tolerance) hits.push([off, curPop]);
    // Slide by stride: subtract first `stride` bytes, add next `stride` bytes
    for (let i = 0; i < stride && off + i < buf.length - winLen; i++) {
      let x = buf[off + i]; while (x) { curPop -= x & 1; x >>>= 1; }
      let y = buf[off + winLen + i]; while (y) { curPop += y & 1; y >>>= 1; }
    }
  }
  return hits;
}

console.log('  Searching for 7140-byte windows with popcount ~510 (sq bm has 510 set bits)...');
const sqHits = findPopcountWindows(buf, 7140, sqPop, 5);
console.log(`    Found ${sqHits.length} candidate windows. First 10: ${sqHits.slice(0,10).map(([o,p]) => `0x${o.toString(16)}(${p})`).join(', ')}`);

console.log('  Searching for 3555-byte windows with popcount ~255 (tri bm has 255 set bits)...');
const triHits = findPopcountWindows(buf, 3555, triPop, 5);
console.log(`    Found ${triHits.length} candidate windows. First 10: ${triHits.slice(0,10).map(([o,p]) => `0x${o.toString(16)}(${p})`).join(', ')}`);

// Of those candidates, score byte-equality of the FIRST FEW only (too many otherwise)
function scoreAt(buf, off, needle) {
  let s = 0;
  for (let i = 0; i < needle.length; i++) if (buf[off + i] === needle[i]) s++;
  return s;
}
console.log('  Best byte-equality on candidate windows:');
{
  let best = -1, bestOff = -1;
  for (const [off] of sqHits) {
    const s = scoreAt(buf, off, sqBm);
    if (s > best) { best = s; bestOff = off; }
  }
  console.log(`    sq best=${best}/${sqBm.length} (${((best/sqBm.length)*100).toFixed(1)}%) @ 0x${(bestOff||0).toString(16)}`);
}
{
  let best = -1, bestOff = -1;
  for (const [off] of triHits) {
    const s = scoreAt(buf, off, triBm);
    if (s > best) { best = s; bestOff = off; }
  }
  console.log(`    tri best=${best}/${triBm.length} (${((best/triBm.length)*100).toFixed(1)}%) @ 0x${(bestOff||0).toString(16)}`);
}

// ---- HYPOTHESIS 1: per-faction trailing u32 array of enemy faction indices ----
console.log('\n=== H1: scan each major-faction record trailing data for enemy-index arrays ===');

// For each record, walk +52+4*regionCount.. up to next major or 256KB,
// in u32 stride. Look for runs of u32 values where each value < 239 and the
// set of values matches the faction's enemy set with high overlap.
// Identifying which record is which faction: use regionCount.
// Roman: 35 regions in RIS (per session 9). Carthage: 22. Egypt: ?. Etc.
// We'll just test "for each record, find best-matching faction-enemy-set among
// all 239 factions' enemy sets" and check if best match has high overlap.

function scanRecordForEnemyArrays(rec, nextBase) {
  const start = rec.base + 52 + rec.regionCount * 4;
  const end = nextBase != null ? nextBase : Math.min(rec.base + 200000, buf.length);
  // Find every position p where buf[p..p+4*K] is K consecutive u32 values all in 0..N-1
  // and K >= 3 and ideally followed by sentinel.
  const arrays = [];
  for (let p = start; p < end - 8; p += 4) {
    // Try a window. First u32 must be a count (small) and the values that follow
    // must all be < 239.
    const v0 = buf.readUInt32LE(p);
    // Path A: count-prefixed. count = v0; values at p+4..p+4+4*v0, all < 239
    if (v0 >= 2 && v0 <= 100) {
      let valid = true;
      const vals = [];
      for (let i = 0; i < v0; i++) {
        if (p + 4 + i * 4 + 4 > end) { valid = false; break; }
        const v = buf.readUInt32LE(p + 4 + i * 4);
        if (v >= N) { valid = false; break; }
        vals.push(v);
      }
      if (valid && new Set(vals).size === vals.length) {
        arrays.push({ kind: 'count-prefixed', p, count: v0, vals });
      }
    }
    // Path B: u32 sequence of unique values < N (no length prefix), look for
    // runs of length >= 4 where each is unique and < N.
    if (v0 < N) {
      let i = 0;
      const vals = [];
      while (p + i * 4 + 4 <= end) {
        const v = buf.readUInt32LE(p + i * 4);
        if (v >= N) break;
        if (vals.includes(v)) break;
        vals.push(v);
        i++;
      }
      if (vals.length >= 4) {
        arrays.push({ kind: 'raw-run', p, count: vals.length, vals });
      }
    }
  }
  return arrays;
}

// For each major record, score against enemy sets
function scoreEnemyMatch(vals, enemySet) {
  if (!enemySet || enemySet.size === 0) return { hit: 0, miss: vals.length, extra: 0, score: 0 };
  let hit = 0;
  for (const v of vals) if (enemySet.has(v)) hit++;
  const miss = vals.length - hit;
  const extra = enemySet.size - hit;
  // Jaccard-like
  const union = enemySet.size + miss;
  const score = union > 0 ? hit / union : 0;
  return { hit, miss, extra, score };
}

const results = [];
for (let ri = 0; ri < records.length; ri++) {
  const r = records[ri];
  const nextBase = ri + 1 < records.length ? records[ri + 1].base : null;
  const arrays = scanRecordForEnemyArrays(r, nextBase);
  // For each candidate array, find best-matching faction (by enemy set jaccard)
  const top = [];
  for (const a of arrays) {
    let bestF = -1, bestScore = 0, bestHit = 0;
    for (const [fIdx, eSet] of enemiesOf) {
      const s = scoreEnemyMatch(a.vals, eSet);
      if (s.score > bestScore) { bestScore = s.score; bestF = fIdx; bestHit = s.hit; }
    }
    top.push({ arr: a, bestF, bestScore, bestHit });
  }
  // Keep top-5 by bestScore
  top.sort((a, b) => b.bestScore - a.bestScore);
  results.push({ rec: r, arrays: top.slice(0, 5), totalArrs: arrays.length });
}

console.log('\nTop candidate enemy-arrays per record (best match to any faction):');
results.forEach((r, i) => {
  console.log(`  Record[${i}] regionCount=${r.rec.regionCount}  totalCandidates=${r.totalArrs}`);
  for (const t of r.arrays) {
    if (t.bestScore < 0.2) continue;
    const a = t.arr;
    console.log(`    @0x${a.p.toString(16)} kind=${a.kind} count=${a.count} score=${t.bestScore.toFixed(2)} hit=${t.bestHit}  bestFac=${factions[t.bestF]}(${t.bestF})  vals=[${a.vals.slice(0, 12).join(',')}${a.vals.length>12?'...':''}]`);
  }
});

// Aggregate: how many records have a candidate array with score >= 0.5?
const goodH1 = results.filter(r => r.arrays.length > 0 && r.arrays[0].bestScore >= 0.5).length;
console.log(`\nH1 verdict: ${goodH1}/${records.length} records have a candidate enemy-array with Jaccard >= 0.5`);

// ---- HYPOTHESIS 3: war pairs encoded as a*N+b in some u32 array ----
console.log('\n=== H3: scan save for war-pair codes a*239+b ===');
// Build set of war-pair codes (both directions)
const warCodes = new Set();
for (const [a, b] of warPairsArr) {
  warCodes.add(a * N + b);
  warCodes.add(b * N + a);
}
console.log(`  ${warCodes.size} distinct war-pair codes (max value ${Math.max(...warCodes)})`);

// Walk save as u32, count how many of these codes appear AND in what density.
// Look for windows of size ~1024 bytes where >50% of u32 values are in warCodes.
const windowU32 = 256; // 1024 bytes = 256 u32
let bestWindowScore = 0, bestWindowOff = -1;
for (let off = 0; off + windowU32 * 4 <= buf.length; off += 64) {
  let hits = 0;
  for (let i = 0; i < windowU32; i++) {
    if (warCodes.has(buf.readUInt32LE(off + i * 4))) hits++;
  }
  if (hits > bestWindowScore) { bestWindowScore = hits; bestWindowOff = off; }
}
console.log(`  Best 256-u32 window: ${bestWindowScore}/${windowU32} (${((bestWindowScore/windowU32)*100).toFixed(1)}%) @ 0x${bestWindowOff.toString(16)}`);

// Total count of war-code occurrences anywhere
let totalCodeHits = 0;
for (let off = 0; off + 4 <= buf.length; off += 4) {
  if (warCodes.has(buf.readUInt32LE(off))) totalCodeHits++;
}
// Baseline: random u32 in [0, 56882] would hit at probability 510/2^32 ~= 1.2e-7
// So expected baseline ~ buf.length/4 * 1.2e-7 ~ 1.0 hits. >100 = strong signal.
console.log(`  Total war-code u32 occurrences in save: ${totalCodeHits} (random baseline ~1)`);

// ---- HYPOTHESIS 4: scan for f0 0a af f0 RLE TAILs and check war content ----
console.log('\n=== H4: locate f0 0a af f0 RLE TAILs (session 40) ===');
const TAIL_MAGIC = Buffer.from([0xf0, 0x0a, 0xaf, 0xf0]);
const tailOffsets = [];
for (let p = 0; p < buf.length - 4; p++) {
  if (buf[p] === 0xf0 && buf[p+1] === 0x0a && buf[p+2] === 0xaf && buf[p+3] === 0xf0) {
    tailOffsets.push(p);
  }
}
console.log(`  Found ${tailOffsets.length} TAIL markers in save`);
console.log(`  First 10 offsets: ${tailOffsets.slice(0,10).map(o => '0x' + o.toString(16)).join(', ')}`);

// Without the TAIL decoder schema we can't say more here; just confirm count.

// ---- SUMMARY ----
console.log('\n========== SUMMARY ==========');
console.log(`Ground truth: ${warPairsArr.length} war pairs from descr_strat`);
console.log(`H1 (per-faction enemy arrays): ${goodH1}/${records.length} records >=0.5 jaccard`);
console.log(`H2 (square bitmap): see numbers above`);
console.log(`H3 (a*N+b codes): best window ${bestWindowScore}/${windowU32}, total ${totalCodeHits}`);
console.log(`H4 (TAILs): ${tailOffsets.length} found, not decoded yet`);
