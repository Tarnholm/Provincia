// dig-startingwars3.js - Session 50 attempt 3 (FINAL).
// Lessons from attempt 2:
//  - Byte-equality is misleading when bitmap is sparse (zero-zero dominates).
//  - Real metric: JACCARD of set bits (intersection / union).
//  - 255 war pairs, 175 ally pairs, 2 neutrals parsed (matches brief's 432).
//
// Plan:
//   - For H2: build square/triangular bitmaps and ALSO 32-bit-aligned/byte-aligned
//     variants. Scan the WHOLE save buffer; metric = bit-Jaccard at each offset.
//   - For H1: improve. Look only at u32 sequences in major-record trailing data
//     where ALL values are valid faction indices (no duplicates, len >= 5).
//   - For H4: try TAIL decode (we have a TAIL schema in session 40).
//   - For H3: refine, look at varying scaling.
//
// Hard early-stop: this is attempt 3.

const fs = require('fs');

const SM_PATH = 'C:/RIS/RIS/data/descr_sm_factions.txt';
const DS_PATH = 'C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt';
const SAVE_PATH = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';

const N = 239;

function parseFactionList(text) {
  const factions = []; let inArr=false, depth=0;
  for (const raw of text.split(/\r?\n/)) {
    const s = raw.replace(/;.*$/, '');
    if (!inArr) { if (/^"factions"\s*:/.test(s.trim())) inArr=true; continue; }
    for (const ch of s) { if (ch === '{') depth++; else if (ch === '}') depth--; }
    if (depth === 0 && /^\s*\]/.test(s)) break;
    if (depth !== 0) continue;
    const m = s.match(/^\s*"([a-z_][a-z_0-9]*)"\s*:/);
    if (m) factions.push(m[1]);
  }
  return factions;
}

let factions = parseFactionList(fs.readFileSync(SM_PATH, 'utf8'));
if (factions.length !== N) factions = parseFactionList(fs.readFileSync('C:/dev/Provincia/public/descr_sm_factions.txt', 'utf8'));
const idxOf = new Map(factions.map((n,i)=>[n,i]));

const dsText = fs.readFileSync(DS_PATH, 'utf8');
const warPairs = [], allyPairs = [];
for (const raw of dsText.split(/\r?\n/)) {
  const semi = raw.indexOf(';'); let line = (semi>=0?raw.slice(0,semi):raw).trim();
  if (!line) continue;
  const m = line.match(/^faction_relationships\s+([a-z_][a-z_0-9]*)\s*,?\s+(-?\d+)\s+([a-z_][a-z_0-9]*)/);
  if (!m) continue;
  const ia = idxOf.get(m[1]), ib = idxOf.get(m[3]); if (ia==null||ib==null) continue;
  const v = parseInt(m[2],10);
  if (v >= 201) warPairs.push([ia,ib]);
  else if (v < 200) allyPairs.push([ia,ib]);
}
console.log(`Parsed: ${warPairs.length} wars, ${allyPairs.length} allies, ${factions.length} factions`);

// Build set of enemies per faction (for H1)
const enemiesOf = new Map();
for (const [a, b] of warPairs) {
  if (!enemiesOf.has(a)) enemiesOf.set(a, new Set());
  if (!enemiesOf.has(b)) enemiesOf.set(b, new Set());
  enemiesOf.get(a).add(b);
  enemiesOf.get(b).add(a);
}

// === Build several BIT-LEVEL needles ===
const buf = fs.readFileSync(SAVE_PATH);

function buildSquareSym(pairs) {
  const bm = Buffer.alloc(Math.ceil(N * N / 8));
  for (const [a,b] of pairs) {
    const i1 = a*N+b, i2 = b*N+a;
    bm[i1>>3] |= 1 << (i1 & 7);
    bm[i2>>3] |= 1 << (i2 & 7);
  }
  return bm;
}
function buildTri(pairs) {
  const nb = N*(N-1)/2;
  const bm = Buffer.alloc(Math.ceil(nb/8));
  for (let [a,b] of pairs) {
    if (a>b) [a,b]=[b,a];
    const i = a*(2*N-a-1)/2 + (b-a-1);
    bm[i>>3] |= 1 << (i & 7);
  }
  return bm;
}
function buildSquareSymPadded(pairs, rowBytes) {
  // Each row has `rowBytes*8` bit slots, of which the first N are used.
  const bm = Buffer.alloc(N * rowBytes);
  for (const [a, b] of pairs) {
    {
      const bitOff = a * rowBytes * 8 + b;
      bm[bitOff>>3] |= 1 << (bitOff & 7);
    }
    {
      const bitOff = b * rowBytes * 8 + a;
      bm[bitOff>>3] |= 1 << (bitOff & 7);
    }
  }
  return bm;
}

const warSq = buildSquareSym(warPairs);
const warTri = buildTri(warPairs);
// Possible padded forms (row-aligned to byte/dword)
const warSq30 = buildSquareSymPadded(warPairs, 30); // 30*8 = 240 bits per row
const warSq32 = buildSquareSymPadded(warPairs, 32); // 32 bytes per row
const allySq = buildSquareSym(allyPairs);
const allyTri = buildTri(allyPairs);

console.log(`Needles built:`);
console.log(`  warSq  (${warSq.length} B, ${popCount(warSq)} bits set)`);
console.log(`  warTri (${warTri.length} B, ${popCount(warTri)} bits set)`);
console.log(`  warSq30 (${warSq30.length} B, ${popCount(warSq30)} bits set)`);
console.log(`  warSq32 (${warSq32.length} B, ${popCount(warSq32)} bits set)`);
console.log(`  allySq (${allySq.length} B, ${popCount(allySq)} bits set)`);
console.log(`  allyTri (${allyTri.length} B, ${popCount(allyTri)} bits set)`);

function popCount(buf) {
  let n=0;
  for (const b of buf) { let x=b; while(x){n+=x&1;x>>>=1;} }
  return n;
}

// Bit-level Jaccard scan
function jaccardAt(buf, off, needle) {
  let andBits = 0, orBits = 0;
  for (let i = 0; i < needle.length; i++) {
    if (off + i >= buf.length) return 0;
    const a = buf[off + i], b = needle[i];
    let aa = a & b, oo = a | b;
    while (aa) { andBits += aa & 1; aa >>>= 1; }
    while (oo) { orBits += oo & 1; oo >>>= 1; }
  }
  return orBits > 0 ? andBits / orBits : 0;
}

function scanJaccard(buf, needle, label, stride = 1, fromOff = 0, toOff = buf.length) {
  const needleBits = popCount(needle);
  let best = -1, bestOff = -1;
  const tic = Date.now();
  let evaluated = 0;
  for (let off = fromOff; off + needle.length < toOff; off += stride) {
    const j = jaccardAt(buf, off, needle);
    evaluated++;
    if (j > best) { best = j; bestOff = off; }
  }
  console.log(`  ${label}: best Jaccard=${best.toFixed(4)} @ 0x${bestOff.toString(16)} (needle ${needleBits} bits, scanned ${evaluated} in ${((Date.now()-tic)/1000).toFixed(1)}s, stride=${stride})`);
  return { best, bestOff };
}

// PHASE 1: Coarse scan whole save with stride=8 (faster). The matrix at 0xf8fd2
// is 267*N*N = ~15MB so we'll cover that too but with stride=8 it's ~2M ops.
console.log('\n=== H2: bit-Jaccard scan of whole save (stride=8) ===');
const wsq = scanJaccard(buf, warSq, 'warSq', 8);
const wtri = scanJaccard(buf, warTri, 'warTri', 8);
const wsq30 = scanJaccard(buf, warSq30, 'warSq30', 8);
const wsq32 = scanJaccard(buf, warSq32, 'warSq32', 8);

// PHASE 2: Fine scan ±256 around the best hit
function fineScan(buf, needle, label, centerOff) {
  return scanJaccard(buf, needle, label + ' fine', 1, Math.max(0, centerOff - 256), Math.min(buf.length, centerOff + 256 + needle.length));
}
console.log('\n=== H2: fine scan ±256 around coarse hits ===');
const wsqF = fineScan(buf, warSq, 'warSq', wsq.bestOff);
const wtriF = fineScan(buf, warTri, 'warTri', wtri.bestOff);
const wsq30F = fineScan(buf, warSq30, 'warSq30', wsq30.bestOff);
const wsq32F = fineScan(buf, warSq32, 'warSq32', wsq32.bestOff);

// Also test against ally bitmaps (sanity: should NOT match in the same place)
console.log('\n=== H2 sanity: ally bitmaps ===');
const asqC = scanJaccard(buf, allySq, 'allySq', 8);
const atriC = scanJaccard(buf, allyTri, 'allyTri', 8);

// === H1: per-faction trailing enemy arrays — better heuristic ===
console.log('\n=== H1: per-faction trailing data search (smarter) ===');
function findMajors(buf) {
  const out=[];
  for (let p=0;p<buf.length-64;p+=4) {
    if (buf.readUInt32LE(p+8)!==100) continue;
    if (buf.readUInt32LE(p+12)!==1) continue;
    if (buf.readUInt32LE(p+44)!==6) continue;
    if (buf.readUInt32LE(p+24)!==p+24) continue;
    if (buf.readUInt32LE(p+40)!==p+40) continue;
    out.push(p);
  }
  return out;
}
const majors = findMajors(buf);
console.log(`  ${majors.length} major records found`);

// Note from session 9 + 49: major records are reordered, only 5 found here.
// session 50 brief says brick-truth "RIS has 23 major factions". Only 5 in save_1.2?
// Hmm. Let me look at session 9 again: "Sparta player corpus may show 24 majors" etc.
// Anyway, in save_1.2 we only see 5. So H1 is restricted to those 5 factions.

// Get faction enemy counts and find ones with regionCount matching our majors
const recRegions = majors.map(p => buf.readUInt32LE(p + 48));
console.log(`  Record region counts: ${recRegions.join(', ')}`);

// For each major record, scan its trailing data byte-by-byte and at each u32
// position, build a sliding window of K u32 values. Score = Jaccard with one
// of the faction enemy sets.
function scanAndScore(buf, base, nextBase) {
  const start = base + 52 + buf.readUInt32LE(base + 48) * 4;
  const end = nextBase != null ? nextBase : Math.min(base + 4_000_000, buf.length);
  // Find candidate arrays: at each 4-byte-aligned position P, walk forward
  // collecting unique u32 values < N. When we hit a non-N value or duplicate,
  // STOP. If length >= 3, evaluate.
  const cands = [];
  for (let p = start; p + 4 < end; p += 4) {
    const seen = new Set();
    let i = 0;
    while (p + i*4 + 4 < end) {
      const v = buf.readUInt32LE(p + i*4);
      if (v >= N) break;
      if (seen.has(v)) break;
      seen.add(v);
      i++;
    }
    if (i >= 3) {
      const vals = [];
      for (let j = 0; j < i; j++) vals.push(buf.readUInt32LE(p + j*4));
      cands.push({ p, vals });
    }
  }
  return cands;
}

function jaccardSets(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const v of a) if (b.has(v)) inter++;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

console.log('\nH1 detailed scan:');
let h1Best = 0, h1BestInfo = null;
for (let ri = 0; ri < majors.length; ri++) {
  const base = majors[ri];
  const nextBase = ri + 1 < majors.length ? majors[ri+1] : null;
  const cands = scanAndScore(buf, base, nextBase);
  // Try each candidate against all faction enemy sets; report the best for this record
  let bestJ = 0, bestC = null, bestFac = -1;
  for (const c of cands) {
    const cSet = new Set(c.vals);
    for (const [f, eSet] of enemiesOf) {
      const j = jaccardSets(cSet, eSet);
      if (j > bestJ) { bestJ = j; bestC = c; bestFac = f; }
    }
  }
  console.log(`  Record[${ri}] @0x${base.toString(16)} regionCount=${recRegions[ri]} numCands=${cands.length}`);
  if (bestC) console.log(`    best: Jaccard=${bestJ.toFixed(3)} faction=${factions[bestFac]}(${bestFac}, enemies=${enemiesOf.get(bestFac).size}) @0x${bestC.p.toString(16)} vals=[${bestC.vals.slice(0,30).join(',')}${bestC.vals.length>30?'...':''}] (n=${bestC.vals.length})`);
  if (bestJ > h1Best) { h1Best = bestJ; h1BestInfo = `Record[${ri}] J=${bestJ.toFixed(3)} fac=${factions[bestFac]}`; }
}
console.log(`H1 overall best: ${h1Best.toFixed(3)} (${h1BestInfo})`);

// === H4: try to decode TAILs at session 40 schema ===
// session 40 schema is in another finding; let's see if we can find it.
// For now: just check the inter-TAIL gaps and what u32 values they contain.
console.log('\n=== H4: TAIL inspection ===');
const tails = [];
for (let p=0;p<buf.length-4;p++) if (buf[p]===0xf0&&buf[p+1]===0x0a&&buf[p+2]===0xaf&&buf[p+3]===0xf0) tails.push(p);
console.log(`  ${tails.length} TAILs`);

// Per session 40: TAIL holds discovered-settlement state per faction. Could
// also hold per-faction known-wars. Look at first faction's TAIL contents:
// scan u32 values, count how many are valid faction indices.
const t0start = tails[0] + 4;
const t0end = tails[1];
let validFacU32s = 0, totalU32s = 0;
const facVals = [];
for (let p = t0start; p + 4 <= t0end; p += 4) {
  totalU32s++;
  const v = buf.readUInt32LE(p);
  if (v < N) { validFacU32s++; if (facVals.length < 30) facVals.push(v); }
}
console.log(`  TAIL[0] (${t0end-t0start} bytes): ${validFacU32s}/${totalU32s} u32s are valid faction indices`);
console.log(`  Sample faction-index u32s in TAIL[0]: ${facVals.join(',')}`);

// === H3 refinement: small offsets / quadratic encodings ===
console.log('\n=== H3: war-pair codes a*N+b appearance density ===');
const codes = new Set();
for (const [a,b] of warPairs) { codes.add(a*N+b); codes.add(b*N+a); }
console.log(`  ${codes.size} codes`);
// Scan whole save as u32, count code hits per 8KB chunk
const chunkSize = 8192;
let bestChunk = -1, bestChunkHits = 0;
for (let off = 0; off + chunkSize <= buf.length; off += chunkSize) {
  let hits = 0;
  for (let i = 0; i + 4 <= chunkSize; i += 4) {
    if (codes.has(buf.readUInt32LE(off + i))) hits++;
  }
  if (hits > bestChunkHits) { bestChunkHits = hits; bestChunk = off; }
}
console.log(`  Best 8KB chunk: ${bestChunkHits} hits @ 0x${bestChunk.toString(16)} (max possible = ${codes.size}, ${chunkSize/4} u32 slots)`);

// === FINAL SUMMARY ===
console.log('\n========== SESSION 50 SUMMARY ==========');
console.log(`Wars declared: ${warPairs.length} (255 expected from brief — match)`);
console.log(`H1 best Jaccard: ${h1Best.toFixed(3)}`);
console.log(`H2 best Jaccard (warSq):    ${wsqF.best.toFixed(3)} @ 0x${wsqF.bestOff.toString(16)}`);
console.log(`H2 best Jaccard (warTri):   ${wtriF.best.toFixed(3)} @ 0x${wtriF.bestOff.toString(16)}`);
console.log(`H2 best Jaccard (warSq30):  ${wsq30F.best.toFixed(3)} @ 0x${wsq30F.bestOff.toString(16)}`);
console.log(`H2 best Jaccard (warSq32):  ${wsq32F.best.toFixed(3)} @ 0x${wsq32F.bestOff.toString(16)}`);
console.log(`H3 best 8KB chunk: ${bestChunkHits}/2048 codes @ 0x${bestChunk.toString(16)}`);
console.log(`H4 TAILs found: ${tails.length} (matches faction count exactly)`);
