// dig-econ-find-section.js
// Find the FACTION_ECONOMICS section (36 records). Approach: the player's NET
// income posted at the start of each turn equals the previous turn's surplus.
//   T2 net = +6833, T3 net = +1438, T4 net = +1422.
// But the live economics record stores GROSS components (tax/trade/farm/mine) and
// expenses (upkeep/construction/etc). Net = sum(income) - sum(expense).
//
// Strategy 1: scan each turn's file for ALL u32 == net value, and look for a file
// region where multiple economic-looking i32 appear together with a recognizable
// 36-record stride. We don't yet know gross, so first just MAP where the net value
// occurs to narrow the section.
//
// Strategy 2 (primary): locate the section by structural grouping. The 23 class-100
// records are FACTION records. The 36 FACTION_ECONOMICS records are a separate run.
// Look for any value pattern: scan for the "100" "1" version pair is faction; econ
// records likely have their own version tag. Instead, find a dense cluster of i32
// in the economic range that repeats ~36 times with constant stride.

const fs = require("fs");
const path = require("path");
const { parseFactionTreasuries } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const FILES = { T1: "save_arretium pre retrained..sav", T2: "save_arretium retrained turn 2.sav", T3: "save_arretium turn 3.sav", T4: "save_arretium turn 4.sav" };
const GROUND = { T1: 10000, T2: 16833, T3: 18271, T4: 19693 };

const bufs = {};
for (const [t, f] of Object.entries(FILES)) bufs[t] = fs.readFileSync(path.join(BASE, f));

// Where do the class-100 (FACTION) records live? They give us a body region anchor.
const recs1 = parseFactionTreasuries(bufs.T1);
const minOff = Math.min(...recs1.map(r => r.offset));
const maxOff = Math.max(...recs1.map(r => r.offset));
console.log(`T1 class-100 FACTION records span 0x${minOff.toString(16)} .. 0x${maxOff.toString(16)} (${recs1.length} recs)`);

// Find all occurrences of each turn's NET income as u32 in that turn's file,
// and also the absolute treasury, to see clustering.
function findVal(buf, v) {
  const out = [];
  const t = Buffer.alloc(4); t.writeInt32LE(v);
  let p = 0;
  while ((p = buf.indexOf(t, p)) !== -1) { out.push(p); p++; }
  return out;
}

// The economics section likely sits in the same body region as the faction records.
// Search a window [minOff - 4MB, maxOff + 4MB] for the net values.
const nets = { T2: 6833, T3: 1438, T4: 1422 };
for (const [t, net] of Object.entries(nets)) {
  const all = findVal(bufs[t], net);
  const inRegion = all.filter(o => o > minOff - 6 * 1048576 && o < maxOff + 8 * 1048576);
  console.log(`\n[${t}] net=${net}: ${all.length} total occurrences in file, ${inRegion.length} in faction-region window`);
  console.log(`  in-region offsets: ${inRegion.slice(0, 40).map(o => "0x" + o.toString(16)).join(", ")}`);
}

// Also: where does the absolute treasury (which we KNOW is in the section) appear
// OUTSIDE the class-100 record? List all occurrences of the treasury per turn.
console.log("\n=== all occurrences of absolute treasury per turn (to spot the econ-record copy) ===");
for (const t of ["T1", "T2", "T3", "T4"]) {
  const all = findVal(bufs[t], GROUND[t]);
  console.log(`[${t}] treasury=${GROUND[t]}: ${all.length} occurrences: ${all.slice(0, 40).map(o => "0x" + o.toString(16)).join(", ")}`);
}
