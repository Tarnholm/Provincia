// dig-12bslot-s85-1.js — session 85.
// Goal: pin SEMANTICS of the 12-byte sparse slot table at 0x2d4a9..0x618f8.
//
// Method:
//  A. Turn-to-turn diff: does the 214 KB table grow / change between
//     save_1.2 (turn 1) and "Turn 2 Start"? Same byte range? Same active
//     slot count? Does seq counter advance?
//  B. Cross-reference cookies from session 57's event log (1e5dcf5c,
//     7a55780e, e06cfa4a, 373dfc99, 5613c02e, 54861b72) into the slot
//     table at offsets +0/+2/+4/+8. Per-cookie hit location pins the
//     "subject" namespace.
//  C. The 7-tag dictionary (e5e47935, 23e1f461, ebee119b, 8713173a,
//     d6d62fd1, 16bdb00a, 4a2b35b3) — match against:
//       * faction record offsets (known: ff0aaff0)
//       * region IDs from regions_large.json
//       * settlement UUIDs from character blocks
//  D. Cluster kind=0x2001 vs kind=0x0004 slots: do they form coherent
//     ranges in `idx` space? Compare to faction count (~22) and region
//     count (~200).
//  E. Look in the slot table for any character UUIDs we know (taw self-ptrs,
//     ff0aaff0 magic).

"use strict";
const fs = require("fs");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
const SAVE_T1 = SAVE_DIR + "save_1.2.sav";
const SAVE_T2 = SAVE_DIR + "save_Autosave   Republic of Rome   Turn 2 Start.sav";

const GAP_START = 0x2d4a9;
const GAP_END   = 0x618f8;

function parseSlots(buf) {
  const records = [];
  for (let p = GAP_START; p + 12 <= GAP_END; p += 12) {
    const kind = buf.readUInt16LE(p);
    const idx  = buf.readUInt16LE(p + 2);
    const seq  = buf.readUInt32LE(p + 4);
    const tag  = buf.readUInt32LE(p + 8);
    records.push({ off: p, kind, idx, seq, tag });
  }
  return records;
}
function activeFilter(r) {
  return !(r.kind === 0 && r.idx === 0 && r.seq === 0 && r.tag === 0);
}

function loadOrNull(path) {
  try { return fs.readFileSync(path); } catch (e) { return null; }
}

const bufT1 = loadOrNull(SAVE_T1);
const bufT2 = loadOrNull(SAVE_T2);
console.log(`T1 loaded: ${!!bufT1} (${bufT1?.length || 0} B)`);
console.log(`T2 loaded: ${!!bufT2} (${bufT2?.length || 0} B)`);

if (!bufT1) { console.log("FAIL: T1 not present"); process.exit(1); }

const recT1 = parseSlots(bufT1);
const actT1 = recT1.filter(activeFilter);
console.log(`\n=== T1 slots ===`);
console.log(`  total=${recT1.length} active=${actT1.length} zero=${recT1.length-actT1.length}`);
const seqsT1 = actT1.map(r=>r.seq);
console.log(`  seq min=${Math.min(...seqsT1)} max=${Math.max(...seqsT1)}`);

let recT2 = null, actT2 = null;
if (bufT2) {
  recT2 = parseSlots(bufT2);
  actT2 = recT2.filter(activeFilter);
  console.log(`\n=== T2 slots ===`);
  console.log(`  total=${recT2.length} active=${actT2.length} zero=${recT2.length-actT2.length}`);
  const seqsT2 = actT2.map(r=>r.seq);
  console.log(`  seq min=${Math.min(...seqsT2)} max=${Math.max(...seqsT2)}`);

  // Byte-diff the whole 214KB range
  let byteDiffs = 0;
  for (let i = GAP_START; i < GAP_END; i++) {
    if (bufT1[i] !== bufT2[i]) byteDiffs++;
  }
  console.log(`  byte differences vs T1 in 214KB region: ${byteDiffs}`);

  // Slot-level diff: number of slots that differ at all
  let slotChanged = 0, slotsActivatedInT2 = 0, slotsDeactivatedInT2 = 0;
  for (let i = 0; i < recT1.length; i++) {
    const a = recT1[i], b = recT2[i];
    const eq = (a.kind===b.kind && a.idx===b.idx && a.seq===b.seq && a.tag===b.tag);
    if (!eq) {
      slotChanged++;
      const aZ = !activeFilter(a), bZ = !activeFilter(b);
      if (aZ && !bZ) slotsActivatedInT2++;
      if (!aZ && bZ) slotsDeactivatedInT2++;
    }
  }
  console.log(`  slot-level changes: ${slotChanged}`);
  console.log(`  slots activated (0 → set):   ${slotsActivatedInT2}`);
  console.log(`  slots deactivated (set → 0): ${slotsDeactivatedInT2}`);

  // Dump first 12 changed slots for inspection
  console.log("\n  First 12 changed slots:");
  let shown = 0;
  for (let i = 0; i < recT1.length && shown < 12; i++) {
    const a = recT1[i], b = recT2[i];
    const eq = (a.kind===b.kind && a.idx===b.idx && a.seq===b.seq && a.tag===b.tag);
    if (eq) continue;
    console.log(`    slot ${i.toString().padStart(5)} 0x${a.off.toString(16)}: ` +
      `T1 kind=0x${a.kind.toString(16)} idx=0x${a.idx.toString(16)} seq=${a.seq} tag=0x${a.tag.toString(16).padStart(8,"0")}`);
    console.log(`                                T2 kind=0x${b.kind.toString(16)} idx=0x${b.idx.toString(16)} seq=${b.seq} tag=0x${b.tag.toString(16).padStart(8,"0")}`);
    shown++;
  }
}

// ---- B. Cookie cross-reference: do session 57's cookies appear AS bytes
//        inside specific slots? Where? ----
console.log("\n=== B. Session-57 cookies → slot occurrences ===");
const COOKIES = [
  { name: "C1", v: 0x5ccf5d1e },
  { name: "C2", v: 0x7a55780e },
  { name: "C3", v: 0xe06cfa4a },
  { name: "C4", v: 0x373dfc99 },
  { name: "C5", v: 0x5613c02e },
  { name: "C6", v: 0x54861b72 },
];
for (const c of COOKIES) {
  let asTag = 0, asSeq = 0, asKindIdx = 0;
  const examples = [];
  for (const r of actT1) {
    if (r.tag === c.v) { asTag++; if (examples.length<3) examples.push({kind:"tag", r}); }
    if (r.seq === c.v) { asSeq++; if (examples.length<3) examples.push({kind:"seq", r}); }
    // kind/idx packed: cookie as u32 = idx<<16|kind
    const ki = (r.idx<<16)|r.kind;
    if (ki === c.v) { asKindIdx++; if (examples.length<3) examples.push({kind:"kindidx", r}); }
  }
  console.log(`  ${c.name} 0x${c.v.toString(16).padStart(8,"0")}: as tag=${asTag}, as seq=${asSeq}, as kind|idx=${asKindIdx}`);
  for (const e of examples) {
    const r = e.r;
    console.log(`    ${e.kind} @ 0x${r.off.toString(16)} kind=0x${r.kind.toString(16)} idx=0x${r.idx.toString(16)} seq=${r.seq} tag=0x${r.tag.toString(16).padStart(8,"0")}`);
  }
}

// Also: full file scan of those cookies AS BYTES inside the 214 KB range
// to catch off-stride embeddings.
console.log("\n  Raw byte presence in 214KB range:");
for (const c of COOKIES) {
  const needle = Buffer.alloc(4);
  needle.writeUInt32LE(c.v, 0);
  let cnt = 0;
  let p = GAP_START;
  const positions = [];
  while (p < GAP_END - 4) {
    const idx = bufT1.indexOf(needle, p);
    if (idx < 0 || idx >= GAP_END) break;
    cnt++;
    if (positions.length < 5) {
      const off = idx - GAP_START;
      const slotIdx = Math.floor(off / 12);
      const slotOff = off % 12;
      positions.push(`0x${idx.toString(16)} (slot ${slotIdx}, off+${slotOff})`);
    }
    p = idx + 1;
  }
  console.log(`    ${c.name}: ${cnt} bytewise hits inside 214KB; first 5: ${positions.join(", ")}`);
}

// ---- C. 7-tag dictionary cross-ref against faction magic ff0aaff0 ----
console.log("\n=== C. Tag dictionary cross-reference ===");
const TAGS = [
  0xe5e47935, 0x23e1f461, 0xebee119b, 0x8713173a,
  0xd6d62fd1, 0x16bdb00a, 0x4a2b35b3,
];
for (const t of TAGS) {
  const needle = Buffer.alloc(4);
  needle.writeUInt32LE(t, 0);
  let total = 0;
  let outOfGap = [];
  let p = 0;
  while (p < bufT1.length) {
    const idx = bufT1.indexOf(needle, p);
    if (idx < 0) break;
    total++;
    if (idx < GAP_START || idx >= GAP_END) {
      if (outOfGap.length < 5) outOfGap.push(idx);
    }
    p = idx + 1;
  }
  console.log(`  0x${t.toString(16).padStart(8,"0")}: ${total} hits total; ${outOfGap.length>=5?"5+":outOfGap.length} outside 214KB`);
  for (const o of outOfGap) {
    // Print 24 bytes around for context
    const ctx = bufT1.slice(Math.max(0, o-8), Math.min(bufT1.length, o+16));
    console.log(`    @ 0x${o.toString(16)}  ctx=${[...ctx].map(b=>b.toString(16).padStart(2,"0")).join(" ")}`);
  }
}

// ---- D. Per-kind clustering of idx ----
console.log("\n=== D. idx distribution per kind ===");
const kindToIdxs = new Map();
for (const r of actT1) {
  if (!kindToIdxs.has(r.kind)) kindToIdxs.set(r.kind, []);
  kindToIdxs.get(r.kind).push(r.idx);
}
const topKinds = [...kindToIdxs.entries()].sort((a,b)=>b[1].length-a[1].length).slice(0, 8);
for (const [kind, idxs] of topKinds) {
  const u = new Set(idxs);
  const min = Math.min(...idxs);
  const max = Math.max(...idxs);
  console.log(`  kind=0x${kind.toString(16).padStart(4,"0")}: ${idxs.length} slots, ${u.size} unique idx, range 0x${min.toString(16)}..0x${max.toString(16)}`);
}

// ---- E. Search for known character-UUID magic inside the slot table ----
console.log("\n=== E. Character/faction magic inside 214KB ===");
const FACTION_MAGIC = Buffer.from([0xff, 0x0a, 0xaf, 0xf0]);
let fm = 0, fmFirst = -1;
let p = GAP_START;
while (p < GAP_END - 4) {
  const idx = bufT1.indexOf(FACTION_MAGIC, p);
  if (idx < 0 || idx >= GAP_END) break;
  fm++;
  if (fmFirst < 0) fmFirst = idx;
  p = idx + 4;
}
console.log(`  ff0aaff0 occurrences inside slot table: ${fm} (first=${fmFirst>=0?"0x"+fmFirst.toString(16):"none"})`);

// taw magic
const TAW_MAGIC = Buffer.from([0x74, 0x61, 0x77]);
let tm = 0;
p = GAP_START;
while (p < GAP_END) {
  const idx = bufT1.indexOf(TAW_MAGIC, p);
  if (idx < 0 || idx >= GAP_END) break;
  tm++;
  p = idx + 1;
}
console.log(`  'taw' bytes inside slot table: ${tm}`);

// ---- F. NEW: are the top-7 tags numerically suspicious? Treat each
//        as 2 u16 halves; do those halves match common ranges? ----
console.log("\n=== F. Tag-bit dissection ===");
for (const t of TAGS) {
  const lo = t & 0xffff;
  const hi = (t >>> 16) & 0xffff;
  console.log(`  0x${t.toString(16).padStart(8,"0")}: hi=0x${hi.toString(16).padStart(4,"0")}(${hi}) lo=0x${lo.toString(16).padStart(4,"0")}(${lo})`);
}

// ---- G. The 0x2001 magic: where else does "01 20 00 00" or just
//        bytes "01 20" appear in the file? Sanity: how special is it? ----
console.log("\n=== G. 0x2001 as 4-byte little-endian elsewhere ===");
{
  const needle = Buffer.from([0x01, 0x20, 0x00, 0x00]);
  let cnt = 0, outOfGap = 0;
  let p = 0;
  while (p < bufT1.length) {
    const idx = bufT1.indexOf(needle, p);
    if (idx < 0) break;
    cnt++;
    if (idx < GAP_START || idx >= GAP_END) outOfGap++;
    p = idx + 1;
  }
  console.log(`  '01 20 00 00' total: ${cnt}; outside 214KB: ${outOfGap}`);
}
