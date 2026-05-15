#!/usr/bin/env node
// dig-family12.js — locate spouse pointer in character records.
//
// Strategy:
//   1) Parse descr_strat `relative` lines to extract husband→wife pairs.
//   2) Read all male character records via the parser.
//   3) For each known husband, search descr_names_lookup for the wife's
//      firstName index; find a u32==wife_name_idx near the husband's record
//      OR search for a u32 in the husband's record that points to a position
//      where the wife's name_idx u32 lives (her primaryUuid candidate).
//   4) Also: search the raw save for the wife's name index (4-byte LE) and
//      see if her position can be located, then check if a u32 == her
//      primaryUuid appears in the husband's record at a consistent offset.

const fs = require('fs');
const path = require('path');
const cp = require('C:/dev/Provincia/src/characterParser.js');

const MOD = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS beta/data";
const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const nameToIdx = new Map();
nameLookup.forEach((n, i) => { if (n) nameToIdx.set(n, i); });

const traitNames = [];
{
  const lines = fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/);
  for (const line of lines) {
    const tm = line.match(/^Trait\s+(\S+)/);
    if (tm) traitNames.push(tm[1]);
  }
}

// 1) Parse descr_strat for relative lines
const DSTR = "C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt";
const strat = fs.readFileSync(DSTR, "utf8");
const pairs = []; // {husbandFirst, husbandLast, wifeFirst}
for (const raw of strat.split(/\r?\n/)) {
  const line = raw.trim();
  if (!line.startsWith("relative")) continue;
  // strip trailing comment after `end`
  const idxEnd = line.toLowerCase().indexOf(" end");
  const head = (idxEnd > 0 ? line.slice(0, idxEnd) : line).replace(/^relative\s+/i, "");
  const parts = head.split(",").map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) continue;
  const husband = parts[0]; // "Quintus Ogulnius_Gallus"
  const wife = parts[1];    // "Baebiana"
  const hParts = husband.split(/\s+/);
  pairs.push({
    husbandFirst: hParts[0],
    husbandLast: hParts.slice(1).join(" ") || null,
    wifeFirst: wife.split(/\s+/)[0],
  });
}
console.log(`Parsed ${pairs.length} husband-wife pairs from descr_strat`);

// 2) Load save and parse
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const SAVE = path.join(SAVES, 'save_1.2.sav');
const buf = fs.readFileSync(SAVE);
const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
console.log(`Parsed ${recs.length} character records from save_1.2`);

// Map husbands to their parsed record
const byFirstLast = new Map();
for (const r of recs) {
  const key = `${r.firstName}|${r.lastName||''}`;
  if (!byFirstLast.has(key)) byFirstLast.set(key, []);
  byFirstLast.get(key).push(r);
}

// 3) For each known pair, locate husband record + wife's name_idx in the save
//    and see if there's a u32 in the husband record whose value matches a
//    u32 found near the wife name occurrence.

function findAllU32(target) {
  const positions = [];
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf.readUInt32LE(i) === target) positions.push(i);
  }
  return positions;
}

const offsetHistogram = new Map(); // wife uuid offset within husband record
const triedPairs = [];
let matchedCount = 0;

for (const p of pairs) {
  const husbandKey = `${p.husbandFirst}|${p.husbandLast||''}`;
  const husbands = byFirstLast.get(husbandKey);
  if (!husbands || husbands.length !== 1) continue;
  const h = husbands[0];
  const wifeIdx = nameToIdx.get(p.wifeFirst);
  if (wifeIdx == null) continue;

  // Find all positions where wifeIdx appears as a u32 in the save.
  // The wife's record SHOULD begin at a position where buf.readUInt32LE(pos)
  // == wifeIdx (since firstName is at offset +0 of a character record).
  // BUT wifeIdx is a small integer that may appear in many random spots;
  // restrict to positions that look like a character-record start.
  const wifePositions = findAllU32(wifeIdx);

  // Each candidate wife position has a primaryUuid at pos-47 (LAYOUT_A) or
  // pos-43 (LAYOUT_B). For each candidate, read primaryUuid and check
  // whether that u32 appears in the husband's record (within +0..+200).
  const candidates = [];
  for (const pos of wifePositions) {
    // Look for a u32 in husband record matching primaryUuid candidate at
    // pos-47 (A) and pos-43 (B).
    for (const layoutOffset of [47, 43]) {
      if (pos - layoutOffset < 0) continue;
      const wifeUuid = buf.readUInt32LE(pos - layoutOffset);
      if (!wifeUuid || wifeUuid === 0xffffffff) continue;
      // Check husband's record window for this uuid
      for (let i = 0; i + 4 <= 200; i++) {
        if (buf.readUInt32LE(h.offset + i) === wifeUuid) {
          candidates.push({ wifePos: pos, layoutOffset, wifeUuid, hOffsetInHusband: i });
        }
      }
    }
  }

  if (candidates.length > 0) {
    matchedCount++;
    // Record unique wife uuid hits (one candidate per husband)
    const seen = new Set();
    for (const c of candidates) {
      const key = `${c.wifeUuid}|${c.hOffsetInHusband}`;
      if (seen.has(key)) continue;
      seen.add(key);
      offsetHistogram.set(c.hOffsetInHusband, (offsetHistogram.get(c.hOffsetInHusband)||0)+1);
    }
    if (triedPairs.length < 8) {
      triedPairs.push({ husband: husbandKey, wife: p.wifeFirst, candidates: candidates.slice(0, 5) });
    }
  }
}

console.log(`\nHusbands with at least one wife-uuid candidate in their record: ${matchedCount}`);
console.log(`\nOffset histogram (where wifeUuid candidates land in husband record):`);
const sorted = [...offsetHistogram.entries()].sort((a, b) => b[1] - a[1]);
for (const [off, count] of sorted.slice(0, 25)) {
  console.log(`  +${off}: ${count}`);
}

console.log(`\nSample candidates (first ${triedPairs.length} pairs):`);
for (const t of triedPairs) {
  console.log(` ${t.husband} <-> ${t.wife}:`);
  for (const c of t.candidates) {
    console.log(`    wifePos=${c.wifePos} layoutOffset=${c.layoutOffset} wifeUuid=${c.wifeUuid} hOffsetInHusband=+${c.hOffsetInHusband}`);
  }
}
