"use strict";
// Diff Julii T7-Start (autosave at turn 7 begin) against Julii T7 manual save
// (after player did stuff during T7). Bytes that DIFFER = player actions
// during T7: treasury spent, units moved, recruitment, etc.
//
// Specifically hunt:
//   * u32 that's 24740 in T7S and 23856 in T7 manual → LIVE TREASURY cell
//   * stable bytes (don't change) → diplomatic state, turn counter, etc.
const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const T7S = fs.readFileSync(path.join(SAVE_DIR, "save_Autosave   Republic of Rome   Turn 7 Start.sav"));
const T7M = fs.readFileSync(path.join(SAVE_DIR, "save_Julii turn7.sav"));

console.log(`T7S=${T7S.length}  T7M=${T7M.length}  delta=${T7M.length - T7S.length}`);

// Hunt 1: treasury — u32 = 24740 in T7S that becomes a lower value in T7M.
console.log("\n=== Hunt 1: u32=24740 in T7S that drops to 23856 (or any lower value) in T7M at same offset ===");
{
  const matches = [];
  const minLen = Math.min(T7S.length, T7M.length);
  for (let o = 0; o + 4 <= minLen; o += 1) {
    if (T7S.readUInt32LE(o) !== 24740) continue;
    const v2 = T7M.readUInt32LE(o);
    if (v2 === 24740) continue; // unchanged - not interesting for the live cell hunt
    matches.push({ o, v1: 24740, v2 });
  }
  // Show top matches where v2 is in plausible treasury range (0..30000)
  const plausible = matches.filter(m => m.v2 >= 0 && m.v2 <= 30000);
  console.log(`  total 24740 cells that changed: ${matches.length}, of which plausible-treasury values: ${plausible.length}`);
  for (const m of plausible.slice(0, 30)) {
    const ctx = T7M.slice(Math.max(0, m.o-8), m.o+12).toString("hex");
    console.log(`    off=${m.o}  T7S=${m.v1} → T7M=${m.v2}  ctx(T7M)=${ctx}`);
  }
}

// Hunt 2: u32 = 23856 in T7M (the truth value) — where does it appear?
console.log("\n=== Hunt 2: u32=23856 in T7M (truth treasury) — every occurrence ===");
{
  let count = 0;
  for (let o = 0; o + 4 <= T7M.length; o += 1) {
    if (T7M.readUInt32LE(o) !== 23856) continue;
    const v1 = (o + 4 <= T7S.length) ? T7S.readUInt32LE(o) : null;
    const ctx = T7M.slice(Math.max(0, o-8), o+12).toString("hex");
    console.log(`    off=${o}  T7S=${v1} → T7M=23856  ctx=${ctx}`);
    count++;
    if (count > 40) { console.log("    ... truncated"); break; }
  }
  console.log(`  total: ${count}`);
}
