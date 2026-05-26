// dig-soldier-stats-deep.js — Decode the 9-byte per-soldier record.
//
// FINDING 2026-05-21 (this script's first run): the previous memo
// `reference_soldier_weapon_byte.md` claimed weapon_lvl was at byte +0
// of the 9-byte soldier record. Cross-verification against the Arretium
// retrain pair (save_arretium pre retrained..sav → save_arretium
// retrained turn 2.sav) using inst[5] of the hastati instances (the only
// pair where PRE ≠ POST) shows weapon_lvl is actually at byte **+7**,
// not +0. Layout (validated for hastati at +146 from name):
//
//   +0..+2 : 00 padding
//   +3     : per-turn dynamic state (7 distinct values 0..6, redistributes
//            between turns — likely MORALE or per-turn KILLS counter)
//   +4     : per-soldier UUID byte (≈90+ distinct values across 122
//            soldiers — preserved across turns for same soldier)
//   +5     : EXPERIENCE / CHEVRONS (4 values: 0x04,0x05,0x06,0x07
//            = base 4 + chevrons 0..3)
//   +6     : HP/class marker (0x30 for hastati/triarii/rorarii — likely
//            varies per unit type; needs more samples to confirm)
//   +7     : WEAPON_LVL × 4 (the byte that flipped 0x00→0x04 across all
//            122 soldiers of inst[5] after smith retrain)
//   +8     : 00 padding (sometimes 0x01 on selected units)
//
// The "byte +0" claim in the original memo appears to be based on a
// different alignment / different unit's header offset. Soldier array
// starts ≈146 bytes past name pstr16 (`<u16 len+1><ascii><NUL>`) for
// roman hastati early.
//
// Strategy:
//   1. Pick a few candidate saves (retrained turn-2 = mix of vets+recruits;
//      armour-upgraded next-turn = potential armour-byte variation;
//      t7 = experienced units with non-zero stats).
//   2. For each candidate, locate a "roman hastati early" unit's name
//      pstr16 in the save body.
//   3. Read the soldier array (stride 9, count from the unit's header).
//   4. For each of the 9 byte positions, compute the value histogram across
//      all soldiers of the unit. Mark each byte:
//        - CONSTANT  (only one distinct value across all soldiers)
//        - LOW-ENTROPY (2-4 distinct values, suggests a per-soldier stat
//          with small scale like 0-15)
//        - HIGH-ENTROPY (>16 distinct values, likely UUID / position)
//   5. Cross-save comparison: if a position is CONSTANT in one save and
//      different (but still CONSTANT) in another, that's a unit-level
//      stat that simply doesn't vary inside a unit (e.g. armor).
//
// Output: per-save / per-unit byte-position classification.

const fs = require("fs");
const path = require("path");

const SAVES = [
  "save_macedon t0.sav",
  "save_arretium retrained turn 2.sav",
  "save_arretium turn 4.sav",
  "save_next turn, armour upgraded..sav",
  "save_t7.sav",
];

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

// Candidate unit type names (ASCII, NUL-terminated style — engine writes
// them as pstr16 with u16 length prefix).
const UNIT_TYPES = [
  "roman hastati early",
  "roman principes early",
  "roman triarii early",
  "roman equites early",
  "roman leves",
  "roman rorarii",
  "macedonian phalanx",
  "macedonian peltast",
  "macedonian cavalry",
];

// ─────────────────────────────────────────────────────────────────────────
// Helper: find unit instances by name (pstr16-style)
// ─────────────────────────────────────────────────────────────────────────
function findUnitInstances(buf, name) {
  // ASCII name; the engine writes it as <u16 length><ascii bytes><NUL>.
  // Length prefix counts name.length + 1 (the NUL).
  const ascii = Buffer.from(name + "\0", "ascii");
  const lenPrefix = Buffer.alloc(2);
  lenPrefix.writeUInt16LE(name.length + 1, 0);
  const needle = Buffer.concat([lenPrefix, ascii]);
  const out = [];
  let p = 0;
  while ((p = buf.indexOf(needle, p)) !== -1) {
    out.push(p);
    p++;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Helper: locate the 9-byte soldier array starting position.
// Memo says: for roman hastati early (122 soldiers) the array starts at
// name + 146. For other units offsets differ, so we SEARCH for the stride-9
// signature: a run of byte positions where every 9th byte takes values
// from {0x00, 0x04, 0x08, 0x0c} (weapon levels).
// ─────────────────────────────────────────────────────────────────────────
function locateSoldierArray(buf, unitNameOff, nameLen) {
  // Search window: 50..400 bytes past the name end.
  const startSearch = unitNameOff + 3 + nameLen + 50;
  const endSearch = Math.min(buf.length, unitNameOff + 3 + nameLen + 400);
  let bestStart = -1, bestCount = 0;
  for (let s = startSearch; s < endSearch - 9 * 5; s++) {
    // Try this offset as the first soldier's byte +0.
    let count = 0;
    for (; count < 500 && s + count * 9 < buf.length; count++) {
      const v = buf[s + count * 9];
      if (v !== 0x00 && v !== 0x04 && v !== 0x08 && v !== 0x0c) break;
    }
    // We want a "long-enough" run that's plausibly a unit's soldier count
    // (5..160 is the realistic range).
    if (count >= 20 && count <= 200 && count > bestCount) {
      bestStart = s;
      bestCount = count;
    }
  }
  return { start: bestStart, count: bestCount };
}

// ─────────────────────────────────────────────────────────────────────────
// Helper: classify each of the 9 byte positions across soldiers of a unit
// ─────────────────────────────────────────────────────────────────────────
function classifyBytes(buf, start, count) {
  const out = [];
  for (let bp = 0; bp < 9; bp++) {
    const hist = new Map();
    for (let i = 0; i < count; i++) {
      const v = buf[start + i * 9 + bp];
      hist.set(v, (hist.get(v) || 0) + 1);
    }
    const distinct = hist.size;
    const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    let cls;
    if (distinct === 1) cls = "CONSTANT";
    else if (distinct <= 4) cls = "LOW-ENTROPY";
    else if (distinct >= 16) cls = "HIGH-ENTROPY";
    else cls = "MID-ENTROPY";
    out.push({ bp, distinct, cls, top });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Main loop
// ─────────────────────────────────────────────────────────────────────────
for (const saveName of SAVES) {
  const savePath = path.join(SAVE_DIR, saveName);
  if (!fs.existsSync(savePath)) {
    console.log(`SKIP (missing): ${saveName}`);
    continue;
  }
  const buf = fs.readFileSync(savePath);
  console.log(`\n========================================================`);
  console.log(`SAVE: ${saveName}  (${buf.length} bytes)`);
  console.log(`========================================================`);

  for (const unitType of UNIT_TYPES) {
    const hits = findUnitInstances(buf, unitType);
    if (hits.length === 0) continue;
    console.log(`\n--- ${unitType}: ${hits.length} instance(s) ---`);
    // Try the first few instances.
    for (let i = 0; i < Math.min(3, hits.length); i++) {
      const nameOff = hits[i];
      const { start, count } = locateSoldierArray(buf, nameOff, unitType.length);
      if (start === -1) {
        console.log(`  inst[${i}] @0x${nameOff.toString(16)}: soldier array NOT FOUND`);
        continue;
      }
      console.log(`  inst[${i}] @0x${nameOff.toString(16)}: array @0x${start.toString(16)} count=${count}`);
      const classes = classifyBytes(buf, start, count);
      for (const c of classes) {
        const topStr = c.top.map(([v, n]) => `${v.toString(16).padStart(2, "0")}×${n}`).join(" ");
        console.log(`    byte +${c.bp}: ${c.cls.padEnd(13)} distinct=${String(c.distinct).padStart(3)}  top: ${topStr}`);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Cross-save deep dive: for the SAME unit in two consecutive saves,
// look at HP / kills / morale bytes that change between turns.
// ─────────────────────────────────────────────────────────────────────────
console.log(`\n========================================================`);
console.log(`Cross-save byte-position drift (arretium t3 → t4)`);
console.log(`========================================================`);
function loadIfExists(name) {
  const p = path.join(SAVE_DIR, name);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}
const t3 = loadIfExists("save_arretium turn 3.sav");
const t4 = loadIfExists("save_arretium turn 4.sav");
if (t3 && t4) {
  const unitType = "roman hastati early";
  const inst3 = findUnitInstances(t3, unitType);
  const inst4 = findUnitInstances(t4, unitType);
  console.log(`hastati instances: t3=${inst3.length} t4=${inst4.length}`);
  // Compare first instance's soldier array byte-by-byte position-wise.
  // We can't pair soldiers across saves easily without UUIDs, so just look
  // at the histograms.
  for (let inst = 0; inst < Math.min(inst3.length, inst4.length, 3); inst++) {
    const a3 = locateSoldierArray(t3, inst3[inst], unitType.length);
    const a4 = locateSoldierArray(t4, inst4[inst], unitType.length);
    if (a3.start === -1 || a4.start === -1) continue;
    console.log(`\n  hastati[${inst}] t3 count=${a3.count} vs t4 count=${a4.count}`);
    const c3 = classifyBytes(t3, a3.start, a3.count);
    const c4 = classifyBytes(t4, a4.start, a4.count);
    for (let bp = 0; bp < 9; bp++) {
      const diff = c3[bp].cls !== c4[bp].cls || c3[bp].distinct !== c4[bp].distinct;
      const marker = diff ? "*" : " ";
      console.log(`   ${marker} byte +${bp}: t3=${c3[bp].cls}(${c3[bp].distinct}) | t4=${c4[bp].cls}(${c4[bp].distinct})`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Armor-upgrade focused: arretium pre (before armor) vs arretium turn 4
// (after armor). Both should have hastati with same weapon level. Does
// any byte position shift from CONSTANT 0x00 → CONSTANT non-zero?
// ─────────────────────────────────────────────────────────────────────────
console.log(`\n========================================================`);
console.log(`Armor-upgrade focused: arretium pre vs next-turn-armour-upgraded`);
console.log(`========================================================`);
const pre = loadIfExists("save_before armor upgrade queue.sav");
const post = loadIfExists("save_next turn, armour upgraded..sav");
if (pre && post) {
  const unitType = "roman hastati early";
  const instPre = findUnitInstances(pre, unitType);
  const instPost = findUnitInstances(post, unitType);
  console.log(`hastati: pre=${instPre.length} post=${instPost.length}`);
  for (let inst = 0; inst < Math.min(instPre.length, instPost.length, 6); inst++) {
    const aPre = locateSoldierArray(pre, instPre[inst], unitType.length);
    const aPost = locateSoldierArray(post, instPost[inst], unitType.length);
    if (aPre.start === -1 || aPost.start === -1) continue;
    const cPre = classifyBytes(pre, aPre.start, aPre.count);
    const cPost = classifyBytes(post, aPost.start, aPost.count);
    let interesting = false;
    for (let bp = 0; bp < 9; bp++) {
      // Look for bytes that went from CONSTANT 0x00 → CONSTANT non-zero
      // (the armor-upgrade signature).
      const preTop = cPre[bp].top[0] || [0, 0];
      const postTop = cPost[bp].top[0] || [0, 0];
      if (cPre[bp].cls === "CONSTANT" && cPost[bp].cls === "CONSTANT" && preTop[0] !== postTop[0]) {
        console.log(`  hastati[${inst}] byte +${bp}: CONSTANT 0x${preTop[0].toString(16)} → CONSTANT 0x${postTop[0].toString(16)} (PROMOTION CANDIDATE)`);
        interesting = true;
      }
    }
    if (!interesting && inst === 0) {
      // Dump anyway for the first instance so we see the picture.
      console.log(`  hastati[0] pre→post byte profile:`);
      for (let bp = 0; bp < 9; bp++) {
        const preTop = cPre[bp].top.map(([v, n]) => `${v.toString(16)}×${n}`).join(",");
        const postTop = cPost[bp].top.map(([v, n]) => `${v.toString(16)}×${n}`).join(",");
        console.log(`    byte +${bp}: pre[${cPre[bp].cls}] {${preTop}}  →  post[${cPost[bp].cls}] {${postTop}}`);
      }
    }
  }
}
