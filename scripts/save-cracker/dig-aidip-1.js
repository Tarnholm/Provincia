// dig-aidip-1.js — Session 103/A
// Goal: confirm the stride-3 structure inside the player-record AI/diplo zone
// (relative offsets +0x18..+0x0c264, ending at the 8-slot back-pointer self
// index). The session-102 brief asserts ~16K triples laid out as <u8 a><u8 b><u8 c>.
//
// Tests:
//  (1) Histogram of byte values at each (offset mod 3) inside the zone. If the
//      structure really is stride-3, the three slots should have distinct
//      statistical character.
//  (2) Histogram of byte values at each (offset mod 4) — alternative
//      hypothesis: stride-4 with a sentinel byte. (Per session 102 we already
//      saw the back-pointer cluster as <u8 X> 0x01 <u8 Y> <u8 Z> packed-record
//      bytes — so let's check that too.)
//  (3) Try multiple zone start anchors (+0x18 from session 102, +0x80 from
//      session 102's "+0x18..+0x80 high distinctness" finding, and +0 just in
//      case) and see which one minimizes phase offset variance.
//  (4) Top frequent triples (for stride 3) and quads (for stride 4) — does any
//      pattern dominate? E.g. <0,0,0> would mean lots of empty slots.

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');
const SAVE = path.join(FIX, 'save_1.2.sav');
const buf = fs.readFileSync(SAVE);

const recs = findFactionRecords(buf);
let big = recs[0]; for (const r of recs) if (r.size > big.size) big = r;
const REC = buf.slice(big.offset, big.offset + big.size);
console.log(`save_1.2 player record: offset=0x${big.offset.toString(16)} size=${REC.length}`);

// Zone: +0x18..+0x0c264 per session 102
const ZONE_START = 0x18;
const ZONE_END   = 0x0c264;
const zone = REC.slice(ZONE_START, ZONE_END);
console.log(`AI/diplo zone: rel +0x${ZONE_START.toString(16)}..+0x${ZONE_END.toString(16)} (size ${zone.length} = ${(zone.length/1024).toFixed(1)} KB)`);
console.log(`Triples if stride-3:   ${Math.floor(zone.length / 3)}`);
console.log(`Quads if stride-4:     ${Math.floor(zone.length / 4)}`);

// ---- (1) phase histograms ----
function phaseHist(buf, mod) {
  const hists = Array.from({length: mod}, () => new Array(256).fill(0));
  for (let i = 0; i < buf.length; i++) {
    hists[i % mod][buf[i]]++;
  }
  return hists;
}

function summarize(hist, label) {
  const total = hist.reduce((a,b)=>a+b, 0);
  let distinct = 0;
  for (const c of hist) if (c) distinct++;
  // top 8 values
  const idx = hist.map((c,b)=>[b,c]).sort((a,b)=>b[1]-a[1]).slice(0, 8);
  const top = idx.map(([b,c])=>`0x${b.toString(16).padStart(2,'0')}:${c}`).join(' ');
  console.log(`  ${label}  total=${total}  distinct=${distinct}  top: ${top}`);
}

for (const mod of [3, 4]) {
  console.log(`\n=== Phase histograms — stride ${mod} ===`);
  const hs = phaseHist(zone, mod);
  for (let p = 0; p < mod; p++) summarize(hs[p], `phase ${p}`);
}

// ---- (2) Phase variance score across strides 2..6 ----
// If a stride is real, byte distributions in different phases will look very
// different; if a stride is wrong, distributions in different phases will be
// statistically similar (chi-squared between phase distributions will be low).
function phaseDivergenceScore(buf, mod) {
  const hs = phaseHist(buf, mod);
  const totals = hs.map(h => h.reduce((a,b)=>a+b,0));
  // pairwise L1 distance of normalized hists
  let total = 0;
  let cmps = 0;
  for (let p = 0; p < mod; p++) {
    for (let q = p + 1; q < mod; q++) {
      let d = 0;
      for (let b = 0; b < 256; b++) {
        const fp = hs[p][b] / totals[p];
        const fq = hs[q][b] / totals[q];
        d += Math.abs(fp - fq);
      }
      total += d;
      cmps++;
    }
  }
  return total / cmps; // 0..2; higher = more phase-distinguishable
}

console.log(`\n=== Phase-divergence score (higher = more distinct phases) ===`);
for (const mod of [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 16]) {
  const s = phaseDivergenceScore(zone, mod);
  console.log(`  stride ${mod.toString().padStart(2)}  score=${s.toFixed(4)}`);
}

// ---- (3) Try multiple zone start anchors ----
console.log(`\n=== Phase-3 divergence at multiple anchors (test stride-3 alignment) ===`);
for (const start of [0x18, 0x19, 0x1a, 0x1b, 0x20, 0x40, 0x80, 0x100, 0x200, 0x400, 0x1000]) {
  const z = REC.slice(start, ZONE_END);
  const s = phaseDivergenceScore(z, 3);
  console.log(`  start=+0x${start.toString(16).padStart(4,'0')}  score=${s.toFixed(4)}`);
}

// ---- (4) Top frequent triples (stride 3) ----
console.log(`\n=== Top-20 frequent triples (assuming stride-3, anchor +0x18) ===`);
const tripleCount = new Map();
for (let i = 0; i + 3 <= zone.length; i += 3) {
  const k = (zone[i] << 16) | (zone[i+1] << 8) | zone[i+2];
  tripleCount.set(k, (tripleCount.get(k) || 0) + 1);
}
const top = [...tripleCount.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 20);
let totalTrip = 0;
for (const [_,c] of tripleCount) totalTrip += c;
console.log(`Total triples: ${totalTrip}, distinct: ${tripleCount.size}`);
for (const [k, c] of top) {
  const a = (k >> 16) & 0xff, b = (k >> 8) & 0xff, c_ = k & 0xff;
  console.log(`  <${a.toString().padStart(3)}, ${b.toString().padStart(3)}, ${c_.toString().padStart(3)}>  (0x${a.toString(16).padStart(2,'0')} 0x${b.toString(16).padStart(2,'0')} 0x${c_.toString(16).padStart(2,'0')})  count=${c}  (${(100*c/totalTrip).toFixed(1)}%)`);
}

// ---- (5) Top frequent quads (stride 4) ----
console.log(`\n=== Top-20 frequent quads (alternative stride-4, anchor +0x18) ===`);
const quadCount = new Map();
for (let i = 0; i + 4 <= zone.length; i += 4) {
  const k = (zone[i] << 24) | (zone[i+1] << 16) | (zone[i+2] << 8) | zone[i+3];
  quadCount.set(k >>> 0, (quadCount.get(k >>> 0) || 0) + 1);
}
const topQ = [...quadCount.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 20);
let totalQuad = 0;
for (const [_,c] of quadCount) totalQuad += c;
console.log(`Total quads: ${totalQuad}, distinct: ${quadCount.size}`);
for (const [k, c] of topQ) {
  const a = (k >>> 24) & 0xff, b = (k >>> 16) & 0xff, c_ = (k >>> 8) & 0xff, d = k & 0xff;
  console.log(`  <${a.toString().padStart(3)},${b.toString().padStart(3)},${c_.toString().padStart(3)},${d.toString().padStart(3)}>  count=${c}  (${(100*c/totalQuad).toFixed(1)}%)`);
}

// ---- (6) Runs of zeros >= 16 ----
console.log(`\n=== Runs of consecutive 0x00 bytes >= 16 in the zone ===`);
const zeroRuns = [];
let s = -1;
for (let i = 0; i <= zone.length; i++) {
  if (i < zone.length && zone[i] === 0) {
    if (s === -1) s = i;
  } else {
    if (s !== -1 && i - s >= 16) zeroRuns.push({start: s, end: i, len: i - s});
    s = -1;
  }
}
console.log(`Found ${zeroRuns.length} zero-runs >=16. Showing first 20:`);
for (const r of zeroRuns.slice(0, 20)) {
  console.log(`  rel=+0x${(r.start + ZONE_START).toString(16).padStart(6,'0')}  len=${r.len}`);
}
if (zeroRuns.length > 20) console.log(`  ... and ${zeroRuns.length - 20} more`);

// ---- (7) First 256 bytes of zone, hex dump ----
console.log(`\n=== First 256 bytes of zone (rel +0x18..+0x118) ===`);
for (let i = 0; i < 256; i += 16) {
  const hex = [];
  for (let j = 0; j < 16; j++) {
    if (i + j < zone.length) hex.push(zone[i + j].toString(16).padStart(2, '0'));
  }
  console.log(`  +0x${(i + ZONE_START).toString(16).padStart(4,'0')}  ${hex.join(' ')}`);
}
