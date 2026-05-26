// test-dead-pool-removal.js — controlled experiment to find out how much
// modification RTW Remastered tolerates in the dead-pool dynasty records.
//
// Produces 3 test saves with progressively-larger changes. Load each in
// RTW and report which ones load (and whether the campaign plays):
//
//   TEST A  — control: byte-identical copy of the source save with a new
//             filename. Confirms RTW will load a renamed save at all.
//
//   TEST B  — single-byte flip inside record #50's portrait path. Changes
//             '/portraits/dead/NNN.tga' to '/portrXits/dead/NNN.tga'. If
//             this still loads, the path string isn't checksummed.
//
//   TEST C  — zero-out 250 B of record #50's body (everything AFTER its
//             portrait path, up to but not crossing into the next record's
//             header). Most aggressive in-place wipe without shifting any
//             offsets. If this loads, we can selectively scrub dead-pool
//             records, and the next step is to also reduce the engine's
//             dead-pool COUNT header to actually reclaim pointer-registry
//             slots.
//
// Usage:  node scripts/save-cracker/test-dead-pool-removal.js
//
// All three test saves land in `C:\Users\vtarn\Downloads\` next to the
// source. To run a test: copy the test save into the RTW save dir under
// the standard autosave filename, launch the campaign, and report.

"use strict";
const fs = require("fs");

// Turn 960 deliberately, NOT 1017. The brink-of-corruption save would
// corrupt on load even with byte-identical edits (the engine re-tallies
// the pointer registry on load, and 1017 is already at the cliff). Turn
// 960 has ~6,000 slots of headroom, so any failure cleanly attributes to
// our edit instead of natural overflow.
const SRC = "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const OUT = "C:/Users/vtarn/Downloads/";
const NEEDLE = Buffer.from("/portraits/dead/", "ascii");

function load() { return Buffer.from(fs.readFileSync(SRC)); }

function findHits(buf) {
  const hits = [];
  let from = 0;
  while (true) {
    const idx = buf.indexOf(NEEDLE, from);
    if (idx < 0) break;
    hits.push(idx);
    from = idx + NEEDLE.length;
  }
  return hits;
}

// === TEST A: control — byte-identical rename. ===
{
  const buf = load();
  fs.writeFileSync(OUT + "save_TEST_A_control.sav", buf);
  console.log("TEST A (control, byte-identical rename) -> save_TEST_A_control.sav");
}

// === TEST B: single-byte flip in record #50's portrait-path string. ===
{
  const buf = load();
  const hits = findHits(buf);
  const target = hits[49];
  const flipOff = target + 5;          // 'i' in '/portraits/...'
  const orig = buf[flipOff];
  buf[flipOff] = 0x58;                 // 'X'
  fs.writeFileSync(OUT + "save_TEST_B_oneByte.sav", buf);
  console.log("TEST B (single byte flip @0x" + flipOff.toString(16) + ": " + orig.toString(16) + " -> 58)  -> save_TEST_B_oneByte.sav");
}

// === TEST C: zero-out 250 B of record #50's body. ===
{
  const buf = load();
  const hits = findHits(buf);
  const target = hits[49];
  const wipeStart = target + 24;       // skip path string + null
  const wipeEnd   = target + 24 + 250; // ~half the median record size
  buf.fill(0, wipeStart, wipeEnd);
  fs.writeFileSync(OUT + "save_TEST_C_zeroBody.sav", buf);
  console.log("TEST C (zero 250 B of record #50 body @0x" + wipeStart.toString(16) + "..0x" + wipeEnd.toString(16) + ")  -> save_TEST_C_zeroBody.sav");
}

console.log();
console.log("All three test files in: " + OUT);
console.log();
console.log("How to test each one:");
console.log("  1. Rename the test save to the campaign's expected filename");
console.log("     (e.g. 'save_Autosave   Dummies   Turn 1017 Start.sav').");
console.log("  2. Drop into RTW's save folder.");
console.log("  3. Try to load it from the in-game Load Game menu.");
console.log("  4. Report: a) load succeeds, b) dynasty view OK, c) end turn OK.");
