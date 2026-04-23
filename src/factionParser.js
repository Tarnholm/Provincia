// src/factionParser.js
//
// Faction record parser (partial). Extracts treasury and some modifier floats
// from faction records in the 0x890000 - 0x8a6000 range of a save file.
//
// Format discovered (may need refinement):
//   uint32  faction_type_or_index  (5=rebels, 7=senate, others TBD)
//   uint32  0
//   uint32  count  (usually 2)
//   uint32  0
//   ...zero-padding...
//   uint32  TREASURY (in denari)
//   float32 modifier1
//   float32 modifier2
//   float32 modifier3
//   ...more fields...
//
// This parser is approximate — identifying which faction is at which offset
// requires matching treasury values to descr_strat `denari N` lines.

"use strict";

const FACTION_SECTION_START = 0x890000;
const FACTION_SECTION_END = 0x8a6000;
const MIN_TREASURY = 100;
const MAX_TREASURY = 200000;

function findFactionTreasuries(buf) {
  const candidates = [];
  for (let i = FACTION_SECTION_START; i < FACTION_SECTION_END - 32; i += 4) {
    const v = buf.readUInt32LE(i);
    if (v < MIN_TREASURY || v > MAX_TREASURY) continue;
    // Require surrounding pattern: zero padding before, floats after
    // Check: 8 bytes before are mostly zero
    let zeroBefore = 0;
    for (let k = Math.max(0, i - 16); k < i; k++) if (buf[k] === 0) zeroBefore++;
    if (zeroBefore < 12) continue;
    // Check that the next 12 bytes look like floats (not all zero, not huge ints)
    const f1 = buf.readFloatLE(i + 8);
    const f2 = buf.readFloatLE(i + 12);
    if (!isFinite(f1) || !isFinite(f2)) continue;
    if (f1 === 0 && f2 === 0) continue;
    if (Math.abs(f1) > 1e6 || Math.abs(f2) > 1e6) continue;
    candidates.push({
      offset: i,
      treasury: v,
      floats: [f1, f2, buf.readFloatLE(i + 16)],
    });
  }
  return candidates;
}

// Match observed treasuries to descr_strat faction declarations
function mapTreasuriesToFactions(candidates, descrStratFactions) {
  const byTreasury = new Map();
  for (const f of descrStratFactions) {
    if (!byTreasury.has(f.startDenari)) byTreasury.set(f.startDenari, []);
    byTreasury.get(f.startDenari).push(f.name);
  }
  return candidates.map(c => ({
    ...c,
    possibleFactions: byTreasury.get(c.treasury) || [],
  }));
}

function loadDescrStratFactions(descrStratPath) {
  const fs = require("fs");
  const text = fs.readFileSync(descrStratPath, "utf8");
  const lines = text.split(/\r?\n/);
  const out = [];
  let currentFaction = null;
  for (const line of lines) {
    const fm = line.match(/^faction\s+(\w+)/);
    if (fm) { currentFaction = fm[1]; continue; }
    const dm = line.match(/^denari\s+(\d+)/);
    if (dm && currentFaction) {
      out.push({ name: currentFaction, startDenari: parseInt(dm[1]) });
      currentFaction = null;
    }
  }
  return out;
}

module.exports = {
  findFactionTreasuries,
  mapTreasuriesToFactions,
  loadDescrStratFactions,
};
