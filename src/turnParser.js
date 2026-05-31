// src/turnParser.js
//
// CURRENT TURN NUMBER + campaign date (year/season) — CONFIRMED 2026-05-31.
//
// WHY THIS EXISTS: the old heuristic (count of econ-history 23×i32 blocks before
// the player faction record) SATURATES on long campaigns — it returned 10 for a
// known "Turn 34 Start" save. This parser reads the LITERAL turn counter from the
// campaign-date record instead, so it is exact at any turn.
//
// THE RECORD (cracked from controlled diffs: Raymond T5-Start vs T8-End differ by
// exactly 3 at one u32; cross-validated on RIS julii1/2/3, Carthage1/2/3,
// Carthage T2-End/T3-Start, and the Republic-of-Rome T5/T8/T34 crash saves —
// 11/11 exact):
//
//   ... "<mod data path>/descr_strat.txt"   (UTF-16LE, ends in "txt")
//   u8   <variant byte>      (0xd6 older RIS layout, 0xa6 v7.x — NOT load-bearing)
//   u8   0x44  u8 0x00  u8 0x00  u8 0x01     ← marker
//   u32  turnsElapsed        (= turn - 1; the engine's 0-based turn counter)
//   i32  currentYear         (absolute, BC negative; epoch -270)
//
// CADENCE (derived empirically, NOT assumed): RIS advances 4 TURNS PER YEAR.
//   currentYear == -270 + floor(turnsElapsed / 4)
//   season index == turnsElapsed % 4   (0..3; t1→0, t2→1, t3→2, t4→3, t5→0, …)
// This year↔turn relation is used as a SELF-CONSISTENCY CHECK on the located
// record (rejects coincidental "txt"+marker hits), not as the turn source itself.
//
// LOCATE BY SIGNATURE (offset is NOT fixed — it shifts ~48 bytes between the
// older julii/carthage layout @17627 and the v7.x crash-save layout @17579).

"use strict";

const EPOCH_YEAR = -270;       // RTW imperial campaign start year (270 BC)
const TURNS_PER_YEAR = 4;      // CONFIRMED empirically for RIS (see header)

// "txt" in UTF-16LE — the tail of the "...descr_strat.txt" path string that
// immediately precedes the date record.
const TXT_SIG = Buffer.from([0x74, 0x00, 0x78, 0x00, 0x74, 0x00]);

function yearForTurnsElapsed(turnsElapsed) {
  return EPOCH_YEAR + Math.floor(turnsElapsed / TURNS_PER_YEAR);
}

// Parse the current turn (and campaign date) from a save buffer.
// Returns { turn, turnsElapsed, year, seasonIndex, offset } or null if the
// signature isn't found / fails the year self-consistency check.
function parseTurn(buf) {
  if (!buf || buf.length < 64) return null;
  let p = 0;
  while ((p = buf.indexOf(TXT_SIG, p)) !== -1) {
    const m = p + TXT_SIG.length; // first byte after "txt"
    // m+0 = variant byte (0xd6 / 0xa6 / …), then the marker 0x44 0x00 0x00 0x01
    if (
      m + 5 + 8 <= buf.length &&
      buf[m + 1] === 0x44 &&
      buf[m + 2] === 0x00 &&
      buf[m + 3] === 0x00 &&
      buf[m + 4] === 0x01
    ) {
      const tOff = m + 5;
      const turnsElapsed = buf.readInt32LE(tOff);
      const year = buf.readInt32LE(tOff + 4);
      // Self-consistency: plausible range + year matches the 4-turns/year law.
      if (
        turnsElapsed >= 0 &&
        turnsElapsed < 100000 &&
        year >= -271 &&
        year <= 300 &&
        year === yearForTurnsElapsed(turnsElapsed)
      ) {
        return {
          turn: turnsElapsed + 1,             // 1-based turn (matches save filenames)
          turnsElapsed,                        // engine's 0-based counter
          year,                                // current campaign year (BC negative)
          seasonIndex: turnsElapsed % TURNS_PER_YEAR, // 0..3 within the year
          offset: tOff,
        };
      }
    }
    p += 1;
  }
  return null;
}

module.exports = { parseTurn, yearForTurnsElapsed, EPOCH_YEAR, TURNS_PER_YEAR };
