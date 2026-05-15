// dig-aiarr-s87-1.js — Session 87 attempt 1: pin the +48 u32 array's value namespace.
//
// Hypothesis (per session-48 clues):
//   - The values 13..1306 in the +48 array of major faction records are INDICES
//     or KEYS into the stride-9 score table (§16 detector, body zone
//     [0x14e5ac6, 0x20e6e8e)). Each stride-9 record has format:
//       XX YY ZZ NN MM 00 00 00 00     (9 B)
//     where xyz = u24 LE (XX | YY<<8 | ZZ<<16) is the entity identifier.
//
// Method:
//   1. Extract all 5 major-faction u32 arrays from save_1.2.
//   2. Compute the UNION across all factions.
//   3. Scan body zone [0x14e5ac6, 0x20e6e8e) for stride-9 records. For each
//      9-aligned candidate matching the rigid pattern (5 trailing zeros AND
//      type-nibble enum), harvest its xyz:u24 value.
//   4. Check what fraction of the union appears as an xyz value in the
//      stride-9 table.
//   5. Specifically for value 1074 (cross-faction shared from session 48):
//      list every stride-9 record where xyz == 1074, plus the surrounding
//      context (nearest terminator string ahead — ptolemai/egyptian/etc).

const fs = require("fs");

const ROME_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const T1_PATH = `${ROME_DIR}/save_1.2.sav`;
const buf = fs.readFileSync(T1_PATH);

function findMajors(b) {
  const out = [];
  for (let p = 0; p < b.length - 64; p += 4) {
    if (b.readUInt32LE(p + 8) !== 100) continue;
    if (b.readUInt32LE(p + 12) !== 1) continue;
    if (b.readUInt32LE(p + 44) !== 6) continue;
    if (b.readUInt32LE(p + 24) !== p + 24) continue;
    if (b.readUInt32LE(p + 40) !== p + 40) continue;
    out.push(p);
  }
  return out;
}

function extractArray(b, base) {
  const n = b.readUInt32LE(base + 48);
  const vals = [];
  for (let i = 0; i < n; i++) vals.push(b.readUInt32LE(base + 52 + i * 4));
  return vals;
}

const majors = findMajors(buf);
console.log(`majors found: ${majors.length}`);

const factionArrays = majors.map(p => extractArray(buf, p));
const union = new Set();
for (const arr of factionArrays) for (const v of arr) union.add(v);
console.log(`union size across ${majors.length} majors: ${union.size}`);
const unionSorted = [...union].sort((a, b) => a - b);
console.log(`union range: ${unionSorted[0]}..${unionSorted[unionSorted.length-1]}`);

// === Harvest stride-9 xyz:u24 values from body zone ===
// Walk the entire zone — accept any 9-byte aligned record matching the rigid
// pattern. We don't replicate the run-grouping / threshold logic; we just
// harvest every match anywhere in the zone (over-broad but that's OK — we
// want a set of valid xyz values).

const ZONE_START = 0x14e5ac6;
const ZONE_END   = Math.min(0x20e6e8e, buf.length);
console.log(`zone: 0x${ZONE_START.toString(16)}..0x${ZONE_END.toString(16)} = ${ZONE_END - ZONE_START} bytes`);

// To handle alignment, we scan every byte position but only emit records that
// match the strict pattern (very strict so false positives are minimized):
//   bytes at p+5..p+8 == 0, and bytes at p+3 has low nibble 0 and <= 0x80.
const xyzCounts = new Map(); // xyz -> count
const xyzMmCounts = new Map(); // xyz -> { mm: count }
const xyzPositions = new Map(); // xyz -> [positions] (only first 5)
const valueXyzMatches = new Map(); // value -> count of xyz==value matches
for (const v of unionSorted) {
  valueXyzMatches.set(v, 0);
  xyzPositions.set(v, []);
}

for (let p = ZONE_START; p + 9 <= ZONE_END; p++) {
  if (buf[p+5] !== 0 || buf[p+6] !== 0 || buf[p+7] !== 0 || buf[p+8] !== 0) continue;
  const nn = buf[p+3];
  if ((nn & 0x0f) !== 0) continue;
  if (nn > 0x80) continue;
  const xyz = buf[p] | (buf[p+1] << 8) | (buf[p+2] << 16);
  xyzCounts.set(xyz, (xyzCounts.get(xyz) || 0) + 1);
  const mm = buf[p+4];
  if (!xyzMmCounts.has(xyz)) xyzMmCounts.set(xyz, new Map());
  const mmM = xyzMmCounts.get(xyz);
  mmM.set(mm, (mmM.get(mm) || 0) + 1);
  if (valueXyzMatches.has(xyz)) {
    valueXyzMatches.set(xyz, valueXyzMatches.get(xyz) + 1);
    const arr = xyzPositions.get(xyz);
    if (arr.length < 5) arr.push(p);
  }
}

console.log(`\ntotal distinct stride-9 xyz values in zone: ${xyzCounts.size}`);
console.log(`total stride-9 records harvested (alignment-agnostic): ${[...xyzCounts.values()].reduce((a, b) => a + b, 0)}`);

// === Cross-reference ===
let hit = 0;
for (const v of union) if ((xyzCounts.get(v) || 0) > 0) hit++;
console.log(`\n=== Cross-reference ===`);
console.log(`union values that appear as xyz in stride-9 table: ${hit}/${union.size} (${(hit / union.size * 100).toFixed(1)}%)`);

// per-faction
console.log(`\nPer-faction match rate:`);
for (let i = 0; i < factionArrays.length; i++) {
  const arr = factionArrays[i];
  let h = 0;
  for (const v of arr) if ((xyzCounts.get(v) || 0) > 0) h++;
  console.log(`  R${i} @0x${majors[i].toString(16)}: ${h}/${arr.length} (${(h / arr.length * 100).toFixed(1)}%)`);
}

// === Special: 1074 ===
console.log(`\n=== Value 1074 deep-dive ===`);
console.log(`1074 xyz-count in zone: ${xyzCounts.get(1074) || 0}`);
if (xyzCounts.get(1074)) {
  console.log(`MM distribution: ${[...(xyzMmCounts.get(1074) || new Map()).entries()].map(([m,c]) => `0x${m.toString(16)}:${c}`).join(", ")}`);
  console.log(`First 5 positions:`);
  for (const p of xyzPositions.get(1074)) {
    const ctx = buf.slice(p, p + 9).toString("hex");
    console.log(`  0x${p.toString(16)}: ${ctx}`);
  }
}

// Histogram match-counts for union values (how many times does each value appear as xyz?)
console.log(`\n=== Match-count histogram for the ${union.size} union values ===`);
const buckets = { 0: 0, 1: 0, 2: 0, "3-5": 0, "6-20": 0, "21+": 0 };
for (const v of union) {
  const c = xyzCounts.get(v) || 0;
  if (c === 0) buckets[0]++;
  else if (c === 1) buckets[1]++;
  else if (c === 2) buckets[2]++;
  else if (c <= 5) buckets["3-5"]++;
  else if (c <= 20) buckets["6-20"]++;
  else buckets["21+"]++;
}
for (const [k, v] of Object.entries(buckets)) console.log(`  ${k}: ${v}`);

// Control: random small ints in 13..1306 range — what's the baseline match rate?
// If random values match at the same rate, the cross-reference is uninformative.
console.log(`\n=== Control: 1000 random ints in 13..1306 ===`);
let ctrlHit = 0;
const seed = 42;
function rnd(i) { return ((seed * 9301 + i * 49297) % 233280) / 233280; }
for (let i = 0; i < 1000; i++) {
  const v = 13 + Math.floor(rnd(i) * (1306 - 13 + 1));
  if ((xyzCounts.get(v) || 0) > 0) ctrlHit++;
}
console.log(`  random match rate: ${ctrlHit}/1000 (${(ctrlHit / 1000 * 100).toFixed(1)}%)`);
