// src/siegeParser.js
//
// Parses active SIEGES from an RTW Remastered save. Cracked 2026-05-30
// (rtw-sav-parser/docs/findings-siege-2026-05-30.md). A siege is two
// cross-linked records joined by a 4-byte siege-ID that links the besieging
// army to the besieged settlement.
//
// Besieger back-ref record (p = army-UUID start):
//   +0  u32 armyUUID
//   +4  u8  0x00
//   +5  u8  0x01            (siege flag)
//   +6  u32 siegeID
//   +14 u32 armyUUID (repeat)   <- the (p)==(p+14) self-check
//   +18 u32 0
//   +22 u32 turnsRemaining  (resets to 5 at siege start, decrements/turn, 0=ripe; HYP)
//
// Detector predicate (0 false positives across 7 test saves, 0 hits on a
// no-siege baseline): b[p+4]==0 && b[p+5]==1 && u32(p)==u32(p+14) && u32(p+18)==0.
// The target settlement is the nearest settlement record preceding the 2nd
// occurrence of the siegeID.
//
// TARGET (defender) side, at the 2nd occurrence T of the 4-byte siegeID
// (inside the besieged settlement record; b[T-1]==0x01):
//   T+0  u32 siegeID
//   T+4  u32 siegeWindow      (STATIC per settlement: 5 or 6; the siege "budget"/
//                              threshold, does NOT change over turns)
//   T+8  u32 turnsUnderSiege  (defender-side counter; counts UP +1 each turn)
// CONFIRMED 2026-05-31 (findings-siege-defender-2026-05-31.md) on a controlled
// same-campaign consecutive-autosave pair (RoR Turn 2 End -> Turn 3 Start): all
// 9 ongoing sieges matched by siegeID+armyUUID showed turnsUnderSiege += 1 and
// siegeWindow unchanged. So the defender side IS a separate counter from the
// besieger's turnsRemaining (which resets and counts DOWN), and it counts UP.

"use strict";

// settlements: optional array of { offset, name } (from buildingParser) used
// to resolve the besieged settlement name. Returns [] when none are active.
function parseSieges(buf, settlements) {
  const sieges = [];
  const end = buf.length - 26;
  for (let p = 0; p < end; p++) {
    if (buf[p + 4] !== 0x00 || buf[p + 5] !== 0x01) continue;
    // self-check: u32 at +0 equals u32 at +14
    if (!(buf[p] === buf[p + 14] && buf[p + 1] === buf[p + 15] &&
          buf[p + 2] === buf[p + 16] && buf[p + 3] === buf[p + 17])) continue;
    if (buf[p + 18] || buf[p + 19] || buf[p + 20] || buf[p + 21]) continue;
    const uuid = buf.readUInt32LE(p);
    if (uuid === 0 || uuid === 0xffffffff) continue;
    const siegeId = buf.readUInt32LE(p + 6);
    if (siegeId === 0 || siegeId === 0xffffffff) continue;
    // Turn counter resets to 5 and counts down; sanity-bound it to reject
    // records that pass the structural predicate but aren't sieges.
    const turnsRemaining = buf.readUInt32LE(p + 22);
    if (turnsRemaining > 100) continue;

    // The siegeID must appear at least twice (besieger + target).
    const needle = Buffer.alloc(4); needle.writeUInt32LE(siegeId);
    const locs = []; let i = 0;
    while ((i = buf.indexOf(needle, i)) !== -1 && locs.length < 8) { locs.push(i); i++; }
    if (locs.length < 2) continue;

    // Target settlement: the target-side siege-ID sits INSIDE the besieged
    // settlement record, ~430 bytes BEFORE its name marker (findings-siege).
    // So resolve to the nearest settlement marker that FOLLOWS the non-besieger
    // siege-ID occurrence (smallest positive offset−targetLoc).
    let target = null;
    const targetLoc = locs.find((l) => Math.abs(l - p) > 64);
    // Defender-side counters live at the target occurrence (CONFIRMED 2026-05-31):
    //   targetLoc+4 = siegeWindow (static), targetLoc+8 = turnsUnderSiege (counts up).
    let turnsUnderSiege = null;
    let siegeWindow = null;
    if (targetLoc != null) {
      if (targetLoc + 8 <= buf.length) siegeWindow = buf.readUInt32LE(targetLoc + 4);
      if (targetLoc + 12 <= buf.length) turnsUnderSiege = buf.readUInt32LE(targetLoc + 8);
      // Sanity-bound: these are small counts; reject implausible reads.
      if (siegeWindow != null && (siegeWindow === 0 || siegeWindow > 100)) siegeWindow = null;
      if (turnsUnderSiege != null && turnsUnderSiege > 100) turnsUnderSiege = null;
    }
    if (targetLoc != null && Array.isArray(settlements)) {
      let bestS = null;
      for (const s of settlements) {
        if (s.offset != null && s.offset >= targetLoc &&
            (!bestS || s.offset < bestS.offset)) bestS = s;
      }
      if (bestS && bestS.offset - targetLoc < 4000) target = bestS.name;
    }

    sieges.push({
      besiegerArmyUuid: uuid,
      siegeId,
      turnsRemaining, // HYP: turns until the settlement falls (5 at start, 0 = ripe)
      turnsUnderSiege, // CONFIRMED: defender-side counter; counts UP +1 each turn (null if unresolved)
      siegeWindow,     // CONFIRMED: static per-settlement siege budget/threshold (5 or 6); null if unresolved
      targetSettlement: target,
      offset: p,
    });
  }
  return sieges;
}

module.exports = { parseSieges };
