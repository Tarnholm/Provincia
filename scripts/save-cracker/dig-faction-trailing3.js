// dig-faction-trailing3.js — Investigate the 100→50 diff at 0x111ec.
// This is in the SETTLEMENT data area. The diff occurs near the strings
// "market", "barracks", "defenses", "core_building" — clearly a settlement
// attribute. Look at the structure to identify which faction and what
// the changed value means.
//
// Also: try a CLEANER pair. The "Noarmiesmovedturn1" save was taken with
// zero army movement vs the start save — let's see if that has fewer diffs.

const fs = require("fs");
const path = require("path");

const ALEX_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves";
const SAVE_NOT_DAMAGED = path.join(ALEX_DIR, "save_notdamagedturn1.sav");
const SAVE_DAMAGED = path.join(ALEX_DIR, "save_damagedturn1.sav");
const SAVE_START = path.join(ALEX_DIR, "save_saveturn1start.sav");
const SAVE_NO_MOVE = path.join(ALEX_DIR, "save_Noarmiesmovedturn1.sav");

// Use the smallest-diff pair (notdamaged vs damaged, 8 byte diffs).
// First: 0x111ec context — what record / faction is this in?
const bufA = fs.readFileSync(SAVE_NOT_DAMAGED);
const bufB = fs.readFileSync(SAVE_DAMAGED);

// Walk back from 0x111ec to find the surrounding section start.
// In session 12 we learned settlement zone starts at ~0xf88637 in rome10. For Macedon save
// at 1.1MB total file, settlement zone is much smaller. Let me search for "core_building"
// "settlement" etc.

console.log("===== Settlement-area structure around 0x111ec =====");

// Print 256 bytes centered on 0x111ec
for (let row = 0; row < 16; row++) {
  const off = 0x111ec - 128 + row * 16;
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 16; j++) {
    const b = bufA[off + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  const mark = (off <= 0x111ec && 0x111ec < off + 16) ? "  <-- diff" : "";
  console.log(`  0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}${mark}`);
}

// Look for the settlement record this 0x100→50 belongs to.
// Pattern: each settlement has a structure with ASCII attribute tags ("market", "barracks", "missiles", "defenses")
// followed by their values. Let's find all "core_building" and the start of each settlement block.

const coreBuild = Buffer.from("core_building", "ascii");
const settlements = [];
let p = 0x10000;
while ((p = bufA.indexOf(coreBuild, p)) !== -1 && p < 0x80000) {
  settlements.push(p);
  p++;
}
console.log(`\nFound ${settlements.length} "core_building" occurrences in 0x10000..0x80000`);
console.log(`Around our diff @0x111ec: nearest core_building offsets:`);
for (const s of settlements) {
  if (Math.abs(s - 0x111ec) < 4000) {
    console.log(`  0x${s.toString(16)} (${s < 0x111ec ? "-" : "+"}${Math.abs(s - 0x111ec)})`);
  }
}

// Now: what's an Alex T1 starting unit damaged save vs not damaged? Maybe the SCENARIO is:
// - "notdamaged" = standard start
// - "damaged" = same save but with one settlement reduced (population?) or one building damaged
//
// At 0x111ec the value goes 100→50 — perfectly halving. Could be **population**,
// **building HP**, or **settlement loyalty/happiness**.
//
// Let me check: in vanilla Alexander Macedon, what's the starting population of regions?

// Print 256 bytes around the diff for both buffers
console.log(`\n===== Bigger context bufB (damaged), around 0x111ec =====`);
for (let row = 0; row < 12; row++) {
  const off = 0x111ec - 96 + row * 16;
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 16; j++) {
    const b = bufB[off + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  const mark = (off <= 0x111ec && 0x111ec < off + 16) ? "  <-- diff" : "";
  console.log(`  0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}${mark}`);
}

// Now compare bufA vs SAVE_START — they might give us cleaner diff
const bufStart = fs.readFileSync(SAVE_START);
console.log(`\n===== save_saveturn1start vs save_notdamagedturn1 =====`);
console.log(`Sizes: ${bufStart.length} vs ${bufA.length} (delta=${bufA.length - bufStart.length})`);

// Diff
const diffs2 = [];
const n = Math.min(bufStart.length, bufA.length);
for (let i = 0; i < n; i++) if (bufStart[i] !== bufA[i]) diffs2.push(i);
console.log(`Diffs: ${diffs2.length}`);

// Also Noarmiesmoved (same start save with one less change)
const bufNoMove = fs.readFileSync(SAVE_NO_MOVE);
console.log(`\n===== save_saveturn1start vs save_Noarmiesmovedturn1 =====`);
console.log(`Sizes: ${bufStart.length} vs ${bufNoMove.length} (delta=${bufNoMove.length - bufStart.length})`);
const diffs3 = [];
const n2 = Math.min(bufStart.length, bufNoMove.length);
for (let i = 0; i < n2; i++) if (bufStart[i] !== bufNoMove[i]) diffs3.push(i);
console.log(`Diffs: ${diffs3.length}`);
if (diffs3.length < 50) {
  console.log(`Diff offsets: ${diffs3.map(o => "0x" + o.toString(16)).join(", ")}`);
}
