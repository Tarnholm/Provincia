// dig-gap214-3.js — pin down the 12-byte record semantics.
//
// Layout pinned so far:
//   * Gap spans 0x2d4a9..0x618f8 = 214,095 bytes.
//   * Stride 12 bytes; that divides evenly enough into ~17,841 slots.
//   * First ~4 KB is dense (38% nz), then drops to ~5% nz for the rest.
//     Looks like an event log where active turns are dense and idle slots are zero.
//   * Per-slot layout from inspection:
//     +0  u16 (high-bit set values like 0x2001 dominate, sometimes 0x0004) — flag/kind
//     +2  u16 — small id (looks like a record/character index, range 0x011d..0x03cf)
//     +4  u32 — monotonic sequence counter (638, 639, 640, ... increasing slowly)
//     +8  u32 — "tag" / source UUID-ish (recurring small set: e5e47935, 23e1f461,
//               ebee119b, 8713173a, d6d62fd1, 16bdb00a, 4a2b35b3, 0)
//
//   * Sequence numbers start at 638, end somewhere. 0 in the sequence field
//     marks unused slots (~94% of the table). That's the "sparse" character.
//
// Best fit: ROME's per-turn diplomacy/event log — a fixed-size circular buffer of
// turn-stamped events from various agents (the 8 tags). Or a "message log" /
// "history" buffer where each character/faction logs turn events. The recurring
// tags being so few (8) is consistent with these being faction or system origin ids.
//
// Goal here:
//   1. Verify monotonicity of the sequence counter across the whole gap.
//   2. Find the maximum sequence value (should correlate with current turn or
//      total message count).
//   3. Profile the "kind" (u16 +0) values.
//   4. Look for character UUID magic anywhere — are these tags character UUIDs?
//   5. Try to cross-reference tag 0xebee119b etc to other parts of the file.

"use strict";

const fs = require("fs");
const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const GAP_START = 0x2d4a9;
const GAP_END   = 0x618f8;
const buf = fs.readFileSync(SAVE);

// ---- Parse all 12-byte records, ignore zero rows ----
const records = [];
for (let p = GAP_START; p + 12 <= GAP_END; p += 12) {
  const kind = buf.readUInt16LE(p);
  const idx  = buf.readUInt16LE(p + 2);
  const seq  = buf.readUInt32LE(p + 4);
  const tag  = buf.readUInt32LE(p + 8);
  records.push({ off: p, kind, idx, seq, tag });
}
const active = records.filter(r => !(r.kind === 0 && r.idx === 0 && r.seq === 0 && r.tag === 0));
console.log(`total 12-byte slots: ${records.length}`);
console.log(`non-zero records:    ${active.length}`);
console.log(`zero slots:          ${records.length - active.length}`);

// ---- Sequence statistics ----
const seqs = active.map(r => r.seq);
const minSeq = Math.min(...seqs);
const maxSeq = Math.max(...seqs);
console.log(`\nseq min=${minSeq} max=${maxSeq} (range ${maxSeq - minSeq})`);

// Monotonicity test: are records sorted by seq?
let increasing = 0, decreasing = 0, equal = 0;
for (let i = 1; i < active.length; i++) {
  if (active[i].seq > active[i-1].seq) increasing++;
  else if (active[i].seq < active[i-1].seq) decreasing++;
  else equal++;
}
console.log(`monotonic check across non-zero records:`);
console.log(`  increasing: ${increasing}  decreasing: ${decreasing}  equal: ${equal}`);

// ---- Histograms ----
function histogram(items, label, topN = 20) {
  const m = new Map();
  for (const v of items) m.set(v, (m.get(v) || 0) + 1);
  const arr = [...m.entries()].sort((a,b)=>b[1]-a[1]);
  console.log(`\n${label} — ${m.size} unique, top ${topN}:`);
  for (const [v, c] of arr.slice(0, topN)) {
    console.log(`  ${typeof v === "number" ? "0x"+v.toString(16).padStart(8,"0") : v}  ${c}`);
  }
  return arr;
}
histogram(active.map(r => r.kind), "kind (u16 +0)", 20);
histogram(active.map(r => r.idx),  "idx (u16 +2)",  20);
const tagArr = histogram(active.map(r => r.tag),  "tag (u32 +8)", 20);

// ---- Are tags character UUIDs? Search the save for tag bytes preceded by 'ff 0a af f0' ----
console.log("\n=== Are top tags character UUIDs? ===");
const FACTION_MAGIC = Buffer.from([0xff, 0x0a, 0xaf, 0xf0]);
for (const [tag, cnt] of tagArr.slice(0, 8)) {
  if (tag === 0) continue;
  const tagBuf = Buffer.alloc(4); tagBuf.writeUInt32LE(tag, 0);
  // Look for "tag" occurrences within ~16 bytes after a faction magic
  let asUuid = 0;
  let p = 0;
  while (p < buf.length - 24) {
    const fm = buf.indexOf(FACTION_MAGIC, p);
    if (fm < 0) break;
    // scan 32 bytes after the faction magic for the tag bytes
    const window = buf.slice(fm, fm + 64);
    if (window.indexOf(tagBuf) >= 0) asUuid++;
    p = fm + 4;
  }
  console.log(`  tag 0x${tag.toString(16).padStart(8,"0")}: appears within 64B of ff0aaff0 in ${asUuid} cases (gap count=${cnt})`);
}

// ---- Where does the sequence counter wrap or reset? ----
// Hexdump the first 32 records and the last 16 active records.
console.log("\n=== First 32 active records ===");
for (let i = 0; i < Math.min(32, active.length); i++) {
  const r = active[i];
  console.log(`  0x${r.off.toString(16)}  kind=0x${r.kind.toString(16).padStart(4,"0")}  idx=0x${r.idx.toString(16).padStart(4,"0")}  seq=${r.seq.toString().padStart(6)}  tag=0x${r.tag.toString(16).padStart(8,"0")}`);
}
console.log("\n=== Last 16 active records ===");
for (let i = Math.max(0, active.length - 16); i < active.length; i++) {
  const r = active[i];
  console.log(`  0x${r.off.toString(16)}  kind=0x${r.kind.toString(16).padStart(4,"0")}  idx=0x${r.idx.toString(16).padStart(4,"0")}  seq=${r.seq.toString().padStart(6)}  tag=0x${r.tag.toString(16).padStart(8,"0")}`);
}

// ---- Distribution of seq values: is it linear or clumpy? ----
const seqBuckets = new Map();
for (const r of active) {
  const b = Math.floor(r.seq / 50) * 50;
  seqBuckets.set(b, (seqBuckets.get(b) || 0) + 1);
}
const seqKeys = [...seqBuckets.keys()].sort((a,b)=>a-b);
console.log(`\n=== Records per seq bucket (50-wide), first 30 buckets ===`);
for (const k of seqKeys.slice(0, 30)) {
  console.log(`  seq ${k.toString().padStart(5)}..${(k+49).toString().padStart(5)}: ${seqBuckets.get(k)}`);
}
console.log(`...total buckets: ${seqKeys.length}`);
console.log(`last bucket: seq ${seqKeys[seqKeys.length-1]} has ${seqBuckets.get(seqKeys[seqKeys.length-1])} records`);

// ---- Check: do records appear in file order matching seq order? (sorted table) ----
// We already counted decreasing == 0 above which proves yes — confirm explicitly.
console.log(`\nfile-order matches seq-order: ${decreasing === 0 ? "YES (sorted ascending by seq)" : "NO"}`);

// ---- Are zero slots interspersed or grouped? ----
let zeroGroups = 0;
let zeroBytes = 0;
let inZero = false;
let curZ = 0;
const zeroGroupSizes = [];
for (const r of records) {
  const isZero = (r.kind === 0 && r.idx === 0 && r.seq === 0 && r.tag === 0);
  if (isZero) {
    if (!inZero) { inZero = true; curZ = 1; zeroGroups++; }
    else curZ++;
  } else {
    if (inZero) zeroGroupSizes.push(curZ);
    inZero = false;
  }
}
if (inZero) zeroGroupSizes.push(curZ);
zeroGroupSizes.sort((a,b)=>b-a);
console.log(`\n=== Zero-slot grouping ===`);
console.log(`  groups: ${zeroGroups}  total zero slots: ${records.length - active.length}`);
console.log(`  biggest zero runs (in slots): ${zeroGroupSizes.slice(0, 10).join(", ")}`);
console.log(`  total tail zeros if last group: ${zeroGroupSizes[0]} slots = ${zeroGroupSizes[0]*12} bytes`);

// ---- Total active region: from first active record to last active record ----
const firstActive = active[0].off;
const lastActive  = active[active.length-1].off + 12;
console.log(`\n=== Active range ===`);
console.log(`  first record: 0x${firstActive.toString(16)}`);
console.log(`  last record:  0x${lastActive.toString(16)}`);
console.log(`  active span:  ${lastActive - firstActive} bytes`);
console.log(`  pre-tail unused bytes inside gap: ${GAP_END - lastActive}`);
