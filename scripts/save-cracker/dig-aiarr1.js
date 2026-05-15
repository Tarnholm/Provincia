// dig-aiarr1.js — Session 48 attempt 1: pin the semantic of the u32 values
// in the +44=6 major-faction-record's +48 count-prefixed u32 array.
//
// Confirmed by session 45:
//   +48      u32 count N
//   +52..    u32[N] values in range 13..1306
//   +52+4N   u32 = 30 (sentinel)
//
// HYPOTHESES (to test):
//   (1) Settlement UUIDs - settlements have primaryUuid 0x0001xxxx range per
//       session 47's note "NOT a settlement ID (would be 0x0001xxxx)".
//       The values here are 13..1306, so they CANNOT be raw 32-bit UUIDs but
//       could be UUID LOW BYTES (0x0001xxxx & 0x0000ffff).
//   (2) Character UUIDs - characters have full u32 primaryUuid in 0x015xxxxx
//       or larger range. Cannot match 13..1306.
//   (3) Region IDs in compound packing (region_id * 6 + slot, etc).
//   (4) Lua counter values.
//   (5) AI score buckets (matches session-47 stride-16 A field range 651..1028).
//
// Plan:
//   a. Extract Roman faction 0's array (22 values) from save_1.2.
//   b. Extract Roman faction 0's array (30 values) from T2 Start (30 values
//      per session-45 finding; verify count).
//   c. Compute set difference (values in T2 not in T1).
//   d. For each value v in the array, check membership against:
//      - All primaryUuid LOW 16 bits found in the save (character UUIDs).
//      - All primaryUuid LOW 16 bits found within settlement records
//        (or just all u32 candidates whose high 16 bits look like settlement
//        markers 0x0001).
//      - All region IDs (0..199).
//      - Faction-record-array values across OTHER faction records (do they
//        share values? if yes, values are global IDs of some kind).
//   e. Report match percentage per hypothesis.

const fs = require("fs");

const ROME_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const T1_PATH = `${ROME_DIR}/save_1.2.sav`;
const T2_PATH = `${ROME_DIR}/save_Autosave   Republic of Rome   Turn 2 Start.sav`;

const bufT1 = fs.readFileSync(T1_PATH);
const bufT2 = fs.readFileSync(T2_PATH);

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

function extractArray(buf, base) {
  const n = buf.readUInt32LE(base + 48);
  const vals = [];
  for (let i = 0; i < n; i++) vals.push(buf.readUInt32LE(base + 52 + i * 4));
  // Verify sentinel
  const sentinel = buf.readUInt32LE(base + 52 + n * 4);
  return { count: n, values: vals, sentinel };
}

const majorsT1 = findMajors(bufT1);
const majorsT2 = findMajors(bufT2);

console.log(`T1 majors: ${majorsT1.length}, T2 majors: ${majorsT2.length}`);

// Faction 0 in each.
const t1arr = extractArray(bufT1, majorsT1[0]);
const t2arr = extractArray(bufT2, majorsT2[0]);

console.log(`\n=== T1 faction 0 (@0x${majorsT1[0].toString(16)}) ===`);
console.log(`  count=${t1arr.count}, sentinel=0x${t1arr.sentinel.toString(16)}`);
console.log(`  values: [${t1arr.values.join(", ")}]`);
console.log(`  sorted: [${[...t1arr.values].sort((a, b) => a - b).join(", ")}]`);

console.log(`\n=== T2 faction 0 (@0x${majorsT2[0].toString(16)}) ===`);
console.log(`  count=${t2arr.count}, sentinel=0x${t2arr.sentinel.toString(16)}`);
console.log(`  values: [${t2arr.values.join(", ")}]`);
console.log(`  sorted: [${[...t2arr.values].sort((a, b) => a - b).join(", ")}]`);

// Set difference: values in T2 not in T1, and vice versa.
const t1set = new Set(t1arr.values);
const t2set = new Set(t2arr.values);
const t1only = [...t1set].filter(v => !t2set.has(v)).sort((a, b) => a - b);
const t2only = [...t2set].filter(v => !t1set.has(v)).sort((a, b) => a - b);
const common = [...t1set].filter(v => t2set.has(v)).sort((a, b) => a - b);
console.log(`\n=== T1 vs T2 set delta ===`);
console.log(`  common (${common.length}): [${common.join(", ")}]`);
console.log(`  T1-only (${t1only.length}): [${t1only.join(", ")}]`);
console.log(`  T2-only (${t2only.length}): [${t2only.join(", ")}]`);

// === Hypothesis 1: values are settlement primaryUuid LOW 16 bits ===
// Settlement primaryUuids look like 0x0001xxxx (16-bit high half = 0x0001).
// Scan T1 buffer for ALL u32 values where high 16 bits = 0x0001, harvest
// the low 16 bits.
function harvestSettlementUuids(buf) {
  // Settlement records: per session 4, have a c-string marker nearby.
  // Cheaper signal: just find all u32-aligned values with high=0x0001 and
  // low in plausible settlement-uuid range.
  const lowBits = new Set();
  for (let p = 0; p < buf.length - 4; p += 4) {
    const v = buf.readUInt32LE(p);
    // Settlement UUIDs high 16 bits = 0x0001 per session 47 quote.
    if ((v >>> 16) === 0x0001) {
      lowBits.add(v & 0xffff);
    }
  }
  return lowBits;
}

const settlementLowsT1 = harvestSettlementUuids(bufT1);
console.log(`\n=== Hypothesis 1: settlement UUID low-16 bits (0x0001xxxx pattern) ===`);
console.log(`  Distinct low-16 bit values from 0x0001xxxx pattern in T1: ${settlementLowsT1.size}`);
const t1Matches = t1arr.values.filter(v => settlementLowsT1.has(v));
const t2Matches = t2arr.values.filter(v => settlementLowsT1.has(v));
console.log(`  T1 array values that match: ${t1Matches.length}/${t1arr.values.length} (${(t1Matches.length / t1arr.values.length * 100).toFixed(1)}%)`);
console.log(`  T2 array values that match: ${t2Matches.length}/${t2arr.values.length} (${(t2Matches.length / t2arr.values.length * 100).toFixed(1)}%)`);

// === Hypothesis 1b: raw u32 match — do these values appear ANYWHERE in the save? ===
// If 80%+ appear as u32 somewhere with a nearby marker, they're IDs.
function findRawMatches(buf, values) {
  const valSet = new Set(values);
  const positions = new Map(); // value -> [positions]
  for (const v of values) positions.set(v, []);
  for (let p = 0; p < buf.length - 4; p += 4) {
    const v = buf.readUInt32LE(p);
    if (valSet.has(v)) positions.get(v).push(p);
  }
  return positions;
}

const t1Positions = findRawMatches(bufT1, t1arr.values);
console.log(`\n=== Hypothesis 1b: raw u32 occurrences in T1 ===`);
let totalPos = 0;
for (const [v, positions] of t1Positions) {
  totalPos += positions.length;
}
console.log(`  Total u32-aligned occurrences across all 22 values: ${totalPos}`);
console.log(`  Avg per value: ${(totalPos / t1arr.values.length).toFixed(1)}`);
// Sample: for the first 5 values, list positions.
console.log(`  Per-value sample (first 5):`);
for (const v of t1arr.values.slice(0, 5)) {
  const positions = t1Positions.get(v);
  console.log(`    ${v}: ${positions.length} occurrences. First few: [${positions.slice(0, 5).map(p => "0x" + p.toString(16)).join(", ")}]`);
}

// === Hypothesis 2: character UUIDs ===
// Character primaryUuids are full u32 in 0x015xxxxx or 0xcda44c06-style ranges.
// They CANNOT equal 13..1306 directly.
// BUT: what if these are character-uuid LOW 16 bits, or LOW 12 bits, or array
// INDICES into a character-uuid table?
// Quick test: harvest all distinct primaryUuid candidates (u32 at -47 from
// each candidate character-record start). We'd need to call the parser;
// instead, use a proxy — scan for u32 values in the 0x0150xxxx..0x015fxxxx
// range (the body-root character zone) and harvest their low 16 bits.
function harvestCharacterLow16(buf) {
  // Character primaryUuid values themselves are 0x015xxxxx style.
  // Scan for u32-aligned values matching that mask and collect low-16 bits.
  const lowBits = new Set();
  for (let p = 0; p < buf.length - 4; p += 4) {
    const v = buf.readUInt32LE(p);
    if ((v >>> 24) === 0x01 && ((v >>> 16) & 0xff) >= 0x50) {
      lowBits.add(v & 0xffff);
    }
  }
  return lowBits;
}
const charLowsT1 = harvestCharacterLow16(bufT1);
console.log(`\n=== Hypothesis 2: character UUID low-16 bits (0x015xxxxx pattern) ===`);
console.log(`  Distinct low-16 bit values in T1: ${charLowsT1.size}`);
const t1CharMatches = t1arr.values.filter(v => charLowsT1.has(v));
console.log(`  T1 array values that match char low-16: ${t1CharMatches.length}/${t1arr.values.length} (${(t1CharMatches.length / t1arr.values.length * 100).toFixed(1)}%)`);

// === Cross-faction: do other major records' arrays share values with R0? ===
// If values are GLOBAL IDs (settlement UUIDs, region IDs, score buckets),
// different factions should have overlapping value sets.
// If values are local-to-faction, factions' arrays should be disjoint.
console.log(`\n=== Cross-faction value overlap in T1 ===`);
const allFactionsArrays = majorsT1.map(p => extractArray(bufT1, p));
for (let i = 0; i < allFactionsArrays.length; i++) {
  const ai = new Set(allFactionsArrays[i].values);
  let totalOverlap = 0;
  let totalUniq = 0;
  for (let j = 0; j < allFactionsArrays.length; j++) {
    if (i === j) continue;
    const aj = new Set(allFactionsArrays[j].values);
    const overlap = [...ai].filter(v => aj.has(v)).length;
    totalOverlap += overlap;
    totalUniq += [...ai].filter(v => !aj.has(v)).length;
  }
  console.log(`  R${i}: count=${ai.size}, total overlap with other ${allFactionsArrays.length - 1} factions = ${totalOverlap}, total unique = ${totalUniq}`);
}

// Print all faction-0 values across all 5 T1 majors as sorted lists for visual inspection.
console.log(`\n=== T1 sorted values per major faction ===`);
for (let i = 0; i < allFactionsArrays.length; i++) {
  console.log(`  R${i}: [${[...allFactionsArrays[i].values].sort((a, b) => a - b).join(", ")}]`);
}

// Look at value distributions: histogram by 64-bucket.
function histogram(values) {
  const buckets = {};
  for (const v of values) {
    const b = Math.floor(v / 64) * 64;
    buckets[b] = (buckets[b] || 0) + 1;
  }
  return Object.entries(buckets).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
}
const allT1Values = allFactionsArrays.flatMap(a => a.values);
console.log(`\n=== T1 all-faction value histogram (bucket=64) ===`);
console.log(`  Total values: ${allT1Values.length}`);
console.log(`  Min: ${Math.min(...allT1Values)}, Max: ${Math.max(...allT1Values)}`);
for (const [b, c] of histogram(allT1Values)) {
  console.log(`    [${b.padStart(5, " ")}..${(parseInt(b) + 63).toString().padStart(5, " ")}]: ${"#".repeat(c)} ${c}`);
}
