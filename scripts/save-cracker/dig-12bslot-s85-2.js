// dig-12bslot-s85-2.js — session 85 part 2.
// First run revealed:
//   * 47% of slots change between T1 and T2 — runtime state, not log.
//   * Session 57 cookies match as slot TAGS at e.g. slot 2144 (tag=0x7a55780e).
//   * 7-tag dictionary values appear 100+ times outside the 214KB region,
//     all within bytes 0xc2b64..0xd7ce0 (well after 0x44e2 post-fow region)
//     in identical 12-byte record format. So the 214KB slot table and the
//     "post-fow" 12-byte event log share the SAME record schema.
//   * seq is NOT globally monotonic across turns (slot 0 T1 seq=638, T2 seq=633).
//   * Context dumps at outside-gap hits: "01 00 00 01 <u32 cookieA> <u32 tag>
//     <u32 cookieB> ..." — the cookies/tags interleave like (UUID, offset_to_target).
//
// Pivot: are the tags actually FILE OFFSETS (LE u32)? If so we can decode
// every active slot as "kind, idx, seq, tag_offset_in_file" and follow them.
//
// Method:
//  1. Are the 7 dictionary tags valid file offsets? (< filesize)
//  2. For each top tag, dereference: read bytes at that offset. Is there a
//     character record? Faction record? Settlement?
//  3. The seq field — is it an OFFSET into the post-fow table?
//  4. Where exactly do the 7 tag dictionary values point inside the file?

"use strict";
const fs = require("fs");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
const SAVE_T1 = SAVE_DIR + "save_1.2.sav";
const SAVE_T2 = SAVE_DIR + "save_Autosave   Republic of Rome   Turn 2 Start.sav";
const GAP_START = 0x2d4a9;
const GAP_END   = 0x618f8;

const buf = fs.readFileSync(SAVE_T1);
const buf2 = fs.readFileSync(SAVE_T2);
const FS1 = buf.length, FS2 = buf2.length;
console.log(`T1 size=0x${FS1.toString(16)} T2 size=0x${FS2.toString(16)}`);

const TAGS = [0xe5e47935, 0x23e1f461, 0xebee119b, 0x8713173a, 0xd6d62fd1, 0x16bdb00a, 0x4a2b35b3];
console.log("\n=== 1. Are top-7 tags valid file offsets? ===");
for (const t of TAGS) {
  const inT1 = t < FS1;
  const inT2 = t < FS2;
  console.log(`  0x${t.toString(16).padStart(8,"0")} (${t}) inT1=${inT1} inT2=${inT2}`);
}

// They're all huge u32 (e5e47935 ~ 3.86 GB). Not file offsets.
// So tags are HASHES or UUIDs after all. But session 56 said no match against
// ff0aaff0 magic. Re-test the outside hits more carefully: dump 32 bytes.
console.log("\n=== 2. Dump 64B context around each outside-gap tag hit ===");
for (const t of TAGS) {
  const needle = Buffer.alloc(4);
  needle.writeUInt32LE(t, 0);
  let p = GAP_END;
  const hits = [];
  while (p < FS1) {
    const idx = buf.indexOf(needle, p);
    if (idx < 0) break;
    hits.push(idx);
    p = idx + 1;
    if (hits.length >= 2) break;
  }
  // Also pre-gap hits
  p = 0;
  while (p < GAP_START) {
    const idx = buf.indexOf(needle, p);
    if (idx < 0 || idx >= GAP_START) break;
    hits.push(idx);
    p = idx + 1;
    if (hits.length >= 4) break;
  }
  console.log(`\n  TAG 0x${t.toString(16).padStart(8,"0")}:`);
  for (const h of hits) {
    const start = Math.max(0, h - 16);
    const end = Math.min(FS1, h + 24);
    const slice = buf.slice(start, end);
    let asciiBits = "";
    for (const b of slice) {
      asciiBits += (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : ".";
    }
    console.log(`    @ 0x${h.toString(16)}:  ${[...slice].map(b=>b.toString(16).padStart(2,"0")).join(" ")}`);
    console.log(`                   asc: ${asciiBits}`);
  }
}

// ---- 3. Are the tags actually region-id hashes? Check regions_large.json
const regions = require("C:/dev/Provincia/public/regions_large.json");
console.log(`\n=== 3. Region count in mod data: ${regions.length}`);
// Compute djb2 hash, FNV-1a, or look for substring presence
function djb2(s) {
  let h = 5381;
  for (const c of s) h = ((h*33) ^ c.charCodeAt(0)) & 0xffffffff;
  return h >>> 0;
}
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (const c of s) h = Math.imul((h ^ c.charCodeAt(0)) >>> 0, 0x01000193) >>> 0;
  return h >>> 0;
}
const tagSet = new Set(TAGS);
let djb2Hits = 0, fnv1aHits = 0;
const sampleHits = [];
for (const r of regions) {
  const name = r.name || r.region || r.id;
  if (!name) continue;
  const h1 = djb2(String(name));
  const h2 = fnv1a(String(name));
  if (tagSet.has(h1)) { djb2Hits++; sampleHits.push({fn:"djb2", name, h:h1}); }
  if (tagSet.has(h2)) { fnv1aHits++; sampleHits.push({fn:"fnv1a", name, h:h2}); }
}
console.log(`  djb2 region-name hits: ${djb2Hits}`);
console.log(`  fnv1a region-name hits: ${fnv1aHits}`);
for (const h of sampleHits) console.log(`    ${h.fn}: ${h.name} → 0x${h.h.toString(16)}`);

// ---- 4. Faction names from descr_sm_factions.txt
console.log("\n=== 4. Faction-name hashing ===");
const factionsRaw = fs.readFileSync("C:/dev/Provincia/public/descr_sm_factions.txt", "utf-8");
const factionNames = [...factionsRaw.matchAll(/faction\s+([a-z_]+)/g)].map(m=>m[1]);
console.log(`  factions found: ${factionNames.length}`);
let fhits = 0;
for (const fn of factionNames) {
  const h1 = djb2(fn);
  const h2 = fnv1a(fn);
  if (tagSet.has(h1)) { console.log(`    djb2 hit: ${fn} → 0x${h1.toString(16)}`); fhits++; }
  if (tagSet.has(h2)) { console.log(`    fnv1a hit: ${fn} → 0x${h2.toString(16)}`); fhits++; }
}
console.log(`  faction hits: ${fhits}`);

// ---- 5. Is the slot table actually FOG-OF-WAR / VISIBILITY state?
//        Session 57 said cookies cross-ref INTO this table.
//        Now we see the table has kind=0x2001 dense head with idx range
//        0x11d..0x3cf — matches REGION ID range (regions_large has ~200 entries).
//        idx=0x121=289, 0x11d=285, 0x11e=286... linear.
//        kind=0x2001 might be a per-region per-faction visibility flag?
//        Test: do the dense-head idx values cluster around a specific range?

// Count active by region-id range
console.log("\n=== 5. Region-ID range hypothesis ===");
const allIdx = [];
for (let p = GAP_START; p + 12 <= GAP_END; p += 12) {
  const kind = buf.readUInt16LE(p);
  const idx = buf.readUInt16LE(p+2);
  const seq = buf.readUInt32LE(p+4);
  const tag = buf.readUInt32LE(p+8);
  if (kind===0&&idx===0&&seq===0&&tag===0) continue;
  if (kind === 0x2001) allIdx.push(idx);
}
allIdx.sort((a,b)=>a-b);
console.log(`  kind=0x2001 idx: ${allIdx.length} total, min=${allIdx[0]}, max=${allIdx[allIdx.length-1]}`);
console.log(`  range matches region count: max=${allIdx[allIdx.length-1]} vs regions=${regions.length}`);

// What are the unique kind=0x2001 idx values?
const uniqIdx = [...new Set(allIdx)].sort((a,b)=>a-b);
console.log(`  ${uniqIdx.length} unique idx values for kind=0x2001`);
console.log(`  first 20: ${uniqIdx.slice(0,20).map(x=>"0x"+x.toString(16)).join(", ")}`);

// ---- 6. CRITICAL TEST: are these slots paged by region+faction?
//        17,841 slots / 200 regions = 89.2 per region. 17,841 / 22 = 810.
//        17,841 / (200+22) = 80.4. Hmm.
//        Or 17,841 = 3 × 5947. 5947 ≈ characters? Not likely.
//
//        Better hypothesis: this is a FACTION-STANDING / RELATIONSHIP MATRIX.
//        kind=0x2001 = "has trade agreement", kind=0x0004 = "at war".
//        idx = region or settlement ID; tag = source-faction hash.
//
//        Test: in T2 (turn 2 start), faction relations should differ from T1.
//        Active count is similar (4348 → 4261), but 47% of slots CHANGED.
//        That much churn doesn't fit "static treaties" — fits "AI agenda /
//        per-turn decision cache".

// ---- 7. The seq field changed from 638 (T1) to 633 (T2) at slot 0.
//        T1 max seq = 4,287,869,256 (≈ 0xFF94...). That's a u32 close to
//        full range. So most seqs are huge. Mean some are small (638) and
//        some are huge (4 billion). Look at seq distribution.
console.log("\n=== 7. seq field distribution ===");
const seqs = [];
for (let p = GAP_START; p + 12 <= GAP_END; p += 12) {
  const k = buf.readUInt16LE(p), i = buf.readUInt16LE(p+2), s = buf.readUInt32LE(p+4), t = buf.readUInt32LE(p+8);
  if (k===0&&i===0&&s===0&&t===0) continue;
  seqs.push(s);
}
let small = 0, med = 0, large = 0;
for (const s of seqs) {
  if (s < 10000) small++;
  else if (s < 0x10000000) med++;
  else large++;
}
console.log(`  seq < 10K: ${small}`);
console.log(`  seq 10K..256M: ${med}`);
console.log(`  seq >= 256M: ${large} (these look like u32 hashes/uuids)`);

// Confirm: are the "large" seqs actually clustered around specific values?
const largeSeqs = seqs.filter(s => s >= 0x10000000);
const seqHist = new Map();
for (const s of largeSeqs) seqHist.set(s, (seqHist.get(s)||0)+1);
const topSeqs = [...seqHist.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15);
console.log(`  top 15 'large' seqs:`);
for (const [s,c] of topSeqs) console.log(`    0x${s.toString(16).padStart(8,"0")} = ${c}`);

// ---- 8. Re-frame the layout: maybe +4 isn't a u32; maybe +4..+11 is an 8-byte
//        composite. Re-parse as: kind, idx, valA(u16), valB(u16), tag(u32).
console.log("\n=== 8. Re-parse: +4 u16, +6 u16, +8 u32 ===");
const v4hist = new Map(), v6hist = new Map();
for (let p = GAP_START; p + 12 <= GAP_END; p += 12) {
  const k = buf.readUInt16LE(p), i = buf.readUInt16LE(p+2);
  const v4 = buf.readUInt16LE(p+4), v6 = buf.readUInt16LE(p+6);
  const t = buf.readUInt32LE(p+8);
  if (k===0&&i===0&&v4===0&&v6===0&&t===0) continue;
  v4hist.set(v4, (v4hist.get(v4)||0)+1);
  v6hist.set(v6, (v6hist.get(v6)||0)+1);
}
console.log(`  +4 u16: ${v4hist.size} unique`);
console.log(`  top10 +4:`, [...v4hist.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([v,c])=>`0x${v.toString(16)}=${c}`).join(", "));
console.log(`  +6 u16: ${v6hist.size} unique`);
console.log(`  top10 +6:`, [...v6hist.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([v,c])=>`0x${v.toString(16)}=${c}`).join(", "));

// ---- 9. ALSO: the outside-gap hits at 0xc2b64..0xd7ce0 — that's the
//        post-fow region 0x44e2..0x2d15a + ~0x9e000 — wait, that's NOT in the
//        post-fow region; 0xc2b64 > 0x2d15a. Let me check what section that
//        range is in.
console.log(`\n=== 9. What section contains 0xc2b64..0xd7ce0? ===`);
console.log(`  Distance from GAP_END (0x${GAP_END.toString(16)}): 0xc2b64 - 0x${GAP_END.toString(16)} = ${(0xc2b64 - GAP_END).toString(16)}`);
console.log(`  These offsets are AFTER the 214KB slot table.`);
// Dump 32 bytes context at 0xc2b00 to identify section
console.log(`  Bytes at 0xc2b00 (pre):  ${[...buf.slice(0xc2b00, 0xc2b40)].map(b=>b.toString(16).padStart(2,"0")).join(" ")}`);
console.log(`  Bytes at 0xc2b60..0xc2c00:`);
for (let i = 0xc2b60; i < 0xc2c00; i += 16) {
  let ascii = "";
  for (let j = 0; j < 16; j++) {
    const b = buf[i+j];
    ascii += (b>=0x20&&b<0x7f) ? String.fromCharCode(b) : ".";
  }
  console.log(`    0x${i.toString(16)}: ${[...buf.slice(i, i+16)].map(b=>b.toString(16).padStart(2,"0")).join(" ")}  ${ascii}`);
}
