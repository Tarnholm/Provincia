// dig-settlebody-s94-2.js — session 94, attempt 2
// Attempt 1 disproved the chain-hash hypothesis (0 hits). Pivot:
// directly examine the +1904 and +3364 dual-buffer hint. For each settlement
// detail blob:
//   - read u32 at FC+1904 and FC+3364
//   - check if they're equal (current==cached, untouched), differ (changed),
//     or zero (unused)
//   - dump value distributions
//   - cross-reference with known per-settlement quantities: built-chain count,
//     hash-XOR fingerprint, settlement name length, etc.

"use strict";
const fs = require("fs");
const path = require("path");
const PROVINCIA_SRC = path.resolve(__dirname, "../../src");
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";

const { findAllSettlementMarkers, scanChainsBetween } = require(path.join(PROVINCIA_SRC, "buildingParser.js"));

const buf = fs.readFileSync(SAVE);
const SETT_START = 0xf85f00;
const SETT_END   = 0x1f10c72;
const FC_MAGIC = Buffer.from([0xfc, 0xfc, 0xfc, 0xfc, 0x64, 0x00, 0x00, 0x00, 0x00]);

const setts = findAllSettlementMarkers(buf).filter(s => s.offset >= SETT_START && s.offset < SETT_END);

function buildChainCount(prevEnd, end) {
  const chains = scanChainsBetween(buf, prevEnd, end, null, null);
  let n = 0;
  for (const c of chains) if (c.size >= 50) n++;
  return n;
}

// Build records.
const records = [];
for (let i = 0; i < setts.length; i++) {
  const prevEnd = i === 0 ? SETT_START : setts[i - 1].blockEnd;
  const cur = setts[i];
  const next = i + 1 < setts.length ? setts[i + 1] : { offset: SETT_END };
  const detailStart = cur.blockEnd;
  const detailEnd = next.offset;
  if (detailEnd - detailStart < 4000) continue;
  const fcIdx = buf.indexOf(FC_MAGIC, detailStart);
  if (fcIdx < 0 || fcIdx >= detailStart + 64) continue;
  const builtN = buildChainCount(prevEnd, cur.offset);
  records.push({ name: cur.name, fcIdx, detailStart, detailEnd, builtN, bodyLen: detailEnd - detailStart });
}
console.log(`detail blobs (>=4000 bytes): ${records.length}`);

// Distribution of body lengths.
const lens = records.map(r => r.bodyLen).sort((a, b) => a - b);
console.log(`body-len stats: min=${lens[0]} p25=${lens[Math.floor(lens.length*0.25)]} median=${lens[Math.floor(lens.length/2)]} p75=${lens[Math.floor(lens.length*0.75)]} max=${lens[lens.length-1]}`);

// Read u32 at FC+1904 and FC+3364 for each.
const pairs = [];
for (const r of records) {
  const off1 = r.fcIdx + 1904;
  const off2 = r.fcIdx + 3364;
  if (off2 + 4 > r.detailEnd) continue;
  const v1 = buf.readUInt32LE(off1);
  const v2 = buf.readUInt32LE(off2);
  pairs.push({ ...r, v1, v2 });
}
console.log(`pairs read: ${pairs.length}`);

const equalCount = pairs.filter(p => p.v1 === p.v2).length;
const zeroBoth = pairs.filter(p => p.v1 === 0 && p.v2 === 0).length;
const zeroOne = pairs.filter(p => (p.v1 === 0) !== (p.v2 === 0)).length;
const diffNonzero = pairs.filter(p => p.v1 !== p.v2 && p.v1 !== 0 && p.v2 !== 0).length;
console.log(`equal: ${equalCount}  both-zero: ${zeroBoth}  one-zero: ${zeroOne}  diff-nonzero: ${diffNonzero}`);

// Distribution of v1 values.
const v1Counts = new Map();
for (const p of pairs) v1Counts.set(p.v1, (v1Counts.get(p.v1) || 0) + 1);
const v1Top = [...v1Counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
console.log("\nTop v1 (FC+1904) values:");
for (const [v, c] of v1Top) console.log(`  0x${v.toString(16).padStart(8, "0")} (${v}): ${c}`);

const v2Counts = new Map();
for (const p of pairs) v2Counts.set(p.v2, (v2Counts.get(p.v2) || 0) + 1);
const v2Top = [...v2Counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
console.log("\nTop v2 (FC+3364) values:");
for (const [v, c] of v2Top) console.log(`  0x${v.toString(16).padStart(8, "0")} (${v}): ${c}`);

// Plausible interpretation candidates - check what these values correlate
// with. Print first 25 records.
console.log("\nFirst 25 records (name, builtN, v1@1904, v2@3364):");
for (const p of pairs.slice(0, 25)) {
  console.log(`  ${p.name.padEnd(28)} built=${p.builtN.toString().padStart(2)}  v1=${p.v1.toString().padStart(10)}  v2=${p.v2.toString().padStart(10)}`);
}

// Test: is v1 (or v2) close to builtN, or a u8 packed inside u32?
// Check low-byte values.
const v1LoCounts = new Map();
for (const p of pairs) {
  const lo = p.v1 & 0xff;
  v1LoCounts.set(lo, (v1LoCounts.get(lo) || 0) + 1);
}
const v1LoTop = [...v1LoCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log("\nv1 low-byte distribution top:");
for (const [v, c] of v1LoTop) console.log(`  ${v}: ${c}`);

// Does v1's low byte equal builtN?
let v1LoBuiltMatch = 0;
for (const p of pairs) if ((p.v1 & 0xff) === p.builtN) v1LoBuiltMatch++;
console.log(`v1.lo == builtN: ${v1LoBuiltMatch} / ${pairs.length}`);
let v2LoBuiltMatch = 0;
for (const p of pairs) if ((p.v2 & 0xff) === p.builtN) v2LoBuiltMatch++;
console.log(`v2.lo == builtN: ${v2LoBuiltMatch} / ${pairs.length}`);

// Maybe full u32 == builtN?
let v1EqBuilt = 0, v2EqBuilt = 0;
for (const p of pairs) {
  if (p.v1 === p.builtN) v1EqBuilt++;
  if (p.v2 === p.builtN) v2EqBuilt++;
}
console.log(`v1 == builtN: ${v1EqBuilt}  v2 == builtN: ${v2EqBuilt}`);

// Show distribution of bodyLen — are all bodies long enough to reach +3364?
const tooShort = records.filter(r => r.bodyLen < 3368).length;
console.log(`\nBodies shorter than 3368: ${tooShort} / ${records.length}`);

// Examine the absolute fixed-offset hypothesis: maybe v1/v2 actually live at
// a SHARED absolute offset (per-region table), not per-body relative.
// Quick: read u32 at (detailStart + 1904) and compare.
let absDiff = 0;
for (const p of pairs) {
  const offAbs = p.detailStart + 1904;
  if (offAbs + 4 > p.detailEnd) continue;
  const va = buf.readUInt32LE(offAbs);
  if (va !== p.v1) absDiff++;
}
console.log(`absolute-from-detailStart differs from absolute-from-FC: ${absDiff} (sanity)`);

// Final: scan the body and look for actual 545-hit u32-peak pattern from
// session 86. Aggregate per-offset value distribution; flag offsets where the
// SAME value repeats across many settlements (mod-bound constants), and
// SEPARATELY offsets that VARY across settlements (per-settlement payload).
const offsetVar = new Map();     // off -> Set of values
const offsetUnique = new Map();  // off -> Set size at end
const MAX_OFF = 4096;
for (const p of pairs) {
  for (let off = 0; off + 4 <= MAX_OFF && p.fcIdx + off + 4 <= p.detailEnd; off += 4) {
    const v = buf.readUInt32LE(p.fcIdx + off);
    if (!offsetVar.has(off)) offsetVar.set(off, new Set());
    offsetVar.get(off).add(v);
  }
}
// Find offsets that have high uniqueness (per-settlement) — these are payload fields.
const varied = [];
for (const [off, set] of offsetVar.entries()) {
  varied.push({ off, unique: set.size });
}
varied.sort((a, b) => b.unique - a.unique);
console.log("\nTop 25 offsets-from-FC by UNIQUENESS (payload candidates):");
for (const v of varied.slice(0, 25)) {
  console.log(`  rel ${v.off.toString().padStart(5)}: ${v.unique} unique u32 values (across ${pairs.length} settlements)`);
}

// Now correlate: for each high-uniqueness offset, count how often u32 equals
// the value at offset+1460 (dual-buffer test).
console.log("\nDual-buffer +1460 test on top-uniqueness offsets:");
for (const v of varied.slice(0, 30)) {
  const off = v.off;
  let equal = 0, both = 0;
  for (const p of pairs) {
    if (p.fcIdx + off + 1460 + 4 > p.detailEnd) continue;
    const a = buf.readUInt32LE(p.fcIdx + off);
    const b = buf.readUInt32LE(p.fcIdx + off + 1460);
    both++;
    if (a === b) equal++;
  }
  if (both > 0 && equal / both > 0.5) {
    console.log(`  rel ${off}: ${equal}/${both} settlements have v(off) == v(off+1460)  [unique=${v.unique}]`);
  }
}
