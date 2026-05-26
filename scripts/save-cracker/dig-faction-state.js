// dig-faction-state.js — Session 174 (2026-05-21)
//
// Goal: crack the still-unknown bytes of major-faction records.
// Known so far (parseFactionTreasuries / parseFactionDiplomacy):
//   +0   i32  current treasury
//   +8   u32  100  (MAJOR-CLASS tag)
//   +12  u32  1    (version)
//   +24  u32  self_ptr  (= record_pos + 24)
//   +40  u32  self_ptr  (= record_pos + 40)
//   +44  u32  6
//   +48  u32  regionCount
//   +52..+(52+4N)    region IDs
//   +(92 + 4N)       i32  start-of-turn treasury snapshot
//   +(244 + 4N)      u32  0x39240005 diplomacy marker, then count + 16-byte entries
//
// What we want to find:
//   (1) AI personality byte (ai_<archetype> from descr_strat)
//   (2) War-goal / target-region state
//   (3) Per-faction army budget / aggregate cost
//   (4) Treasury history (per-turn snapshots, if any)
//   (5) Faction-level traits/flags
//
// Strategy: cross-reference the descr_strat ai_<name> archetype with the
// record bytes. Group factions by personality, then ask "what bytes are
// constant within a group but vary between groups?".

"use strict";

const fs = require("fs");
const path = require("path");

const SAVE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav";
const DESCR_STRAT = "C:\\RIS\\RIS\\data\\world\\maps\\campaign\\imperial_campaign\\descr_strat.txt";
const PERSONALITY_FILE = "C:\\RIS\\RIS\\data\\feral_descr_ai_personality.txt";

console.log("Reading save:", SAVE);
const buf = fs.readFileSync(SAVE);
console.log("Save size:", buf.length, "bytes\n");

// --- 1. Find all 23 major faction records ---
function findFactionRecords(buf) {
  const out = [];
  for (let i = 0; i + 96 < buf.length; i += 1) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 32) !== 0 || buf.readUInt32LE(i + 36) !== 0) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    const regions = buf.readUInt32LE(i + 48);
    if (regions > 200) continue;
    if (i + 92 + 4 * regions + 4 > buf.length) continue;
    out.push({
      offset: i,
      treasury: buf.readInt32LE(i),
      regionCount: regions,
      turnStart: buf.readInt32LE(i + 92 + 4 * regions),
    });
  }
  return out;
}

const records = findFactionRecords(buf);
console.log("Found " + records.length + " major faction records\n");

// --- 2. Identify each record's owning faction via captain_card_X.tga ---
function identifyOwners(buf, records) {
  const out = [];
  const target = Buffer.from("captain_card_", "ascii");
  const positions = [];
  let p = 0;
  while ((p = buf.indexOf(target, p)) !== -1) {
    let end = p + target.length;
    while (end < p + 80 && buf[end] !== 0x2e && buf[end] >= 0x20 && buf[end] < 0x7f) end++;
    positions.push({ at: p, name: buf.slice(p + target.length, end).toString("ascii") });
    p = end;
  }
  for (let i = 0; i < records.length; i++) {
    const next = i + 1 < records.length ? records[i + 1].offset : buf.length;
    const counts = new Map();
    for (const pos of positions) {
      if (pos.at >= records[i].offset && pos.at < next) {
        counts.set(pos.name, (counts.get(pos.name) || 0) + 1);
      }
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    out.push(sorted.length > 0 ? sorted[0][0] : null);
  }
  return out;
}

const owners = identifyOwners(buf, records);

// --- 3. Parse descr_strat: faction → ai_<archetype> ---
function parseDescrStrat(file) {
  const text = fs.readFileSync(file, "utf8");
  const m = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("faction\t") && !trimmed.startsWith("faction ")) continue;
    const tokens = trimmed.split(/[,\s]+/).filter(Boolean);
    if (tokens.length < 2) continue;
    const fac = tokens[1];
    const ai = tokens.find(t => t.startsWith("ai_"));
    if (ai) m.set(fac, ai);
  }
  return m;
}
const aiByFaction = parseDescrStrat(DESCR_STRAT);

// --- 4. Parse personality file: ai_X → {building, military, diplomatic} ---
function parsePersonality(file) {
  const text = fs.readFileSync(file, "utf8");
  const m = new Map();
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith("personality ")) {
      cur = t.slice("personality ".length).trim();
      m.set(cur, { building: null, military: null, diplomatic: null });
    } else if (cur) {
      const mb = /^building_priority\s+(\S+)/.exec(t);
      const mm = /^military_priority\s+(\S+)/.exec(t);
      const md = /^diplomatic_priority\s+(\S+)/.exec(t);
      if (mb) m.get(cur).building = mb[1];
      if (mm) m.get(cur).military = mm[1];
      if (md) m.get(cur).diplomatic = md[1];
    }
  }
  return m;
}
const persByAi = parsePersonality(PERSONALITY_FILE);

// --- 5. Build enriched faction-record list ---
const enriched = records.map((r, i) => {
  const fac = owners[i];
  const ai = fac ? aiByFaction.get(fac) : null;
  const pers = ai ? persByAi.get(ai) : null;
  return {
    idx: i,
    offset: r.offset,
    nextOffset: i + 1 < records.length ? records[i + 1].offset : null,
    size: i + 1 < records.length ? records[i + 1].offset - r.offset : null,
    treasury: r.treasury,
    turnStart: r.turnStart,
    regionCount: r.regionCount,
    faction: fac,
    ai,
    building: pers ? pers.building : null,
    military: pers ? pers.military : null,
    diplomatic: pers ? pers.diplomatic : null,
  };
});

console.log("=== Major faction records (with ai_archetype) ===");
console.log("idx | offset    | size    | treasury | regs | faction          | ai_archetype       | building   | military          | diplo");
console.log("----+-----------+---------+----------+------+------------------+--------------------+------------+-------------------+---------------");
for (const e of enriched) {
  console.log(
    e.idx.toString().padStart(3) + " | " +
    ("0x" + e.offset.toString(16)).padStart(9) + " | " +
    (e.size === null ? "       ?" : e.size.toString().padStart(8)) + " | " +
    e.treasury.toString().padStart(8) + " | " +
    e.regionCount.toString().padStart(4) + " | " +
    (e.faction || "?").padEnd(16) + " | " +
    (e.ai || "?").padEnd(18) + " | " +
    (e.building || "?").padEnd(10) + " | " +
    (e.military || "?").padEnd(17) + " | " +
    (e.diplomatic || "?")
  );
}

// --- 6. Group by personality components and look for shared byte patterns ---

// For each record compute the offset after the diplo block (end of "known"
// area) and dump some byte windows for inspection.

function endOfDiploBlock(buf, rec) {
  const DIPLO_MARKER = 0x39240005;
  const off = rec.offset + 244 + 4 * rec.regionCount;
  if (off + 8 > buf.length) return null;
  if (buf.readUInt32LE(off) !== DIPLO_MARKER) return null;
  const count = buf.readUInt32LE(off + 4);
  return off + 8 + count * 16;
}

console.log("\n=== Post-diplomacy zone (16 bytes after end of diplo block) ===");
for (const e of enriched) {
  const r = records[e.idx];
  const after = endOfDiploBlock(buf, r);
  if (after === null) { console.log(e.idx, e.faction, "no diplo marker"); continue; }
  const slice = buf.slice(after, Math.min(after + 32, buf.length));
  console.log(
    e.idx.toString().padStart(3) + " " +
    (e.faction || "?").padEnd(16) + " " +
    "ai=" + (e.ai || "?").padEnd(18) + " " +
    "diploEnd=0x" + after.toString(16) + " : " +
    slice.toString("hex").match(/.{1,8}/g).join(" ")
  );
}

// --- 7. Group recs by ai archetype and look for bytes that are SAME within
// group, DIFFERENT across groups. We try every byte offset in the early
// part of each record (0..244) ignoring the offsets we already know.
//
// The "early" region has known fields at +0..+95 + region IDs through +(48 + 4N).
// Then there's +(92+4N)..+243 which is a 152-byte "midblock" before the diplo
// marker. This is the prime candidate zone for AI personality bytes.

function midblock(buf, rec) {
  const start = rec.offset + 92 + 4 * rec.regionCount;
  const end = rec.offset + 244 + 4 * rec.regionCount;
  return buf.slice(start, end);
}

console.log("\n=== Midblock dump (152 bytes: from turnStart treasury to diplo marker) ===");
for (const e of enriched.slice(0, 6)) {
  const r = records[e.idx];
  const mb = midblock(buf, r);
  console.log("\n" + e.faction + " (ai=" + e.ai + ", building=" + e.building + ", mil=" + e.military + "):");
  for (let line = 0; line < mb.length; line += 16) {
    const hex = mb.slice(line, line + 16).toString("hex").match(/.{1,2}/g).join(" ");
    console.log("  +" + line.toString().padStart(3) + ": " + hex);
  }
}

// --- 8. Look for byte/u16/u32 offsets in midblock that group by AI ---
console.log("\n=== Searching midblock for AI-archetype-correlated bytes ===");

const aiGroups = new Map();
for (const e of enriched) {
  if (!e.ai) continue;
  if (!aiGroups.has(e.ai)) aiGroups.set(e.ai, []);
  aiGroups.get(e.ai).push(e);
}
console.log("AI groups: " + [...aiGroups.entries()].map(([a, l]) => a + "=" + l.length).join(", "));

// For each midblock byte offset, compute (byte, u16, u32) values across recs
// then check group-cohesion.
function scoreByteAtOffset(records, enriched, off, width) {
  // Returns {variance_within_group, variance_between_group, distinct_values}
  // For each ai archetype compute the set of values seen at that offset.
  const seenByGroup = new Map();
  const allVals = new Set();
  for (let i = 0; i < records.length; i++) {
    const e = enriched[i];
    if (!e.ai) continue;
    const r = records[i];
    const absOff = r.offset + 92 + 4 * r.regionCount + off;
    if (absOff + width > buf.length) continue;
    let val;
    if (width === 1) val = buf[absOff];
    else if (width === 2) val = buf.readUInt16LE(absOff);
    else val = buf.readUInt32LE(absOff);
    if (!seenByGroup.has(e.ai)) seenByGroup.set(e.ai, new Set());
    seenByGroup.get(e.ai).add(val);
    allVals.add(val);
  }
  // Score: maximize ratio (groups with single value) / total groups
  let singleVal = 0;
  for (const set of seenByGroup.values()) if (set.size === 1) singleVal++;
  return {
    distinctTotal: allVals.size,
    singleVal,
    totalGroups: seenByGroup.size,
    seenByGroup,
  };
}

const MIDBLOCK_SIZE = 152;
const candidates = [];
for (let off = 0; off < MIDBLOCK_SIZE; off++) {
  for (const width of [1, 2, 4]) {
    if (off + width > MIDBLOCK_SIZE) continue;
    const s = scoreByteAtOffset(records, enriched, off, width);
    // We want offsets where:
    //  - distinct values >= 3 (not constant, not binary)
    //  - most groups have a single value (cohesion)
    if (s.distinctTotal >= 3 && s.singleVal >= Math.floor(s.totalGroups * 0.7)) {
      candidates.push({ off, width, ...s });
    }
  }
}

candidates.sort((a, b) => b.singleVal - a.singleVal || b.distinctTotal - a.distinctTotal);
console.log("\nTop midblock offsets with AI-archetype correlation (cohesion >=70%):");
for (const c of candidates.slice(0, 20)) {
  const grpStr = [...c.seenByGroup.entries()].map(([a, s]) => a + "={" + [...s].slice(0, 3).join(",") + "}").join(" | ");
  console.log("  +" + c.off.toString().padStart(3) + " w" + c.width + "  distinct=" + c.distinctTotal + " cohesion=" + c.singleVal + "/" + c.totalGroups);
  console.log("       " + grpStr.slice(0, 220));
}

// --- 9. Also dump 64 bytes BEFORE record start (in case AI bytes precede it) ---
console.log("\n=== Pre-record bytes (64 bytes before each record) ===");
for (const e of enriched.slice(0, 8)) {
  const r = records[e.idx];
  if (r.offset < 64) continue;
  const slice = buf.slice(r.offset - 64, r.offset);
  console.log((e.faction || "?").padEnd(16) + " ai=" + (e.ai || "?").padEnd(18) +
    " : " + slice.toString("hex").match(/.{1,8}/g).join(" "));
}

// --- 10. Look at building_priority cohesion specifically (Comfortable, Trader,
//     Religious, Balanced, Fortified, Craftsman, Bureaucrat) ---

console.log("\n=== Building-priority groups ===");
const bldGroups = new Map();
for (const e of enriched) {
  if (!e.building) continue;
  if (!bldGroups.has(e.building)) bldGroups.set(e.building, []);
  bldGroups.get(e.building).push(e);
}
for (const [b, list] of bldGroups) {
  console.log("  " + b.padEnd(12) + " (" + list.length + "): " + list.map(e => e.faction).join(", "));
}

console.log("\n=== Searching midblock for building-priority correlation ===");
function scoreByField(field, records, enriched, off, width) {
  const seenByGroup = new Map();
  const allVals = new Set();
  for (let i = 0; i < records.length; i++) {
    const e = enriched[i];
    if (!e[field]) continue;
    const r = records[i];
    const absOff = r.offset + 92 + 4 * r.regionCount + off;
    if (absOff + width > buf.length) continue;
    let val;
    if (width === 1) val = buf[absOff];
    else if (width === 2) val = buf.readUInt16LE(absOff);
    else val = buf.readUInt32LE(absOff);
    if (!seenByGroup.has(e[field])) seenByGroup.set(e[field], new Set());
    seenByGroup.get(e[field]).add(val);
    allVals.add(val);
  }
  let singleVal = 0;
  for (const set of seenByGroup.values()) if (set.size === 1) singleVal++;
  return {
    distinctTotal: allVals.size,
    singleVal,
    totalGroups: seenByGroup.size,
    seenByGroup,
  };
}

const bldCandidates = [];
for (let off = 0; off < MIDBLOCK_SIZE; off++) {
  for (const width of [1, 2, 4]) {
    if (off + width > MIDBLOCK_SIZE) continue;
    const s = scoreByField("building", records, enriched, off, width);
    if (s.distinctTotal >= 3 && s.totalGroups >= 3 && s.singleVal >= Math.floor(s.totalGroups * 0.7)) {
      bldCandidates.push({ off, width, ...s });
    }
  }
}
bldCandidates.sort((a, b) => b.singleVal - a.singleVal || b.distinctTotal - a.distinctTotal);
console.log("Top building-priority correlated offsets:");
for (const c of bldCandidates.slice(0, 15)) {
  const grpStr = [...c.seenByGroup.entries()].map(([a, s]) => a + "={" + [...s].slice(0, 3).join(",") + "}").join(" | ");
  console.log("  +" + c.off.toString().padStart(3) + " w" + c.width + "  distinct=" + c.distinctTotal + " cohesion=" + c.singleVal + "/" + c.totalGroups);
  console.log("       " + grpStr.slice(0, 240));
}

// --- 11. Now extend the search to the ENTIRE record (not just midblock) ---
console.log("\n=== Full-record scan for AI correlation (only offsets >=96, skipping known fields) ===");

function recordSize(i) {
  return i + 1 < records.length ? records[i + 1].offset - records[i].offset : 0;
}

// Find minimum record size so we can probe consistent offsets across all records
let minSize = Infinity;
for (let i = 0; i < records.length - 1; i++) {
  const sz = recordSize(i);
  if (sz < minSize) minSize = sz;
}
console.log("Min record size:", minSize);

// We need offsets that, after accounting for variable region count, are
// consistent across records. Let's use "offset from end of diplo block"
// instead — that's a stable anchor.

function recordEnds(buf, records, i) {
  const r = records[i];
  const off = r.offset + 244 + 4 * r.regionCount;
  if (off + 8 > buf.length) return null;
  if (buf.readUInt32LE(off) !== 0x39240005) return null;
  const count = buf.readUInt32LE(off + 4);
  return off + 8 + count * 16;
}

// Look at bytes 0..256 AFTER the diplo block — those are the "third zone"
const TAIL_PROBE = 512;
const tailCandidatesAi = [];
const tailCandidatesBld = [];
for (let off = 0; off < TAIL_PROBE; off += 1) {
  for (const width of [1, 4]) {
    // Build a value-per-record array
    const valByRec = [];
    let ok = true;
    for (let i = 0; i < records.length; i++) {
      const end = recordEnds(buf, records, i);
      if (end === null) { ok = false; break; }
      const absOff = end + off;
      if (absOff + width > buf.length) { ok = false; break; }
      // Also need to stay within this record (don't peek into the next)
      const nextOff = i + 1 < records.length ? records[i + 1].offset : buf.length;
      if (absOff + width > nextOff) { ok = false; break; }
      const val = width === 1 ? buf[absOff] : buf.readUInt32LE(absOff);
      valByRec.push(val);
    }
    if (!ok) continue;

    // Score by AI
    const aiGroupVals = new Map();
    for (let i = 0; i < records.length; i++) {
      const e = enriched[i];
      if (!e.ai) continue;
      if (!aiGroupVals.has(e.ai)) aiGroupVals.set(e.ai, new Set());
      aiGroupVals.get(e.ai).add(valByRec[i]);
    }
    const distinct = new Set(valByRec).size;
    let singleAi = 0;
    for (const s of aiGroupVals.values()) if (s.size === 1) singleAi++;
    if (distinct >= 3 && singleAi >= Math.floor(aiGroupVals.size * 0.7)) {
      tailCandidatesAi.push({ off, width, distinct, singleAi, totalAiGroups: aiGroupVals.size, valByRec });
    }
    // Score by building
    const bldGroupVals = new Map();
    for (let i = 0; i < records.length; i++) {
      const e = enriched[i];
      if (!e.building) continue;
      if (!bldGroupVals.has(e.building)) bldGroupVals.set(e.building, new Set());
      bldGroupVals.get(e.building).add(valByRec[i]);
    }
    let singleBld = 0;
    for (const s of bldGroupVals.values()) if (s.size === 1) singleBld++;
    if (distinct >= 3 && bldGroupVals.size >= 3 && singleBld >= Math.floor(bldGroupVals.size * 0.7)) {
      tailCandidatesBld.push({ off, width, distinct, singleBld, totalBldGroups: bldGroupVals.size, valByRec });
    }
  }
}

console.log("\nTail offsets correlated with AI archetype:");
tailCandidatesAi.sort((a, b) => b.singleAi - a.singleAi || b.distinct - a.distinct);
for (const c of tailCandidatesAi.slice(0, 15)) {
  console.log("  diplo+" + c.off.toString().padStart(4) + " w" + c.width + " distinct=" + c.distinct + " cohesion=" + c.singleAi + "/" + c.totalAiGroups);
  console.log("       vals: " + c.valByRec.slice(0, 23).map(v => v.toString(16)).join(","));
}
console.log("\nTail offsets correlated with building-priority:");
tailCandidatesBld.sort((a, b) => b.singleBld - a.singleBld || b.distinct - a.distinct);
for (const c of tailCandidatesBld.slice(0, 15)) {
  console.log("  diplo+" + c.off.toString().padStart(4) + " w" + c.width + " distinct=" + c.distinct + " cohesion=" + c.singleBld + "/" + c.totalBldGroups);
  console.log("       vals: " + c.valByRec.slice(0, 23).map(v => v.toString(16)).join(","));
}

// --- 12. Show 16-byte dump of zone right after diplo block, all 23 records ---
console.log("\n=== Diplo-end + first 96 bytes (all 23 records) ===");
for (const e of enriched) {
  const r = records[e.idx];
  const end = recordEnds(buf, records, e.idx);
  if (end === null) continue;
  const slice = buf.slice(end, Math.min(end + 96, buf.length));
  console.log((e.faction || "?").padEnd(16) + " ai=" + (e.ai || "?").padEnd(18) +
    " bld=" + (e.building || "?").padEnd(11) +
    " mil=" + (e.military || "?").padEnd(18) +
    " : " + slice.toString("hex").match(/.{1,8}/g).join(" "));
}

// --- 12b. Crack the faction ID byte at midblock+99 ---
console.log("\n=== Faction ID byte at midblock+99 (resolved via descr_sm_factions) ===");

// Build descr_sm_factions index map
function parseSmFactions(file) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const factions = [];
  for (const line of lines) {
    const m = /^\t"([a-z_0-9]+)":/.exec(line);
    if (m) factions.push(m[1]);
  }
  return factions;
}
const smFactions = parseSmFactions("C:\\RIS\\RIS\\data\\descr_sm_factions.txt");
console.log("descr_sm_factions count:", smFactions.length, "first 10:", smFactions.slice(0, 10).join(","));

// Now read +99 byte from each record's midblock
console.log("\nReconciliation: captain-banner vs midblock+99 byte vs descr_sm_factions[byte]");
for (let i = 0; i < records.length; i++) {
  const r = records[i];
  const midOff = r.offset + 92 + 4 * r.regionCount + 99;
  const factionByte = buf[midOff];
  const factionByteU32 = buf.readUInt32LE(r.offset + 92 + 4 * r.regionCount + 96);
  const smName = smFactions[factionByte] || "out-of-range";
  console.log(
    "rec " + i.toString().padStart(2) +
    " regs=" + r.regionCount.toString().padStart(3) +
    " treasury=" + r.treasury.toString().padStart(6) +
    " | byte+99=" + factionByte.toString().padStart(3) + " → " + smName.padEnd(18) +
    " | u32+96=0x" + factionByteU32.toString(16).padStart(8, "0") +
    " | captain-banner=" + (owners[i] || "?")
  );
}

// --- 13. Identify and dump first 384 bytes per record using the BYTE+99 faction_id ---
console.log("\n=== Faction-id-resolved record headers (descr_sm_factions) ===");

// Re-classify by byte+99
const aiBySm = new Map(); // sm-name → ai_<archetype>
for (const [fac, ai] of aiByFaction) aiBySm.set(fac, ai);

const reclassed = records.map((r, i) => {
  const byte = buf[r.offset + 92 + 4 * r.regionCount + 99];
  const factionName = smFactions[byte];
  const ai = aiBySm.get(factionName);
  const pers = ai ? persByAi.get(ai) : null;
  return {
    idx: i,
    offset: r.offset,
    size: i + 1 < records.length ? records[i + 1].offset - r.offset : null,
    treasury: r.treasury,
    turnStart: r.turnStart,
    regionCount: r.regionCount,
    factionId: byte,
    faction: factionName,
    ai,
    building: pers ? pers.building : null,
    military: pers ? pers.military : null,
    diplomatic: pers ? pers.diplomatic : null,
  };
});

console.log("idx | offset    | factionId | faction          | ai_archetype       | building   | military          | diplo");
console.log("----+-----------+-----------+------------------+--------------------+------------+-------------------+---------------");
for (const e of reclassed) {
  console.log(
    e.idx.toString().padStart(3) + " | " +
    ("0x" + e.offset.toString(16)).padStart(9) + " | " +
    e.factionId.toString().padStart(9) + " | " +
    (e.faction || "?").padEnd(16) + " | " +
    (e.ai || "?").padEnd(18) + " | " +
    (e.building || "?").padEnd(10) + " | " +
    (e.military || "?").padEnd(17) + " | " +
    (e.diplomatic || "?")
  );
}

// --- 14. Now look for AI archetype byte using the RECLASSED faction names ---
// Two records may share the same AI archetype now (rome=ai_rome, but no
// rebels). Let's group by ai and look for shared bytes.

console.log("\n=== AI-archetype-correlated bytes using RESOLVED faction names ===");
const aiGroupsR = new Map();
for (const e of reclassed) {
  if (!e.ai) continue;
  if (!aiGroupsR.has(e.ai)) aiGroupsR.set(e.ai, []);
  aiGroupsR.get(e.ai).push(e);
}
for (const [ai, list] of aiGroupsR) {
  console.log("  " + ai + " (" + list.length + "): " + list.map(e => e.faction).join(", "));
}

// Look for offsets where same-archetype records share the same value
function scoreOffsetGrouped(records, reclassed, off, width, field) {
  const seenByGroup = new Map();
  const allVals = new Set();
  for (let i = 0; i < records.length; i++) {
    const e = reclassed[i];
    if (!e[field]) continue;
    const r = records[i];
    const absOff = r.offset + 92 + 4 * r.regionCount + off;
    if (absOff + width > buf.length) continue;
    let val;
    if (width === 1) val = buf[absOff];
    else if (width === 2) val = buf.readUInt16LE(absOff);
    else val = buf.readUInt32LE(absOff);
    if (!seenByGroup.has(e[field])) seenByGroup.set(e[field], new Set());
    seenByGroup.get(e[field]).add(val);
    allVals.add(val);
  }
  let singleVal = 0;
  for (const set of seenByGroup.values()) if (set.size === 1) singleVal++;
  return {
    distinctTotal: allVals.size,
    singleVal,
    totalGroups: seenByGroup.size,
    seenByGroup,
  };
}

// Probe a much larger range: 0 to 500 bytes into midblock
for (const [groupName, fieldName] of [["AI archetype", "ai"], ["Building priority", "building"], ["Military priority", "military"]]) {
  console.log("\n  Top " + groupName + " correlations (midblock):");
  const cs = [];
  for (let off = 0; off < 300; off++) {
    for (const w of [1, 4]) {
      const s = scoreOffsetGrouped(records, reclassed, off, w, fieldName);
      if (s.totalGroups >= 3 && s.distinctTotal >= 2 && s.singleVal >= Math.floor(s.totalGroups * 0.7)) {
        cs.push({ off, width: w, ...s });
      }
    }
  }
  cs.sort((a, b) => b.singleVal - a.singleVal || b.distinctTotal - a.distinctTotal);
  for (const c of cs.slice(0, 8)) {
    const grpStr = [...c.seenByGroup.entries()].map(([a, s]) => a + "={" + [...s].slice(0, 2).join(",") + "}").join(" | ");
    console.log("    +" + c.off.toString().padStart(3) + " w" + c.width + " distinct=" + c.distinctTotal + " cohesion=" + c.singleVal + "/" + c.totalGroups);
    console.log("         " + grpStr.slice(0, 220));
  }
}

// --- 15. Treasury history search: look for arrays of i32s near treasury fields ---
console.log("\n=== Treasury history search: scan +96..+200 of midblock for income-history candidates ===");
for (const e of reclassed.slice(0, 4)) {
  const r = records[e.idx];
  const mid = r.offset + 92 + 4 * r.regionCount;
  // Dump as i32s
  console.log("\n" + e.faction + " (treasury=" + e.treasury + "):");
  for (let off = 96; off < 240; off += 4) {
    if (mid + off + 4 > buf.length) break;
    const val = buf.readInt32LE(mid + off);
    const u32 = buf.readUInt32LE(mid + off);
    if (val !== 0) console.log("  +" + off.toString().padStart(3) + ": i32=" + val + " u32=0x" + u32.toString(16));
  }
}

// --- 16. Walk record tail (everything after diplo block) for the player record ---
// to look for army budget / faction flags / treasury history blocks
console.log("\n=== Player record (romans_julii) tail walk — first 1024 bytes after diplo block ===");
// Player = byte+99 == 0 (romans_julii) in this save, but actual player is Macedon
// (antigonid). Antigonid byte = 5 in descr_sm_factions. We saw NO record with byte=5.
// So antigonid is NOT among the 23 records! Player record lives elsewhere.
// Let me dump romans_julii (rec idx 1) tail anyway since it's a major AI faction.
const playerRec = reclassed.find(e => e.faction === "romans_julii");
if (playerRec) {
  const r = records[playerRec.idx];
  const end = recordEnds(buf, records, playerRec.idx);
  if (end) {
    const nextRec = playerRec.idx + 1 < records.length ? records[playerRec.idx + 1].offset : buf.length;
    const tailSize = Math.min(1024, nextRec - end);
    console.log("Diplo block ends at 0x" + end.toString(16) + ", record ends at 0x" + nextRec.toString(16) + ", tailSize=" + (nextRec - end));
    for (let line = 0; line < tailSize; line += 16) {
      const slice = buf.slice(end + line, end + line + 16);
      const hex = slice.toString("hex").match(/.{1,2}/g).join(" ");
      const ascii = [...slice].map(b => b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".").join("");
      console.log("  +" + line.toString(16).padStart(4, "0") + ": " + hex + "  " + ascii);
    }
  }
}

// --- 16b. Verify personality-index crack across all records ---
console.log("\n=== Personality-index byte at midblock+135 — full verification ===");
function parsePersonalityList(file) {
  const text = fs.readFileSync(file, "utf8");
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^personality\s+(\S+)/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}
const personalityList = parsePersonalityList(PERSONALITY_FILE);
console.log("Total personalities in feral_descr_ai_personality.txt:", personalityList.length);
let allMatch = true;
for (const e of reclassed) {
  const r = records[e.idx];
  const persByte = buf[r.offset + 92 + 4 * r.regionCount + 135];
  const persName = personalityList[persByte];
  const expected = e.ai;
  const ok = persName === expected;
  if (!ok) allMatch = false;
  console.log(
    "rec" + e.idx.toString().padStart(2) +
    " " + (e.faction || "?").padEnd(16) +
    " expected=" + (expected || "?").padEnd(18) +
    " byte+135=" + persByte.toString().padStart(3) +
    " resolved=" + (persName || "?").padEnd(18) +
    " " + (ok ? "OK" : "MISMATCH")
  );
}
console.log("\nAll match:", allMatch);

// --- 16c. Look for THE PLAYER FACTION record (Macedon = antigonid). The 23
// major-faction records don't include the player. Per project memory, the
// player's char roster + AI/diplo zone lives BEFORE the major-faction records.
// Look for a faction signature that uses byte+99 == 5 (antigonid in
// descr_sm_factions).
console.log("\n=== Search for player record (any matching signature with faction_id=5 antigonid) ===");
// Scan whole buffer for the +44=6, +24=self_ptr signature like parseFactionTreasuries
// but allow value 8 at +44 too (per memory project_faction_treasury_index_caveat: +44=8 for minors)
const allMatches = [];
for (let i = 0; i + 200 < buf.length; i += 1) {
  if (buf.readUInt32LE(i + 24) !== i + 24) continue;
  if (buf.readUInt32LE(i + 40) !== i + 40) continue;
  const class_ = buf.readUInt32LE(i + 8);
  const ver = buf.readUInt32LE(i + 12);
  const nextSize = buf.readUInt32LE(i + 44);
  if (ver !== 1) continue;
  if (class_ !== 100 && class_ !== 50 && class_ !== 60 && class_ !== 70 && class_ !== 80 && class_ !== 90) continue;
  const regions = buf.readUInt32LE(i + 48);
  if (regions > 200) continue;
  allMatches.push({ offset: i, class_, regions, nextSize, treasury: buf.readInt32LE(i) });
  if (allMatches.length > 50) break;
}
console.log("Scanned record matches:", allMatches.length);
console.log("Classes found:", [...new Set(allMatches.map(m => m.class_))].join(","));
const class100 = allMatches.filter(m => m.class_ === 100).length;
console.log("Class-100 (major) found:", class100, "(should be 23 + 1 player = 24?)");
// Show first few non-class-100 matches
for (const m of allMatches.slice(0, 30)) {
  console.log("  0x" + m.offset.toString(16) + " class=" + m.class_ + " regs=" + m.regions + " nextSize=" + m.nextSize + " treasury=" + m.treasury);
}

// --- 16d. Look in the body BEFORE the first major record for an antigonid record.
// Per memory project_player_faction_record.md, player record sits before NPCs.
// Search for byte=5 (antigonid faction_id) followed by the structural pattern,
// or just look for an isolated 0x05 surrounded by treasury-like context.
console.log("\n=== Searching pre-major-records body for antigonid (faction_id=5) ===");
const firstMajor = records[0].offset;
let foundCount = 0;
for (let i = 0x3000; i + 250 < firstMajor; i += 4) {
  // Look for the (faction_id=5) signature at +96 of midblock — but we don't
  // know where midblock is. Look for the +44=6 pattern with byte=5.
  if (buf.readUInt32LE(i + 24) !== i + 24) continue;
  if (buf.readUInt32LE(i + 40) !== i + 40) continue;
  if (buf.readUInt32LE(i + 8) !== 100) continue;
  if (buf.readUInt32LE(i + 12) !== 1) continue;
  if (buf.readUInt32LE(i + 44) !== 6) continue;
  const regions = buf.readUInt32LE(i + 48);
  if (regions > 200) continue;
  const midOff = i + 92 + 4 * regions;
  if (midOff + 200 > buf.length) continue;
  const factionId = buf.readUInt32LE(midOff + 96);
  console.log("  PRE-MAJOR class-100 record @0x" + i.toString(16) + " regs=" + regions + " faction_id=" + factionId + " (" + (smFactions[factionId] || "?") + ") treasury=" + buf.readInt32LE(i));
  foundCount++;
  if (foundCount > 5) break;
}
console.log("Pre-major class-100 records found:", foundCount);

// Search the WHOLE file for faction_id=5 pattern at any "midblock+96" location
// by looking for the diplo marker `05 00 24 39` and back-walking.
console.log("\n=== Search whole file for diplo-marker records (faction_id = ?) ===");
const DIPLO_MARKER_BYTES = Buffer.from([0x05, 0x00, 0x24, 0x39]);
let p = 0;
const diploLocs = [];
while ((p = buf.indexOf(DIPLO_MARKER_BYTES, p)) !== -1) {
  diploLocs.push(p);
  p += 4;
}
console.log("Diplo marker locations:", diploLocs.length);

// For each diplo marker, the faction_id is at marker-56 (because diplo marker
// sits at record+244+4N, faction_id u32 sits at record+184+4N = midblock+96).
// 244 - 184 = 60 bytes back? Or +96 from midblock, midblock starts at +92+4N,
// so faction_id u32 is at record+188+4N. Diplo marker at record+244+4N.
// So faction_id is 244-188=56 bytes before diplo marker.
const factionIdsAtDiplo = new Map();
for (const loc of diploLocs) {
  if (loc < 56) continue;
  const factionId = buf.readUInt32LE(loc - 56);
  // Sanity check this looks like a faction_id (< 256)
  if (factionId > 250) continue;
  const persByte = buf.readUInt8(loc - 17);  // +135 of midblock = +244-152 from marker = -152+135 = -17? Let me recompute.
  // midblock+135 - midblock+152 = -17 from diplo marker
  factionIdsAtDiplo.set(loc, { factionId, persByte });
}
console.log("Valid faction_ids found via diplo markers:");
const factionCounts = new Map();
for (const { factionId } of factionIdsAtDiplo.values()) {
  factionCounts.set(factionId, (factionCounts.get(factionId) || 0) + 1);
}
const sorted = [...factionCounts.entries()].sort((a, b) => b[1] - a[1]);
for (const [fid, n] of sorted.slice(0, 30)) {
  console.log("  faction_id " + fid + " (" + (smFactions[fid] || "?") + "): " + n + " occurrences");
}

// Look for antigonid specifically (id 5)
const antigonidDiplos = [...factionIdsAtDiplo.entries()].filter(([, v]) => v.factionId === 5);
console.log("\nAntigonid (id=5) diplo-marker hits:");
for (const [loc, v] of antigonidDiplos.slice(0, 5)) {
  const recStart = loc - 244;  // assumes 0 regions; with regions, will be more negative
  // Actually we need to back-walk by 244 + 4N. Without knowing N, scan back.
  console.log("  diplo marker @0x" + loc.toString(16) + " factionId=" + v.factionId + " persByte=" + v.persByte + " (" + (personalityList[v.persByte] || "?") + ")");
}

// --- 17. Check the post-diplo first 24 bytes carefully. Pattern:
//   +0  u32 0x000000ef
//   +4  u32 0x000000ef
//   +8  u32 self_ptr (=end+8)
//   +12 u32 0x0000001e
//   +16-+39  zeros
//   +40  small u32 (varies)
//   +44  small u32 (varies, 0-150ish)
//   +48..+63 u64? then UUID? then 12 bytes data?
console.log("\n=== Post-diplo first 80 bytes analysis ===");
for (const e of reclassed) {
  const end = recordEnds(buf, records, e.idx);
  if (end === null) continue;
  // Read structured
  const f0 = buf.readUInt32LE(end);
  const f4 = buf.readUInt32LE(end + 4);
  const f8 = buf.readUInt32LE(end + 8);
  const f12 = buf.readUInt32LE(end + 12);
  const f40 = buf.readUInt32LE(end + 40);
  const f44 = buf.readUInt32LE(end + 44);
  const f48ptr = buf.readUInt32LE(end + 48);
  const f52 = buf.readUInt32LE(end + 52);
  const f64 = buf.readUInt32LE(end + 64);
  const f72 = buf.readUInt32LE(end + 72);
  console.log(
    "rec" + e.idx.toString().padStart(2) + " " + (e.faction || "?").padEnd(15) +
    " bld=" + (e.building || "?").padEnd(11) +
    " | +40=" + f40.toString().padStart(4) + " +44=" + f44.toString().padStart(4) +
    " +48=0x" + f48ptr.toString(16) + " +64=" + f64.toString().padStart(5) +
    " +72=0x" + f72.toString(16)
  );
}
