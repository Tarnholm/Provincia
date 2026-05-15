// dig-startingwars2.js - Session 50 attempt 2.
// H2 had a HOT 93.8% match for square bitmap at 0x2ecd0. Verify rigorously:
//   1) Reproduce the bitmap exactly (square AND square-with-diagonal-fixed)
//   2) Find the EXACT offset (slide ±32 bytes around 0x2ecd0, full byte-equal)
//   3) Catalogue mismatches: are they all war pairs missing? Or extra wars?
//   4) Cross-check: this could also be an ALLIANCES bitmap or a TRADE-RIGHTS bitmap.
//      Build all three and compare.
//
// Also dig H4: 239 TAIL markers found = exact match to faction count. Big signal.

const fs = require('fs');

const SM_PATH = 'C:/RIS/RIS/data/descr_sm_factions.txt';
const DS_PATH = 'C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt';
const SAVE_PATH = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';

const N = 239;

function parseFactionList(text) {
  const factions = [];
  let inArr = false, depth = 0;
  for (const raw of text.split(/\r?\n/)) {
    const s = raw.replace(/;.*$/, '');
    if (!inArr) { if (/^"factions"\s*:/.test(s.trim())) inArr = true; continue; }
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
const idxOf = new Map(factions.map((n, i) => [n, i]));

// Parse all faction_relationships and core_attitudes
const dsText = fs.readFileSync(DS_PATH, 'utf8');
const warPairs = [];          // (a, b) pairs as DECLARED
const allyPairs = [];         // value <= 199 declarations
const neutralPairs = [];      // value == 200
const tradeRightsPairs = [];  // from trade_rights (different line)
const protectoratePairs = []; // from protectorate

for (const raw of dsText.split(/\r?\n/)) {
  const semi = raw.indexOf(';');
  let line = (semi >= 0 ? raw.slice(0, semi) : raw).trim();
  if (!line) continue;
  let m = line.match(/^faction_relationships\s+([a-z_][a-z_0-9]*)\s*,?\s+(-?\d+)\s+([a-z_][a-z_0-9]*)/);
  if (m) {
    const ia = idxOf.get(m[1]), ib = idxOf.get(m[3]); const v = parseInt(m[2],10);
    if (ia == null || ib == null) continue;
    if (v < 200) allyPairs.push([ia, ib]);
    else if (v === 200) neutralPairs.push([ia, ib]);
    else warPairs.push([ia, ib]);
    continue;
  }
  m = line.match(/^trade_rights\s+([a-z_][a-z_0-9]*)\s*,?\s+([a-z_][a-z_0-9]*)/);
  if (m) { const ia=idxOf.get(m[1]),ib=idxOf.get(m[2]); if(ia!=null&&ib!=null) tradeRightsPairs.push([ia,ib]); continue; }
  m = line.match(/^protectorate\s+([a-z_][a-z_0-9]*)\s*,?\s+([a-z_][a-z_0-9]*)/);
  if (m) { const ia=idxOf.get(m[1]),ib=idxOf.get(m[2]); if(ia!=null&&ib!=null) protectoratePairs.push([ia,ib]); continue; }
}
console.log(`Parsed: wars=${warPairs.length} allies=${allyPairs.length} neutrals=${neutralPairs.length} tradeRights=${tradeRightsPairs.length} protectorates=${protectoratePairs.length}`);

// Note: session brief says 255 war pairs and 432 faction_relationships lines.
// We got 238 unique war pairs from the parser. Maybe the brief counted lines
// (with duplicates / symmetric flips both written). Either way, 93.8% on a
// 7141-byte bitmap is way above chance, so let's verify.

function buildSquareBitmap(pairs, symmetric = true) {
  const bm = Buffer.alloc(Math.ceil(N * N / 8));
  for (const [a, b] of pairs) {
    const i1 = a * N + b;
    bm[i1 >> 3] |= 1 << (i1 & 7);
    if (symmetric) {
      const i2 = b * N + a;
      bm[i2 >> 3] |= 1 << (i2 & 7);
    }
  }
  return bm;
}
function buildTriBitmap(pairs) {
  const numBits = N * (N - 1) / 2;
  const bm = Buffer.alloc(Math.ceil(numBits / 8));
  for (let [a, b] of pairs) {
    if (a > b) [a, b] = [b, a];
    const i = a * (2 * N - a - 1) / 2 + (b - a - 1);
    bm[i >> 3] |= 1 << (i & 7);
  }
  return bm;
}

const warSq = buildSquareBitmap(warPairs);
const warTri = buildTriBitmap(warPairs);
const allySq = buildSquareBitmap(allyPairs);
const tradeSq = buildSquareBitmap(tradeRightsPairs);

const buf = fs.readFileSync(SAVE_PATH);

function scoreAt(buf, off, needle) {
  let s = 0;
  for (let i = 0; i < needle.length; i++) if (buf[off + i] === needle[i]) s++;
  return s;
}

function scanRegion(buf, needle, label, fromOff = 0, toOff = buf.length, stride = 1) {
  let best = -1, bestOff = -1;
  const tics = [];
  for (let off = fromOff; off + needle.length < toOff; off += stride) {
    const s = scoreAt(buf, off, needle);
    if (s > best) { best = s; bestOff = off; tics.length = 0; tics.push(off); }
    else if (s === best) { tics.push(off); }
  }
  console.log(`  ${label}: best ${best}/${needle.length} (${((best/needle.length)*100).toFixed(2)}%) @ 0x${bestOff.toString(16)}${tics.length>1?` (${tics.length} ties)`:''}`);
  return { best, bestOff };
}

// Targeted scan ±256 bytes around 0x2ecd0
console.log('\n=== Fine-grained scan around 0x2ecd0 ===');
const r1 = scanRegion(buf, warSq, 'war square sym', 0x2ec00, 0x2f100);
const r2 = scanRegion(buf, warTri, 'war triangular', 0x2dc00, 0x300d0);

// Mismatch breakdown at best square offset
function mismatchBreakdown(buf, off, needle, label) {
  let setInNeedleNotInBuf = 0, setInBufNotInNeedle = 0, agree = 0;
  for (let i = 0; i < needle.length; i++) {
    const n = needle[i], b = buf[off + i];
    if (n === b) { agree++; continue; }
    // bit-level: count which bits differ
    const diff = n ^ b;
    for (let bit = 0; bit < 8; bit++) {
      if (!(diff & (1 << bit))) continue;
      if (n & (1 << bit)) setInNeedleNotInBuf++;
      else setInBufNotInNeedle++;
    }
  }
  console.log(`  ${label}: ${agree}/${needle.length} bytes agree; bits set in needle but not buf: ${setInNeedleNotInBuf}; bits set in buf but not needle: ${setInBufNotInNeedle}`);
}

if (r1.bestOff >= 0) {
  console.log('\nMismatch breakdown at sq best offset:');
  mismatchBreakdown(buf, r1.bestOff, warSq, 'war sq');
}

// Also check: maybe the bitmap doesn't use a*N+b — try other layouts
// Layout 2: bits packed by row, but byte = u8 (one bit per byte)
// Layout 3: u32 cells (4 bytes per pair, 0 or 1)
// We already verified the BIT-packed version. Try u8.
console.log('\n=== Try u8 array (1 byte per cell) ===');
const warU8 = Buffer.alloc(N * N);
for (const [a, b] of warPairs) { warU8[a*N+b] = 1; warU8[b*N+a] = 1; }
// Look around 0x2ec00 again with much larger sweep
const u8R = scanRegion(buf, warU8, 'war u8 square', 0, buf.length, 16);

// Dump bytes around the hot offset for visual inspection
function dumpHex(buf, off, len) {
  for (let r = 0; r < len; r += 32) {
    const slice = buf.slice(off + r, off + r + 32);
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2,'0')).join(' ');
    console.log(`  ${(off+r).toString(16).padStart(8,'0')}: ${hex}`);
  }
}
console.log('\n=== Bytes at 0x2ecd0 (save) ===');
dumpHex(buf, 0x2ecd0, 64);
console.log('\n=== Bytes at offset 0 of war square bitmap (expected) ===');
dumpHex(warSq, 0, 64);

// Specifically: bit-level diff to see if 1-bits in needle map cleanly into buf
// For the first 256 bytes
console.log('\n=== Bit-level comparison: war square bitmap vs save@0x2ecd0 ===');
let totalNeedleBits = 0, matchedNeedleBits = 0, totalBufBits = 0;
for (let i = 0; i < warSq.length; i++) {
  for (let b = 0; b < 8; b++) {
    const nb = (warSq[i] >> b) & 1;
    const bb = (buf[0x2ecd0 + i] >> b) & 1;
    if (nb) { totalNeedleBits++; if (bb) matchedNeedleBits++; }
    if (bb) totalBufBits++;
  }
}
console.log(`  Needle (war) total bits: ${totalNeedleBits}, matched in buf: ${matchedNeedleBits} (${((matchedNeedleBits/totalNeedleBits)*100).toFixed(1)}%)`);
console.log(`  Buf total bits: ${totalBufBits}`);

// If bit-overlap is low but byte-overlap was 93.8%, it means most bytes were
// 0 in both (zero-zero agreement). Need a stricter test.
console.log(`  Zero-zero agreements explain ${(warSq.filter && warSq.length) || 0}; let's see explicit non-zero matches.`);

// Count bytes that are 0 in both
let bothZero = 0, bothNonzero = 0, onlyNeedle = 0, onlyBuf = 0;
for (let i = 0; i < warSq.length; i++) {
  const n = warSq[i], b = buf[0x2ecd0 + i];
  if (n === 0 && b === 0) bothZero++;
  else if (n !== 0 && b !== 0) bothNonzero++;
  else if (n !== 0) onlyNeedle++;
  else onlyBuf++;
}
console.log(`  bothZero=${bothZero} bothNonzero=${bothNonzero} onlyNeedle=${onlyNeedle} onlyBuf=${onlyBuf}`);
console.log(`  bothNonzero exact byte match: ${(function(){let c=0;for(let i=0;i<warSq.length;i++)if(warSq[i]!==0&&warSq[i]===buf[0x2ecd0+i])c++;return c;})()}`);

// So the 93.8% was mostly zero-zero. Real test: of the 476 set bits in the
// needle, how many land on set bits in the buf?

// ALSO: try the matrix BEFORE the matrix start. Save matrix starts at 0xf8fd2
// per session 49. 0x2ecd0 is way before that, in the very early file area.
console.log(`\n0x2ecd0 = ${0x2ecd0} (~ ${(0x2ecd0/buf.length*100).toFixed(2)}% into save)`);
console.log(`Matrix start 0xf8fd2 = ${(0xf8fd2/buf.length*100).toFixed(2)}% into save`);

// === H4 deep-dive: 239 TAILs ===
console.log('\n=== H4 deep dive: 239 TAIL markers ===');
const tails = [];
for (let p = 0; p < buf.length - 4; p++) {
  if (buf[p]===0xf0 && buf[p+1]===0x0a && buf[p+2]===0xaf && buf[p+3]===0xf0) tails.push(p);
}
console.log(`  ${tails.length} TAILs found`);
// Inter-TAIL strides
const strides = [];
for (let i = 1; i < tails.length; i++) strides.push(tails[i] - tails[i-1]);
strides.sort((a,b)=>a-b);
console.log(`  Stride min=${strides[0]} median=${strides[strides.length>>1]} max=${strides[strides.length-1]} mean=${(strides.reduce((s,v)=>s+v,0)/strides.length).toFixed(1)}`);
// Dump 64 bytes around the first TAIL to see its surrounding structure
console.log('\n  First TAIL region (0x' + tails[0].toString(16) + '):');
dumpHex(buf, Math.max(0, tails[0]-32), 128);
