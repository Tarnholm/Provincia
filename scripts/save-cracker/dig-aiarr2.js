// dig-aiarr2.js — Session 48 attempt 2: where else do the array values appear?
//
// From attempt 1:
//   - T1 R0 values cross-appear in many places (1078 has 16 occurrences,
//     1074 has 21 occurrences).
//   - Cross-faction overlap is moderate (R0 shares 24 of 22 with others; R4
//     shares 26 of 24 with others) — suggesting GLOBAL IDs.
//   - Value 1074 appears in ALL 5 major factions. Value 698, 974, 1074, 1177,
//     436, 496 appear in BOTH T1 and T2 R0 → stable identity.
//
// Plan:
//   a. For T1 R0's 22 values, find ALL occurrences in the buffer.
//   b. Cluster them: how many sit in "AI array" zones (within +52..+200 of
//      another major record?) vs elsewhere in the file.
//   c. Look at the BYTES around each non-array occurrence: is there a pattern
//      (e.g. always followed by a small int, always preceded by a region
//      marker)?
//   d. For value 1074 (appears in ALL factions), find ALL its raw positions
//      and look at what's adjacent — what record type holds this value as a
//      "first-class" field?
//   e. ALSO: test if values could be SETTLEMENT/REGION names hashed.
//      Quick sanity: settlement count for RIS imperial is ~199 regions; some
//      faction starts with 0 settlements. So "list of every settlement
//      strategic-scored" → could be region weight values, not IDs.
//
// Confirm/refute SETTLEMENT-UUID hypothesis explicitly:
//   - If values are settlement UUIDs, they should appear NEAR the settlement
//     anchor (lat/lon coords) in the body-root.
//   - Look at the highest-frequency value's raw positions and inspect ±64
//     bytes for known settlement-record signatures.

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
  return { count: n, values: vals };
}

const majorsT1 = findMajors(bufT1);
const t1arr = extractArray(bufT1, majorsT1[0]);

// All array zones across all majors: each major's +52..+52+4N is an "in-array" position.
const arrayZones = []; // list of {start, end}
for (const m of majorsT1) {
  const n = bufT1.readUInt32LE(m + 48);
  arrayZones.push({ start: m + 52, end: m + 52 + n * 4 });
}

function isInArrayZone(p) {
  for (const z of arrayZones) {
    if (p >= z.start && p < z.end) return true;
  }
  return false;
}

// Look at where value 1074 appears — it's in ALL 5 majors AND appears 21
// times total. Inspect non-array-zone positions.
function inspectValue(buf, value) {
  const positions = [];
  for (let p = 0; p < buf.length - 4; p += 4) {
    if (buf.readUInt32LE(p) === value) positions.push(p);
  }
  return positions;
}

console.log(`=== Value 1074 inspection ===`);
const v1074 = inspectValue(bufT1, 1074);
console.log(`Total u32-aligned occurrences: ${v1074.length}`);
console.log(`In-array-zone: ${v1074.filter(p => isInArrayZone(p)).length}`);
console.log(`Outside array zones: ${v1074.filter(p => !isInArrayZone(p)).length}`);
for (const p of v1074.filter(pp => !isInArrayZone(pp)).slice(0, 10)) {
  // Dump ±32 bytes around it.
  const start = Math.max(0, p - 32);
  const end = Math.min(bufT1.length, p + 36);
  const hex = [];
  for (let i = start; i < end; i++) {
    if (i === p) hex.push(`[${bufT1[i].toString(16).padStart(2, "0")}]`);
    else hex.push(bufT1[i].toString(16).padStart(2, "0"));
  }
  console.log(`  @0x${p.toString(16)}: ${hex.join(" ")}`);
}

// Look at 5 of T1 R0's values that are CONFIRMED common with T2 R0 (stable
// identity). These should be most-clearly identifiable. Values: 436, 496, 698, 973, 1074, 1177.
console.log(`\n=== Stable values (common T1 R0 ∩ T2 R0) ===`);
const stable = [436, 496, 698, 973, 1074, 1177];
for (const v of stable) {
  const pos = inspectValue(bufT1, v);
  const outArr = pos.filter(p => !isInArrayZone(p));
  console.log(`  ${v}: total ${pos.length} occurrences, ${outArr.length} outside arrays`);
}

// Inspect T1 R0 itself: print all bytes from +0 to +200, with field commentary.
console.log(`\n=== T1 R0 byte map (+0..+260) ===`);
const base = majorsT1[0];
function dumpRel(buf, b, start, end) {
  for (let off = start; off < end; off += 16) {
    const hex = [];
    for (let j = 0; j < 16; j++) {
      hex.push(buf[b + off + j].toString(16).padStart(2, "0"));
    }
    console.log(`  +${off.toString().padStart(3)} (0x${off.toString(16).padStart(2, "0")}): ${hex.join(" ")}`);
  }
}
dumpRel(bufT1, base, 0, 260);

// Find all matches with EVERY array value AND check if those matches
// CONCENTRATE in any known zone (e.g. body-root settlement zone, header
// strings, midfile cells).
const allValues = new Set(t1arr.values);
const matches = {};
for (const v of allValues) matches[v] = [];
for (let p = 0; p < bufT1.length - 4; p += 4) {
  const v = bufT1.readUInt32LE(p);
  if (allValues.has(v)) matches[v].push(p);
}

console.log(`\n=== T1 R0 array value occurrences (collated) ===`);
for (const v of t1arr.values) {
  const positions = matches[v];
  const inArr = positions.filter(p => isInArrayZone(p)).length;
  const outArr = positions.filter(p => !isInArrayZone(p));
  console.log(`  ${v}: ${positions.length} total (${inArr} in array zones, ${outArr.length} elsewhere)`);
  // First 2 elsewhere positions:
  if (outArr.length) {
    console.log(`     elsewhere: ${outArr.slice(0, 3).map(p => "0x" + p.toString(16)).join(", ")}`);
  }
}

// Quick test of REGION COMPOUND hypothesis: if values are
// region_id * 6 + slot (slot 0..5), then values mod 6 should bias to
// specific residues.
const mods = {};
for (let m = 0; m < 12; m++) mods[m] = 0;
for (const v of t1arr.values) mods[v % 6]++;
console.log(`\n=== Mod-6 distribution of T1 R0 values ===`);
for (let m = 0; m < 6; m++) console.log(`  mod ${m}: ${mods[m]}`);
// And mod 12:
for (let m = 0; m < 12; m++) mods[m] = 0;
for (const v of t1arr.values) mods[v % 12]++;
console.log(`\n=== Mod-12 distribution ===`);
for (let m = 0; m < 12; m++) console.log(`  mod ${m}: ${mods[m]}`);

// Look at where elsewhere occurrences cluster.
console.log(`\n=== Elsewhere positions cluster analysis ===`);
const allElsewhere = [];
for (const v of t1arr.values) {
  for (const p of matches[v]) {
    if (!isInArrayZone(p)) allElsewhere.push({ pos: p, val: v });
  }
}
allElsewhere.sort((a, b) => a.pos - b.pos);
console.log(`Total elsewhere occurrences: ${allElsewhere.length}`);
console.log(`Range: 0x${allElsewhere[0].pos.toString(16)} to 0x${allElsewhere[allElsewhere.length - 1].pos.toString(16)}`);

// Cluster by 64KB windows.
const clusters = new Map();
for (const e of allElsewhere) {
  const win = Math.floor(e.pos / 0x10000) * 0x10000;
  if (!clusters.has(win)) clusters.set(win, 0);
  clusters.set(win, clusters.get(win) + 1);
}
console.log(`\n64KB cluster distribution:`);
for (const [win, cnt] of [...clusters].sort((a, b) => a[0] - b[0])) {
  if (cnt < 3) continue;
  console.log(`  0x${win.toString(16)} ..: ${"#".repeat(cnt)} ${cnt}`);
}

// Look at the offsets of "high-frequency" values: 1074 appears 21 times.
// Where are those 21 positions?
console.log(`\n=== High-frequency 1074 distribution by 64KB window ===`);
const w1074 = new Map();
for (const p of v1074) {
  const win = Math.floor(p / 0x10000) * 0x10000;
  w1074.set(win, (w1074.get(win) || 0) + 1);
}
for (const [win, cnt] of [...w1074].sort((a, b) => a[0] - b[0])) {
  console.log(`  0x${win.toString(16)} ..: ${cnt}`);
}

// THE KEY question: do the 22 values in T1 R0's array all sit at fixed
// relative offsets within a SETTLEMENT record? If yes, they're a per-faction
// score field of every settlement. The 22 values would be one per
// settlement-of-strategic-interest.
//
// Step: For each value, look at the elsewhere offsets and compute the
// nearest preceding self-pointer (section start). If many values land at
// the SAME relative offset from their nearest section start, that's a
// strong record-field signal.
console.log(`\n=== Per-value: nearest preceding self-pointer offset ===`);
function findSelfPointer(buf, pos) {
  // Self-pointer: u32 at q == q. Walk backward.
  for (let q = pos - 4; q >= Math.max(0, pos - 1024); q -= 4) {
    if (buf.readUInt32LE(q) === q) return q;
  }
  return -1;
}
for (const v of t1arr.values.slice(0, 8)) {
  const elsewhere = matches[v].filter(p => !isInArrayZone(p));
  if (elsewhere.length === 0) continue;
  const relOffs = elsewhere.slice(0, 6).map(p => {
    const sp = findSelfPointer(bufT1, p);
    return sp >= 0 ? p - sp : null;
  }).filter(x => x !== null);
  console.log(`  ${v}: relative-to-self-ptr offsets: [${relOffs.join(", ")}]`);
}

// === FINAL test: AI score / weight hypothesis ===
// Per session 47, the stride-16 records have A values 651..1028, range
// matching the AI-array's 13..1306. Session-47 hypothesized A is "AI
// evaluation score". Test: do the 22 T1-R0 array values OVERLAP with any
// stride-16 A values from R0's faction tail? If yes, the two structures
// share a value namespace.
//
// Compute the stride-16 A values from R0's tail.
const r0 = majorsT1[0];
const n0 = bufT1.readUInt32LE(r0 + 48);
const tailStart = r0 + 52 + n0 * 4 + 4 + 208; // post-sentinel +208 per session 46
const strideValsA = [];
// Walk stride-16 records starting at tailStart.
for (let q = tailStart; q < bufT1.length - 16; q += 16) {
  const tag = bufT1.readUInt32LE(q);
  if (tag !== 0x00010101) break;
  const a = bufT1.readUInt32LE(q + 4);
  if (a > 5000) break; // sentinel record A=239
  strideValsA.push(a);
}
console.log(`\n=== Stride-16 A values from T1 R0 tail (post-sentinel) ===`);
console.log(`  found ${strideValsA.length} entries: [${strideValsA.join(", ")}]`);
const stride16Set = new Set(strideValsA);
const arrInStride = t1arr.values.filter(v => stride16Set.has(v));
console.log(`  T1 R0 array values matching stride-16 A: ${arrInStride.length}/${t1arr.values.length} → [${arrInStride.join(", ")}]`);
