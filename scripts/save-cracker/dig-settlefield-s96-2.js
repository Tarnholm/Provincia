// dig-settlefield-s96-2.js — session 96, attempt 2
// Attempt 1 showed:
//   - 0% exact match against owner/region/population/etc.
//   - BUT the raw values at +124, +180, +496, +808 look like 32-bit
//     ABSOLUTE FILE OFFSETS — e.g. Rome's +180 = 0x00f86020, and Rome's
//     detailStart = 0x00f85f... — the value is a pointer INTO the save.
//   - +128 looks like a hashed token (0xfc + 24 random bits).
//   - +204, +516 are random — likely true hashes / per-instance UUIDs.
//
// Method:
//   1. Test "+180 value == record's NEXT BLOB START" or "self start"
//      hypotheses (pointer self-reference / next-pointer).
//   2. Test "+124 + 0xX00000 high tag" as a packed (24-bit ptr + 8-bit type).
//   3. Test high byte distribution of +128 (always 0xfc → tag).
//   4. Test +204 / +516 / +808 as taw-style UUIDs (settlement-instance id
//      embedded in body). Check if they appear ELSEWHERE in the save as
//      cross-references (e.g., in character governor field or in event log).
//   5. Confirm owner-offset detection failed: scan +/-3500 around marker
//      for the field that gives this save's owner UUID (it succeeded in
//      previous sessions; the brief implies a working owner ref exists).

"use strict";
const fs = require("fs");
const path = require("path");
const PROVINCIA_SRC = path.resolve(__dirname, "../../src");
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";

const { findAllSettlementMarkers } = require(path.join(PROVINCIA_SRC, "buildingParser.js"));

const buf = fs.readFileSync(SAVE);
const SETT_START = 0xf85f00;
const SETT_END = 0x1f10c72;
const FC_MAGIC = Buffer.from([0xfc, 0xfc, 0xfc, 0xfc, 0x64, 0x00, 0x00, 0x00, 0x00]);
const CAND = [124, 128, 180, 204, 496, 516, 808];

const setts = findAllSettlementMarkers(buf).filter(s => s.offset >= SETT_START && s.offset < SETT_END);

const records = [];
for (let i = 0; i < setts.length; i++) {
  const cur = setts[i];
  const next = i + 1 < setts.length ? setts[i + 1] : { offset: SETT_END };
  const detailStart = cur.blockEnd;
  const detailEnd = next.offset;
  if (detailEnd - detailStart < 4000) continue;
  const fcIdx = buf.indexOf(FC_MAGIC, detailStart);
  if (fcIdx < 0 || fcIdx >= detailStart + 64) continue;
  records.push({ idx: records.length, name: cur.name, marker: cur.offset, fcIdx, detailStart, detailEnd });
}
console.log(`records: ${records.length}`);

function u32(o) { return buf.readUInt32LE(o); }

// 1. POINTER HYPOTHESIS — does +180 (or others) equal a known absolute file offset?
// For each candidate offset, test 6 pointer interpretations.
const ptrTests = [
  { name: "marker", get: (r) => r.marker },
  { name: "blockEnd/detailStart", get: (r) => r.detailStart },
  { name: "fcIdx", get: (r) => r.fcIdx },
  { name: "fcIdx+core (+9)", get: (r) => r.fcIdx + 9 },
  { name: "detailEnd", get: (r) => r.detailEnd },
  { name: "nextMarker", get: (r, all) => (all[r.idx + 1]?.marker ?? null) },
  { name: "nextFcIdx", get: (r, all) => (all[r.idx + 1]?.fcIdx ?? null) },
  { name: "nextDetailStart", get: (r, all) => (all[r.idx + 1]?.detailStart ?? null) },
  { name: "prevMarker", get: (r, all) => (all[r.idx - 1]?.marker ?? null) },
  { name: "prevFcIdx", get: (r, all) => (all[r.idx - 1]?.fcIdx ?? null) },
];

console.log("\n--- PTR hypothesis (FC+off value == known absolute offset) ---");
for (const off of CAND) {
  let bestName = null, bestPct = 0, bestRaw = 0;
  let lowOff = 0, lowRaw = 0, lowName = null, lowPct = 0;
  for (const t of ptrTests) {
    let hit = 0, hitOff = 0, n = 0;
    for (const r of records) {
      const v = u32(r.fcIdx + off);
      const ref = t.get(r, records);
      if (ref === null) continue;
      n++;
      if (v === ref) hit++;
      // also test low-3 bytes (24-bit ptr + 8-bit tag)
      if ((v & 0xffffff) === (ref & 0xffffff)) hitOff++;
    }
    const pct = hit / n;
    const pctLo = hitOff / n;
    if (pct > bestPct) { bestPct = pct; bestName = t.name; bestRaw = hit; }
    if (pctLo > lowPct) { lowPct = pctLo; lowName = t.name; lowRaw = hitOff; lowOff = n; }
    if (pct > 0.2 || pctLo > 0.2) {
      console.log(`  FC+${off} vs ${t.name}: exact=${hit}/${n} (${(pct*100).toFixed(1)}%) lo24=${hitOff}/${n} (${(pctLo*100).toFixed(1)}%)`);
    }
  }
}

// 2. Delta-from-self hypothesis: maybe values are RELATIVE offsets.
// For each candidate offset C, compute delta_i = value_i - fcIdx_i and see
// if delta_i is constant (would indicate a pointer to a fixed-stride local
// field) or matches some structural offset like +9 (record header), or some
// per-record dynamic offset like (detailEnd-fcIdx) etc.
console.log("\n--- DELTA-from-fcIdx (relative pointer) ---");
for (const off of CAND) {
  const deltas = records.map(r => (u32(r.fcIdx + off) - r.fcIdx) | 0); // signed
  const counts = new Map();
  for (const d of deltas) counts.set(d, (counts.get(d) || 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`  FC+${off}:  top deltas: ${top.map(([d, c]) => `${d}=${c}`).join(", ")}`);
}

// 3. Pattern signature on each candidate.
console.log("\n--- High-byte / low-byte signature ---");
for (const off of CAND) {
  const hi = new Map(), lo = new Map();
  for (const r of records) {
    const v = u32(r.fcIdx + off);
    const h = (v >>> 24) & 0xff, l = v & 0xff;
    hi.set(h, (hi.get(h) || 0) + 1);
    lo.set(l, (lo.get(l) || 0) + 1);
  }
  const hiTop = [...hi.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const loTop = [...lo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log(`  FC+${off}: hi-byte top: ${hiTop.map(([h, c]) => `0x${h.toString(16)}=${c}`).join(", ")}  lo-byte top: ${loTop.map(([l, c]) => `${l}=${c}`).join(", ")}`);
}

// 4. UUID hypothesis: does the value at +204 / +516 / +808 appear ELSEWHERE
// in the save (cross-referenced from character / event records)?
console.log("\n--- Cross-reference test: value at FC+x appears as u32 elsewhere ---");
function countAppearances(target, limit = 4) {
  let hits = 0;
  const tgtBuf = Buffer.alloc(4);
  tgtBuf.writeUInt32LE(target, 0);
  let idx = 0;
  while (true) {
    const i = buf.indexOf(tgtBuf, idx);
    if (i < 0) break;
    hits++;
    if (hits > limit) break;
    idx = i + 1;
  }
  return hits;
}
for (const off of [124, 128, 204, 516, 808]) {
  let total = 0, multi = 0;
  const sample = records.slice(0, 30); // sample of 30
  for (const r of sample) {
    const v = u32(r.fcIdx + off);
    if (v === 0 || v === 0xffffffff) continue;
    const n = countAppearances(v, 5);
    total += n;
    if (n >= 2) multi++;
  }
  console.log(`  FC+${off}: 30-sample, multi-occurrence count=${multi}/30, avg-appearances=${(total/30).toFixed(2)}`);
}

// 5. Sanity: scan -3500..-100 for an offset where same-faction settlements
// share u32, replicating session 86's owner-detection more loosely. Print
// top-scoring offsets.
console.log("\n--- Re-detect owner-like offset (top 10 most-shared u32 sites) ---");
// Build "expected co-faction groups" from the population/region data isn't
// available here; instead just measure low entropy (many shared u32s).
const offScores = [];
for (let d = -3500; d <= -100; d += 1) {
  const counts = new Map();
  let ok = 0;
  for (const r of records) {
    const o = r.marker + d;
    if (o < 0 || o + 4 > buf.length) continue;
    const v = u32(o);
    if (v === 0 || v === 0xffffffff) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
    ok++;
  }
  if (ok < 100) continue;
  // Score = number of distinct u32s that appear at least 5 times (looks like a faction tag).
  let groupHits = 0;
  for (const c of counts.values()) if (c >= 5) groupHits++;
  offScores.push({ d, groupHits, distinct: counts.size, ok });
}
offScores.sort((a, b) => b.groupHits - a.groupHits);
console.log("Top 12 d candidates (groupHits = # u32s appearing ≥5×):");
for (const s of offScores.slice(0, 12)) {
  console.log(`  d=${s.d.toString().padStart(5)}  groupHits=${s.groupHits}  distinct=${s.distinct}  ok=${s.ok}`);
}

// 6. Walk the +180 pointer for one settlement and dump what's at the target.
console.log("\n--- Pointer-walk dump for first 5 records (+124,+180,+496,+808 targets) ---");
for (const r of records.slice(0, 5)) {
  console.log(`\n  ${r.name}  fcIdx=0x${r.fcIdx.toString(16)}  detailStart=0x${r.detailStart.toString(16)}  detailEnd=0x${r.detailEnd.toString(16)}`);
  for (const off of [124, 180, 496, 808]) {
    const v = u32(r.fcIdx + off);
    const inRange = v >= r.detailStart && v < r.detailEnd ? "[IN-BODY]" : "[OUTSIDE]";
    let preview = "";
    if (v < buf.length - 16 && v > 0x100) {
      const bytes = buf.slice(v, v + 12).toString("hex");
      preview = ` -> [${bytes}]`;
    }
    console.log(`    +${off} = 0x${v.toString(16).padStart(8, "0")} ${inRange}${preview}`);
  }
}

// 7. Special: are +124/+180/+496/+808 a stride-316 / stride-628 sequence pointing
// to in-body markers? Diffs.
console.log("\n--- Pointer stride within record (does +180 - +124 = constant?) ---");
for (const r of records.slice(0, 10)) {
  const v124 = u32(r.fcIdx + 124);
  const v180 = u32(r.fcIdx + 180);
  const v496 = u32(r.fcIdx + 496);
  const v808 = u32(r.fcIdx + 808);
  // mask off the tag byte to get the 24-bit "low" if applicable.
  const lo24 = v => v & 0xffffff;
  console.log(`  ${r.name.padEnd(14)} lo24: 124=${lo24(v124).toString(16)} 180=${lo24(v180).toString(16)} 496=${lo24(v496).toString(16)} 808=${lo24(v808).toString(16)}  diffs: 180-124=${(lo24(v180)-lo24(v124))} 496-180=${lo24(v496)-lo24(v180)} 808-496=${lo24(v808)-lo24(v496)}`);
}
