// dig-settlebody-s94-1.js — session 94, attempt 1
// Goal: pin settlement-body field offsets via the +1460 dual-buffer hint from
// session 86. Strategy: instead of population (which evolves across turns),
// use BUILT-CHAIN 4-byte HASHES as stable fingerprints — they identify chain
// instances and persist between turns.
//
// Method:
//   1. Walk settlement markers; for each, collect the built-chain hashes from
//      buildingParser.parseSettlements.
//   2. For each settlement-detail blob (FC magic), read u32s at a sweep of
//      offsets relative to FC. For every offset, count how many u32 values
//      match THIS settlement's chain-hash set.
//   3. Histogram offsets that frequently contain chain-hash u32s; pairs at
//      stride +1460 are the dual-buffer hypothesis confirmation.

"use strict";
const fs = require("fs");
const path = require("path");
const PROVINCIA_SRC = path.resolve(__dirname, "../../src");
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";

const { findAllSettlementMarkers, parseSettlements, scanChainsBetween } = require(path.join(PROVINCIA_SRC, "buildingParser.js"));

const buf = fs.readFileSync(SAVE);
const SETT_START = 0xf85f00;
const SETT_END   = 0x1f10c72;
const FC_MAGIC = Buffer.from([0xfc, 0xfc, 0xfc, 0xfc, 0x64, 0x00, 0x00, 0x00, 0x00]);

const setts = findAllSettlementMarkers(buf).filter(s => s.offset >= SETT_START && s.offset < SETT_END);
console.log(`settlement markers in zone: ${setts.length}`);

// For each settlement, collect built-chain hashes (the 4 bytes immediately
// after the chain-name + null terminator).
//
// Per buildingParser: chains for settlement i live BEFORE marker i in the
// (prev.blockEnd .. cur.offset) gap. The DETAIL blob (FC magic) sits AFTER
// marker i, between marker i.blockEnd and marker i+1.offset.
//
// So: marker i has chain-records BEFORE it and detail-body AFTER it.
//   → settlement-detail blob i belongs to marker i (NEXT association).

function collectHashes(prevEnd, end) {
  // Reuse scanChainsBetween without an allowlist (validChainNames=null lets
  // through any lowercase candidate string).
  const chains = scanChainsBetween(buf, prevEnd, end, null, null);
  const hashes = new Set();
  for (const c of chains) {
    if (c.size < 50) continue; // built only, skip queue stubs
    const hashOff = c.offset + 2 + c.name.length + 1;
    if (hashOff + 4 > buf.length) continue;
    hashes.add(buf.readUInt32LE(hashOff));
  }
  return hashes;
}

// Build settlement records with hashes + detail-body location.
const records = [];
for (let i = 0; i < setts.length; i++) {
  const prevEnd = i === 0 ? SETT_START : setts[i - 1].blockEnd;
  const cur = setts[i];
  const next = i + 1 < setts.length ? setts[i + 1] : { offset: SETT_END };
  const detailStart = cur.blockEnd;
  const detailEnd = next.offset;
  if (detailEnd - detailStart < 256) continue;
  const fcIdx = buf.indexOf(FC_MAGIC, detailStart);
  if (fcIdx < 0 || fcIdx >= detailStart + 64) continue;
  const hashes = collectHashes(prevEnd, cur.offset);
  if (hashes.size === 0) continue;
  records.push({
    name: cur.name,
    hashes,
    fcIdx,
    detailStart,
    detailEnd,
    bodyLen: detailEnd - detailStart,
  });
}
console.log(`settlements with hashes + detail-body: ${records.length}`);

const sumHashes = records.reduce((a, r) => a + r.hashes.size, 0);
const avgHashes = (sumHashes / records.length).toFixed(2);
console.log(`avg built-chain hashes per settlement: ${avgHashes}`);

// Sweep offsets relative to FC: for every body offset where u32 matches
// THIS settlement's hash set, increment histogram.
const hist = new Map(); // offset(relative-to-FC) -> count of settlements with hit
for (const r of records) {
  const slice = buf.slice(r.detailStart, r.detailEnd);
  const fcRel = r.fcIdx - r.detailStart;
  const localHits = new Set();
  for (let p = 0; p + 4 <= slice.length; p++) {
    const v = slice.readUInt32LE(p);
    if (r.hashes.has(v)) {
      const rel = p - fcRel;
      localHits.add(rel);
    }
  }
  for (const off of localHits) {
    hist.set(off, (hist.get(off) || 0) + 1);
  }
}
console.log(`histogram entries: ${hist.size}`);

// Top offsets.
const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
console.log("\nTop 40 offsets-from-FC where u32 == one of THIS settlement's chain hashes:");
for (const [off, c] of top) {
  console.log(`  rel ${off.toString().padStart(6)} (0x${(off >>> 0).toString(16)}): ${c} / ${records.length} settlements`);
}

// Check the +1460 stride hypothesis: for the top-K offsets, does +1460 also
// hit? Print the pair counts.
console.log("\n+1460 stride check (for top 25 offsets):");
const topOffs = top.slice(0, 25).map(([o]) => o);
for (const o of topOffs) {
  const paired = hist.get(o + 1460) || 0;
  const here = hist.get(o);
  console.log(`  rel ${o}  here=${here}  rel+1460=${o+1460}  paired=${paired}`);
}

// Also look at the specific offsets session 86 flagged: 1904, 3364.
console.log("\nSession 86 named offsets (relative to FC):");
for (const off of [1904, 3364, 2828]) {
  console.log(`  rel ${off}: ${hist.get(off) || 0} hits`);
}

// And +1460 stride spans within ANY pair (off, off+1460) with high counts:
console.log("\nAll offset pairs (a, a+1460) where BOTH >= 50:");
const pairs = [];
for (const [a, ca] of hist.entries()) {
  if (ca < 50) continue;
  const cb = hist.get(a + 1460);
  if (cb && cb >= 50) pairs.push({ a, ca, b: a + 1460, cb });
}
pairs.sort((x, y) => (y.ca + y.cb) - (x.ca + x.cb));
for (const p of pairs.slice(0, 20)) {
  console.log(`  (rel ${p.a}, rel ${p.b})  counts: ${p.ca} / ${p.cb}`);
}
