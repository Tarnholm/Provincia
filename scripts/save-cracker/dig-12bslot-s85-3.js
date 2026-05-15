// dig-12bslot-s85-3.js — session 85 follow-up. The first 2 runs gave us:
//
// KEY FINDINGS:
//  1. The 7 "tags" appear OUTSIDE the slot table in 12-byte records with
//     this structure (see context dump @ 0xd31e0 for tag 0x8713173a):
//       [02 00 00 4c 01 00 00 a0 02 00 00 01]  — preceding 12B record
//       [dc 31 0d 00] [3a 17 13 87] [e4 31 0d 00] [19 00 00 00]  — record at 0xd31e0
//     The bytes "dc 31 0d 00" = 0xd31dc (current_pos - 4) and "e4 31 0d 00"
//     = 0xd31e4 (current_pos + 4). These are FILE OFFSETS (LE u32) bracketing
//     the tag. Pattern: [offset_self_minus_4] [tag] [offset_self_plus_4]
//     [counter] — looks like LINKED-LIST / doubly-linked nodes.
//
//  2. The slot table at 0x2d4a9 has DIFFERENT semantics for its +4..+11
//     fields than its outside-gap occurrences. Inside the slot table the
//     "tag" field really IS the same dictionary tag value but the seq field
//     is u32 not bracketing offsets.
//
//  3. 47% of slots change between T1 and T2. This is RUNTIME state, not
//     static treaty data.
//
//  4. Session 57 cookies 0x7a55780e and 0xe06cfa4a appear AS slot tags at
//     slots 2144-2145 — confirms session 57's claim that the event log
//     references the slot table.
//
// HYPOTHESIS REFINEMENT:
//   The 214 KB table looks like a **per-turn AI decision cache / agenda
//   queue**. Specifically, a STATEFUL prioritized work-queue where:
//     * kind = task/relation type (0x2001 = trade-route ops; 0x0004 = war)
//     * idx  = subject id (region/character index, 0x11d..0x3cf range)
//     * seq  = priority OR timestamp
//     * tag  = AI agent / faction-personality hash (only 7 distinct values
//              -> 7 AI player personalities or 7 system event sources)
//
// REMAINING TESTS:
//   A. Map idx values to character IDs via the character zone.
//   B. Check turn-2 seq spread: does it shift consistently (turn counter)?
//   C. The 7 tags may be FACTION-HASH cookies. Test by counting how many
//      slots reference each tag in T1 vs T2. If a faction was destroyed
//      between turns, its tag's count should drop to zero.
//   D. Brute-test: do the 7 tags appear in the character zone or faction
//      zone as 4-byte LE values?

"use strict";
const fs = require("fs");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
const SAVE_T1 = SAVE_DIR + "save_1.2.sav";
const SAVE_T2 = SAVE_DIR + "save_Autosave   Republic of Rome   Turn 2 Start.sav";
const GAP_START = 0x2d4a9;
const GAP_END   = 0x618f8;
const buf = fs.readFileSync(SAVE_T1);
const buf2 = fs.readFileSync(SAVE_T2);

// Both seq=638 and seq=633 are SMALL (turn-counter style: turn 1 has 638, turn 2 has 633).
// If seq is a turn-stamp, T2 should have HIGHER seq, not lower.
// Wait: slot 0 in T1 has seq=638; slot 0 in T2 has seq=633. The actual slot
// PHYSICAL position is the same but content shifted. Maybe slots are
// SORTED by something (idx? priority?) and slot 0 just refers to a different
// entity in T2.

// Re-parse both, focus on the dense head (first 100 slots).
console.log("=== Head-slot comparison T1 vs T2 ===");
console.log("slot  T1: kind|idx|seq|tag                T2: kind|idx|seq|tag");
for (let s = 0; s < 30; s++) {
  const p = GAP_START + s*12;
  const a = {k:buf.readUInt16LE(p), i:buf.readUInt16LE(p+2), s:buf.readUInt32LE(p+4), t:buf.readUInt32LE(p+8)};
  const b = {k:buf2.readUInt16LE(p), i:buf2.readUInt16LE(p+2), s:buf2.readUInt32LE(p+4), t:buf2.readUInt32LE(p+8)};
  const fmt = r => `0x${r.k.toString(16).padStart(4,"0")} 0x${r.i.toString(16).padStart(4,"0")} ${r.s.toString().padStart(5)} 0x${r.t.toString(16).padStart(8,"0")}`;
  console.log(`  ${s.toString().padStart(3)} | ${fmt(a)} | ${fmt(b)}`);
}

// Look at seq distribution for T1 vs T2
function seqStats(b) {
  const seqs = [];
  for (let p = GAP_START; p + 12 <= GAP_END; p += 12) {
    const k = b.readUInt16LE(p), i = b.readUInt16LE(p+2), s = b.readUInt32LE(p+4), t = b.readUInt32LE(p+8);
    if (k===0&&i===0&&s===0&&t===0) continue;
    seqs.push(s);
  }
  return seqs;
}
const seqs1 = seqStats(buf), seqs2 = seqStats(buf2);
const small1 = seqs1.filter(s => s < 100000);
const small2 = seqs2.filter(s => s < 100000);
console.log(`\nT1 'small' seqs (<100K): count=${small1.length}, min=${Math.min(...small1)}, max=${Math.max(...small1)}`);
console.log(`T2 'small' seqs (<100K): count=${small2.length}, min=${Math.min(...small2)}, max=${Math.max(...small2)}`);

// Top tags by count, T1 vs T2.
console.log("\n=== Tag count: T1 vs T2 ===");
function tagCount(b) {
  const m = new Map();
  for (let p = GAP_START; p + 12 <= GAP_END; p += 12) {
    const k = b.readUInt16LE(p), i = b.readUInt16LE(p+2), s = b.readUInt32LE(p+4), t = b.readUInt32LE(p+8);
    if (k===0&&i===0&&s===0&&t===0) continue;
    m.set(t, (m.get(t)||0)+1);
  }
  return m;
}
const tc1 = tagCount(buf), tc2 = tagCount(buf2);
const allTags = new Set([...tc1.keys(), ...tc2.keys()]);
const tagDelta = [...allTags].map(t => ({t, c1: tc1.get(t)||0, c2: tc2.get(t)||0}));
tagDelta.sort((a,b)=>(b.c1+b.c2)-(a.c1+a.c2));
console.log("  tag                T1   T2   delta");
for (const d of tagDelta.slice(0, 15)) {
  console.log(`  0x${d.t.toString(16).padStart(8,"0")}  ${d.c1.toString().padStart(4)} ${d.c2.toString().padStart(4)}  ${(d.c2-d.c1).toString().padStart(5)}`);
}

// Check tag count = 22? 7? Faction count?
console.log(`\n  total unique tags T1: ${tc1.size}  T2: ${tc2.size}`);

// === 22 factions test: are there exactly 22 tags with high count?
const t1Tags = [...tc1.entries()].sort((a,b)=>b[1]-a[1]);
console.log("\n  T1 tags with count >= 5:");
const sigTags1 = t1Tags.filter(([t,c])=>c>=5);
console.log(`  count: ${sigTags1.length}`);
for (const [t,c] of sigTags1.slice(0, 30)) console.log(`    0x${t.toString(16).padStart(8,"0")}: ${c}`);

// Check: read descr_sm_factions to get full faction list
const factionsRaw = fs.readFileSync("C:/dev/Provincia/public/descr_sm_factions.txt", "utf-8");
const factionNames = [...new Set([...factionsRaw.matchAll(/^faction\s+([a-z_]+)/gm)].map(m=>m[1]))];
console.log(`\n  factions in mod: ${factionNames.length}`);

// Hash the faction names with djb2 and fnv1a; do any tags match?
function djb2(s) { let h=5381; for(const c of s) h = (Math.imul(h,33) ^ c.charCodeAt(0)) >>> 0; return h>>>0; }
function fnv1a(s) { let h=0x811c9dc5; for(const c of s) h = Math.imul((h^c.charCodeAt(0))>>>0, 0x01000193)>>>0; return h>>>0; }
function crc32fn() {
  const tbl = new Uint32Array(256);
  for (let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c = (c&1) ? (0xedb88320 ^ (c>>>1)) : (c>>>1); tbl[n]=c; }
  return s => { let c=0xffffffff; for(const ch of s) c=(c>>>8)^tbl[(c^ch.charCodeAt(0))&0xff]; return (c^0xffffffff)>>>0; };
}
const crc32 = crc32fn();
const tagSet = new Set([...tc1.keys(), ...tc2.keys()]);
let hitsD=0, hitsF=0, hitsC=0;
for (const fn of factionNames) {
  const h1 = djb2(fn), h2 = fnv1a(fn), h3 = crc32(fn);
  if (tagSet.has(h1)) { console.log(`    djb2 hit: ${fn} → 0x${h1.toString(16)}`); hitsD++; }
  if (tagSet.has(h2)) { console.log(`    fnv1a hit: ${fn} → 0x${h2.toString(16)}`); hitsF++; }
  if (tagSet.has(h3)) { console.log(`    crc32 hit: ${fn} → 0x${h3.toString(16)}`); hitsC++; }
}
console.log(`  total hits: djb2=${hitsD} fnv1a=${hitsF} crc32=${hitsC}`);

// === Are the tags actually settlement names? regions_large keys?
const regions = Object.values(require("C:/dev/Provincia/public/regions_large.json"));
console.log(`\n  regions: ${regions.length}`);
let regHits = 0;
const regNames = regions.flatMap(r => [r.region, r.city]).filter(Boolean);
for (const nm of regNames) {
  const h1 = djb2(nm), h2 = fnv1a(nm), h3 = crc32(nm);
  if (tagSet.has(h1)) { console.log(`    djb2 hit: ${nm} → 0x${h1.toString(16)}`); regHits++; }
  if (tagSet.has(h2)) { console.log(`    fnv1a hit: ${nm} → 0x${h2.toString(16)}`); regHits++; }
  if (tagSet.has(h3)) { console.log(`    crc32 hit: ${nm} → 0x${h3.toString(16)}`); regHits++; }
}
console.log(`  region-name hits: ${regHits}`);

// === Final check: where exactly does idx 0x11d..0x3cf live in the file?
// Are these region UUIDs in mods? Hand-decode by mapping idx → settlement
// records.
console.log("\n=== idx (kind=0x2001) distribution ===");
const k2001 = new Map();
for (let p = GAP_START; p + 12 <= GAP_END; p += 12) {
  const k = buf.readUInt16LE(p), i = buf.readUInt16LE(p+2), s = buf.readUInt32LE(p+4), t = buf.readUInt32LE(p+8);
  if (k===0&&i===0&&s===0&&t===0) continue;
  if (k === 0x2001) k2001.set(i, (k2001.get(i)||0)+1);
}
const idxs = [...k2001.entries()].sort((a,b)=>a[0]-b[0]);
console.log(`  ${idxs.length} unique kind=0x2001 idx values`);
console.log(`  min=0x${idxs[0][0].toString(16)} max=0x${idxs[idxs.length-1][0].toString(16)}`);
// Show range with their counts
console.log("  Counts (skip ones that appear only once):");
const heavy = idxs.filter(([i,c])=>c>=2);
for (const [i,c] of heavy.slice(0, 30)) console.log(`    idx=0x${i.toString(16).padStart(4,"0")}(${i}): ${c}`);

// === Histogram of "small seq" values — are they all in the 600-650 range
// (turn-counter-ish)?
console.log("\n=== T1 small-seq histogram ===");
const ssHist = new Map();
for (const s of small1) ssHist.set(s, (ssHist.get(s)||0)+1);
const ssArr = [...ssHist.entries()].sort((a,b)=>a[0]-b[0]);
console.log(`  unique small seq values: ${ssArr.length}`);
console.log(`  first 30 small seqs:`);
for (const [s,c] of ssArr.slice(0, 30)) console.log(`    seq=${s}: ${c}`);
