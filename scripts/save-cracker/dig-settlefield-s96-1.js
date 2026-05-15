// dig-settlefield-s96-1.js — session 96, attempt 1
// Cross-reference per-settlement u32 fields at FC+{124,128,180,204,496,516,808}
// (the 577/577-unique payload offsets identified in session 94) against KNOWN
// settlement attributes to pin their semantics.
//
// Known attributes available:
//   - Settlement UUID  (from session 86 / detected currentOwner offset, but
//     that field is the FACTION UUID, not settlement UUID — we treat each
//     "marker offset" itself as a settlement identifier and look for u32s
//     elsewhere that equal it).
//   - Region (descr_regions + map_regions) → region ID via lookup.
//   - Faction owner ID  (resolveCurrentOwners via marker-454/-1944).
//   - Population        (mod data: population_large.json keyed by region).
//
// For each detail blob and each candidate offset C, build the value list
// values[C] = [v_0, v_1, ...] over the 577 settlements. Then test against
// each known attribute A = [a_0, a_1, ...]:
//   - exact-match score = sum( values[C][i] == A[i] )
//   - mod-2^16 / mod-2^8 partial match (in case the field is a u16 / byte)
//   - lo16 / hi16 match
// Also compute the per-offset value-rank correlation (Spearman-like): both
// arrays sorted by value should give similar ranking if A is a monotonic
// function of values[C].
//
// Confidence: any offset with >= 80% exact match against an attribute = HARD PIN.

"use strict";
const fs = require("fs");
const path = require("path");
const PROVINCIA_SRC = path.resolve(__dirname, "../../src");
const PUBLIC = path.resolve(__dirname, "../../public");
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";

const { findAllSettlementMarkers } = require(path.join(PROVINCIA_SRC, "buildingParser.js"));
const saveOwn = require(path.join(PROVINCIA_SRC, "saveOwnershipParser.js"));

const buf = fs.readFileSync(SAVE);
const SETT_START = 0xf85f00;
const SETT_END = 0x1f10c72;
const FC_MAGIC = Buffer.from([0xfc, 0xfc, 0xfc, 0xfc, 0x64, 0x00, 0x00, 0x00, 0x00]);
const CAND = [124, 128, 180, 204, 496, 516, 808];

// 1. Load mod data.
const regions = JSON.parse(fs.readFileSync(path.join(PUBLIC, "regions_large.json"), "utf8"));
const popByRegion = JSON.parse(fs.readFileSync(path.join(PUBLIC, "population_large.json"), "utf8"));
const factionsRegions = JSON.parse(fs.readFileSync(path.join(PUBLIC, "factions_with_regions_large.json"), "utf8"));

// city → region, city → faction (initial), region → ordinal id
const cityToRegion = {};
const regionToCity = {};
const cityToInitialFac = {};
const regionOrdinal = {};
let ord = 0;
for (const rgb of Object.keys(regions)) {
  const r = regions[rgb];
  cityToRegion[r.city] = r.region;
  regionToCity[r.region] = r.city;
  cityToInitialFac[r.city] = r.faction;
  if (!(r.region in regionOrdinal)) regionOrdinal[r.region] = ord++;
}
// Faction ID from descr index (alphabetical, but we want match to whatever
// the save encodes — use index in factions_with_regions key order).
const factionList = Object.keys(factionsRegions);
const factionOrdinal = {};
factionList.forEach((f, i) => { factionOrdinal[f] = i; });
console.log(`mod data: cities=${Object.keys(cityToRegion).length} factions=${factionList.length}`);

// 2. Settlement markers + detail blobs.
const setts = findAllSettlementMarkers(buf).filter(s => s.offset >= SETT_START && s.offset < SETT_END);
console.log(`settlement markers: ${setts.length}`);

const records = [];
for (let i = 0; i < setts.length; i++) {
  const cur = setts[i];
  const next = i + 1 < setts.length ? setts[i + 1] : { offset: SETT_END };
  const detailStart = cur.blockEnd;
  const detailEnd = next.offset;
  if (detailEnd - detailStart < 4000) continue;
  const fcIdx = buf.indexOf(FC_MAGIC, detailStart);
  if (fcIdx < 0 || fcIdx >= detailStart + 64) continue;
  records.push({ name: cur.name, marker: cur.offset, fcIdx, detailStart, detailEnd });
}
console.log(`detail blobs >=4000B: ${records.length}`);

// 3. Owner UUID per settlement (current).
const ownerInfo = saveOwn.resolveCurrentOwners(buf, cityToInitialFac);
console.log(`detected owner offset: ${ownerInfo.detectedOffset}, dictSize=${ownerInfo.dictSize}`);
const ownerUuid = {};
const d = ownerInfo.detectedOffset;
for (const r of records) {
  const o = r.marker + d;
  if (o >= 0 && o + 4 <= buf.length) {
    ownerUuid[r.name] = buf.readUInt32LE(o);
  }
}

// 4. Build the candidate u32 vectors.
const vecAtOffset = new Map(); // off → Array of u32 (one per record)
for (const off of CAND) {
  const arr = [];
  for (const r of records) {
    const o = r.fcIdx + off;
    if (o + 4 > r.detailEnd) { arr.push(null); continue; }
    arr.push(buf.readUInt32LE(o));
  }
  vecAtOffset.set(off, arr);
}

// 5. Build known-attribute vectors over the SAME record order.
const attrs = {
  ownerUuid:      records.map(r => ownerUuid[r.name] ?? null),
  ownerFacIdx:    records.map(r => {
    const f = ownerInfo.ownerByCity[r.name];
    return f && (f in factionOrdinal) ? factionOrdinal[f] : null;
  }),
  initialFacIdx:  records.map(r => cityToInitialFac[r.name] in factionOrdinal ? factionOrdinal[cityToInitialFac[r.name]] : null),
  regionOrdinal:  records.map(r => {
    const rgn = cityToRegion[r.name];
    return rgn && (rgn in regionOrdinal) ? regionOrdinal[rgn] : null;
  }),
  population:     records.map(r => {
    const rgn = cityToRegion[r.name];
    return rgn ? (popByRegion[rgn] ?? null) : null;
  }),
  markerOffset:   records.map(r => r.marker),     // settlement record absolute offset
  detailStart:    records.map(r => r.detailStart),
  fcIdx:          records.map(r => r.fcIdx),
};

// 6. For each (candidate offset, attribute) pair, compute matches.
function matchScore(vec, attr) {
  let exact = 0, lo16 = 0, lo8 = 0, hi16 = 0, n = 0;
  let nNonNull = 0;
  for (let i = 0; i < vec.length; i++) {
    if (vec[i] === null || attr[i] === null) continue;
    nNonNull++;
    const v = vec[i] >>> 0, a = attr[i] >>> 0;
    if (v === a) exact++;
    if ((v & 0xffff) === (a & 0xffff)) lo16++;
    if ((v & 0xff) === (a & 0xff)) lo8++;
    if ((v >>> 16) === (a & 0xffff)) hi16++;
    n++;
  }
  return { exact, lo16, lo8, hi16, n: nNonNull };
}

console.log("\n--- Match table (exact / lo16 / lo8 / hi16 of n) ---");
console.log("offset".padEnd(7) + "|attr".padEnd(15) + "|exact   lo16   lo8    hi16   n");
const HARDPIN = [];
for (const off of CAND) {
  const vec = vecAtOffset.get(off);
  for (const [name, arr] of Object.entries(attrs)) {
    const m = matchScore(vec, arr);
    if (m.n === 0) continue;
    const pctExact = (m.exact / m.n * 100).toFixed(1);
    const pctLo16 = (m.lo16 / m.n * 100).toFixed(1);
    const pctLo8 = (m.lo8 / m.n * 100).toFixed(1);
    const pctHi16 = (m.hi16 / m.n * 100).toFixed(1);
    const star = m.exact / m.n >= 0.5 ? " ***" : "";
    if (m.exact / m.n >= 0.8) HARDPIN.push({ off, attr: name, m });
    console.log(`+${off.toString().padEnd(5)} | ${name.padEnd(14)} | ${pctExact.padStart(5)}% ${pctLo16.padStart(5)}% ${pctLo8.padStart(5)}% ${pctHi16.padStart(5)}% n=${m.n}${star}`);
  }
}

// 7. Bonus: pairwise correlation BETWEEN candidate offsets to see if any are
//    duplicates of each other.
console.log("\n--- Pairwise equality between candidate offsets ---");
for (let i = 0; i < CAND.length; i++) {
  for (let j = i + 1; j < CAND.length; j++) {
    const a = vecAtOffset.get(CAND[i]), b = vecAtOffset.get(CAND[j]);
    let eq = 0, n = 0;
    for (let k = 0; k < a.length; k++) {
      if (a[k] === null || b[k] === null) continue;
      n++; if (a[k] === b[k]) eq++;
    }
    if (eq / n > 0.05) {
      console.log(`  +${CAND[i]} vs +${CAND[j]}: ${eq}/${n} (${(eq/n*100).toFixed(1)}%) equal`);
    }
  }
}

// 8. Sample dump: first 12 records, all candidate offsets + key attrs.
console.log("\n--- First 12 settlements (raw u32 values per offset, plus known attrs) ---");
const hdr = ["name", ...CAND.map(o => `+${o}`), "owner", "fac", "rgn", "pop"];
console.log(hdr.map(h => h.padEnd(11)).join(""));
for (let i = 0; i < 12; i++) {
  const r = records[i];
  const row = [
    r.name.slice(0, 10).padEnd(11),
    ...CAND.map(o => {
      const v = vecAtOffset.get(o)[i];
      return v === null ? "--".padEnd(11) : ("0x" + v.toString(16).padStart(8, "0")).padEnd(11);
    }),
    (attrs.ownerUuid[i] === null ? "--" : ("0x" + (attrs.ownerUuid[i] >>> 0).toString(16))).padEnd(11),
    String(attrs.ownerFacIdx[i] ?? "--").padEnd(11),
    String(attrs.regionOrdinal[i] ?? "--").padEnd(11),
    String(attrs.population[i] ?? "--").padEnd(11),
  ];
  console.log(row.join(""));
}

// 9. Final: hard pins.
console.log("\n--- HARD PINS (>=80% exact) ---");
if (HARDPIN.length === 0) console.log("  none");
for (const p of HARDPIN) {
  console.log(`  FC+${p.off} → ${p.attr}  (${p.m.exact}/${p.m.n} exact)`);
}
