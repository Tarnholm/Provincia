// dig-zonea2.js — session 84 attempt 2.
// Findings from attempt 1:
//   - ZoneA is 94.7% zeros (much sparser than session 54 claimed).
//   - save_1.2 / save_2.2 / save_3.2 have IDENTICAL island count (2648) and
//     identical first-island structure, but DIFFERENT 4-byte values inside.
//     -> Looks like a fixed slot table with hashed/random values per save.
//   - RoR T2_Start has DIFFERENT island count (2704) and different layout —
//     first islands at completely different offsets.
//   - 0 taw self-pointer hits — not a section.
//   - ASCII fragments look like random bytes (collision artefacts of high-
//     entropy u32s), NOT message templates or names.
//
// Hypothesis ranking to test:
//   H1 = AI faction-knowledge cache / fog-of-war memory of enemy units
//        (would be tied to character/army UUIDs; would CHANGE per save and
//        grow turn-over-turn as AI learns).
//   H2 = RNG / scripted-event seed state (would be opaque hashes; would
//        change across saves but with similar structural slot layout).
//   H3 = Per-character intent / orders queue (would grow with turn count
//        and tie to character UUIDs we know).
//
// Tests:
//   A) Compare save_1.2 vs save_2.2 vs save_3.2: are the SAME byte positions
//      occupied? If yes & values differ, it's a content-stable slot table
//      with per-save values (rules out tied-to-character-creation).
//   B) Compare turn-1 vs turn-2 save: does T2 have MORE occupied slots in
//      the SAME positions as T1? Or completely different layout?
//   C) Cross-reference 4-byte values vs known character-UUID hash table.
//   D) Probe a few "72-byte slot" candidates: at the strongest stride=72
//      run, dump 10 consecutive slots side-by-side to see the schema.

"use strict";
const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
const SAVES = {
  s12: SAVE_DIR + "save_1.2.sav",
  s22: SAVE_DIR + "save_2.2.sav",
  s32: SAVE_DIR + "save_3.2.sav",
  t2:  SAVE_DIR + "save_Autosave   Republic of Rome   Turn 2 Start.sav",
  t1:  SAVE_DIR + "save_Autosave   Republic of Rome   Turn 1 End.sav",
};

const ZA_START = 0x61c47;
const ZA_END   = 0x846af;
const ZA_LEN   = ZA_END - ZA_START;

const bufs = {};
for (const [k, p] of Object.entries(SAVES)) {
  if (fs.existsSync(p)) bufs[k] = fs.readFileSync(p);
  else console.log(`[skip ${k}] missing: ${p}`);
}

// ------ A) Build occupancy bitmap & compare byte-position occupancy ------
function occMap(buf) {
  const occ = new Uint8Array(ZA_LEN);
  for (let i = 0; i < ZA_LEN; i++) occ[i] = buf[ZA_START + i] !== 0 ? 1 : 0;
  return occ;
}

const occs = {};
for (const [k, b] of Object.entries(bufs)) occs[k] = occMap(b);

function compareOcc(a, b) {
  let same = 0, both1 = 0, only_a = 0, only_b = 0, both0 = 0;
  for (let i = 0; i < ZA_LEN; i++) {
    if (occs[a][i] === occs[b][i]) {
      same++;
      if (occs[a][i] === 1) both1++; else both0++;
    } else if (occs[a][i]) only_a++; else only_b++;
  }
  return { same, both1, both0, only_a, only_b };
}

console.log("\n=== Occupancy comparison (same-position non-zero?) ===");
const pairs = [["s12","s22"], ["s12","s32"], ["s22","s32"], ["s12","t2"], ["t1","t2"]];
for (const [a, b] of pairs) {
  if (!bufs[a] || !bufs[b]) continue;
  const c = compareOcc(a, b);
  const iou = c.both1 / (c.both1 + c.only_a + c.only_b);
  console.log(`  ${a} vs ${b}: both-nonzero=${c.both1}  only-${a}=${c.only_a}  only-${b}=${c.only_b}  IoU=${(iou*100).toFixed(1)}%`);
}

// ------ B) Per-byte BYTE-equal comparison (do same positions hold same values?) ------
function byteEqual(a, b) {
  let same = 0, diff = 0, sameNZ = 0, diffNZ = 0;
  for (let i = 0; i < ZA_LEN; i++) {
    const va = bufs[a][ZA_START+i], vb = bufs[b][ZA_START+i];
    if (va === vb) { same++; if (va !== 0) sameNZ++; }
    else { diff++; if (va !== 0 || vb !== 0) diffNZ++; }
  }
  return { same, diff, sameNZ, diffNZ };
}
console.log("\n=== Byte equality comparison ===");
for (const [a, b] of pairs) {
  if (!bufs[a] || !bufs[b]) continue;
  const c = byteEqual(a, b);
  console.log(`  ${a} vs ${b}: same-bytes=${c.same} (${(c.same*100/ZA_LEN).toFixed(1)}%)  diff-bytes=${c.diff}  nonzero-diff=${c.diffNZ}`);
}

// ------ C) Pull the 4-byte values that look like hashes; compare across saves ------
// From attempt 1, every save_X.2 has a hash at offset ZA_START+0x2d ..+0x31:
//   save_1.2: 22 f3 74 6a 00
//   save_2.2: ef 7c 84 be 00
//   save_3.2: 40 cf 2c 74 00
// Extract u32 at each non-zero "island" of length 4..8 across all save_X.2.
function islandU32s(buf, minLen=4, maxLen=12) {
  const items = [];
  let start = -1;
  for (let i = 0; i < ZA_LEN; i++) {
    const nz = buf[ZA_START+i] !== 0;
    if (nz && start === -1) start = i;
    if (!nz && start !== -1) {
      const len = i - start;
      if (len >= minLen && len <= maxLen) {
        items.push({ off: ZA_START + start, len, u32: buf.readUInt32LE(ZA_START + start) });
      }
      start = -1;
    }
  }
  return items;
}
console.log("\n=== Are the per-save 'hash' values at the SAME offsets? ===");
const sets = ["s12","s22","s32"].filter(k => bufs[k]);
const it = {};
for (const k of sets) it[k] = islandU32s(bufs[k]);
console.log(`island count (len 4..12 nonzero runs): ${sets.map(k=>`${k}=${it[k].length}`).join(", ")}`);
// Map offsets to value
const maps = {};
for (const k of sets) {
  maps[k] = new Map();
  for (const i of it[k]) maps[k].set(i.off, i.u32);
}
// Pick offsets present in all 3 saves
const inAll = [...maps[sets[0]].keys()].filter(o => sets.every(k => maps[k].has(o)));
console.log(`offsets occupied in all 3 saves: ${inAll.length}`);
const sameVal = inAll.filter(o => sets.every(k => maps[k].get(o) === maps[sets[0]].get(o)));
const diffVal = inAll.filter(o => !sets.every(k => maps[k].get(o) === maps[sets[0]].get(o)));
console.log(`  -> identical value across all 3: ${sameVal.length}`);
console.log(`  -> differs across saves: ${diffVal.length}`);

// Show first 10 differing slots with their u32 across saves
console.log("\nFirst 10 differing-value slots:");
for (const o of diffVal.slice(0, 10)) {
  const tag = sets.map(k => `${k}=0x${(maps[k].get(o)>>>0).toString(16).padStart(8,'0')}`).join("  ");
  console.log(`  off 0x${o.toString(16)}  ${tag}`);
}

// ------ D) Search known character-UUID-hash table (session 26): u32 hashes ------
// We don't have the hash table in memory but we can ask: do these u32 values
// look like 32-bit random hashes (full entropy)? Check distribution:
function entropy32(items) {
  // Count distinct top-8-bit, ensure spread is ~uniform.
  const tb = new Array(256).fill(0);
  for (const i of items) tb[(i.u32 >>> 24) & 0xff]++;
  let total = items.length;
  let H = 0;
  for (const c of tb) if (c) { const p = c/total; H -= p * Math.log2(p); }
  return H; // max 8 for uniform
}
console.log("\n=== Top-byte entropy of 4..12-byte island values (max=8.0 if uniform random) ===");
for (const k of sets) console.log(`  ${k}: H=${entropy32(it[k]).toFixed(3)} bits (n=${it[k].length})`);

// ------ E) Hexdump 20 consecutive bytes starting at known stride-72 region ------
// The strongest stride is 13 (393 hits) — short slots. Stride 72/152 secondary.
// Find first run of >=5 consecutive 72-stride island starts, dump 5 in a row.
function findStrideRun(buf, want=72, runLen=5) {
  const occ = occMap(buf);
  // collect island starts of any length
  const starts = [];
  let inIsl = false;
  for (let i = 0; i < ZA_LEN; i++) {
    if (occ[i]) { if (!inIsl) { starts.push(i); inIsl = true; } }
    else inIsl = false;
  }
  for (let i = 0; i + runLen <= starts.length; i++) {
    let ok = true;
    for (let j = 1; j < runLen; j++) if (starts[i+j] - starts[i+j-1] !== want) { ok = false; break; }
    if (ok) return starts.slice(i, i + runLen);
  }
  return null;
}
console.log("\n=== Stride-72 run hexdump (save_1.2) ===");
if (bufs.s12) {
  const run = findStrideRun(bufs.s12, 72, 4);
  if (run) {
    for (const r of run) {
      const off = ZA_START + r;
      const hex = [];
      for (let j = 0; j < 72; j++) hex.push(bufs.s12[off+j].toString(16).padStart(2,"0"));
      console.log(`  +0x${r.toString(16).padStart(5,"0")} (abs 0x${off.toString(16)}): ${hex.slice(0,24).join(" ")} ...`);
    }
  } else console.log("  (no stride-72 run of 4 found)");
}
console.log("\n=== Stride-152 run hexdump (save_1.2) ===");
if (bufs.s12) {
  const run = findStrideRun(bufs.s12, 152, 3);
  if (run) {
    for (const r of run) {
      const off = ZA_START + r;
      const hex = [];
      for (let j = 0; j < 64; j++) hex.push(bufs.s12[off+j].toString(16).padStart(2,"0"));
      console.log(`  +0x${r.toString(16).padStart(5,"0")} (abs 0x${off.toString(16)}): ${hex.join(" ")}`);
    }
  } else console.log("  (no stride-152 run of 3 found)");
}

// ------ F) Quantitative summary ------
console.log("\n=== SUMMARY ===");
console.log(`ZoneA = ${ZA_LEN} B, 94.7% zeros (~7,500 nonzero bytes per save).`);
console.log(`turn-1 (save_X.2) island count: identical across 1.2/2.2/3.2 = 2648.`);
console.log(`turn-2 (T2_Start) island count: 2704 (delta = +56 slots).`);
console.log(`occupancy IoU s12 vs t2 measured above.`);
console.log(`per-save VALUES differ at same offsets -> slot layout fixed, contents savestate-specific.`);
