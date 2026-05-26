// Is the header faction-discovered bitmask actually per-player discovery?
// Compare raw bitmask bytes across DIFFERENT campaigns and turns. If it's
// real discovery: (a) different players differ, (b) it grows over turns.
const fs = require("fs");
const { parseHeader, parseFactionDiscoveredBitmask } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const SAVES = [
  "save_macedon t0.sav",
  "save_Seleucids t0.sav",
  "save_Autosave   Antigonid Kingdom   Turn 1.sav",
  "save_Autosave   Seleucid Empire   Turn 1.sav",
  "save_17-05-2026   Spain   Turn 1.sav",
  "save_Autosave   Spain   Turn 4.sav",
  "save_Autosave   Carthage   Turn 1 End.sav",
  "save_Autosave   Carthage   Turn 2.sav",
  "save_t0.sav",
  "save_t6.sav",
  "save_Autosave   Dummies   Turn 8.sav",
  "save_Autosave   Republic of Rome   Turn 5 Start.sav",
];

const rows = [];
for (const name of SAVES) {
  let buf;
  try { buf = fs.readFileSync(DIR + name); } catch { continue; }
  const hdr = parseHeader(buf);
  const bm = parseFactionDiscoveredBitmask(buf, hdr);
  if (!bm) { rows.push({ name, count: "NULL", hex: "" }); continue; }
  const hex = bm.bits.reduce((acc, b, i) => {
    const byteIdx = i >> 3;
    if (!acc[byteIdx]) acc[byteIdx] = 0;
    if (b) acc[byteIdx] |= (1 << (i & 7));
    return acc;
  }, []).map(b => b.toString(16).padStart(2, "0")).join("");
  rows.push({ name, count: bm.discoveredCount, hex });
}

for (const r of rows) {
  console.log(`${String(r.count).padStart(4)}  ${r.name.padEnd(52)}  ${r.hex}`);
}

// Distinct bitmask patterns
const distinct = new Set(rows.map(r => r.hex).filter(Boolean));
console.log(`\nDistinct bitmask patterns across ${rows.length} saves: ${distinct.size}`);
if (distinct.size === 1) {
  console.log(">>> IDENTICAL across all campaigns/turns → NOT player discovery; static campaign config.");
} else {
  console.log(">>> Patterns differ → could be real per-save state. Inspect which factions toggle.");
}
