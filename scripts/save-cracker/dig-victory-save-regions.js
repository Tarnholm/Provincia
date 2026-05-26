// dig-victory-save-regions.js
// Dump the actual region IDs the save uses (via findRegionRecords + the
// faction treasury records), so we know the integer namespace the
// WIN_CONDITION section will reference. Also reports per-faction regionCount
// (the live "regions held" counter candidate).
// Research/diagnostics only.

const fs = require("fs");
const path = require("path");
const extras = require(path.join(__dirname, "..", "..", "src", "saveCrackerExtras.js"));
const SAVES = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const file = process.argv[2] || "save_macedon t0.sav";
const buf = fs.readFileSync(SAVES + file);
console.log(`=== ${file} (${buf.length} bytes) ===\n`);

const recs = extras.parseFactionTreasuries(buf);
console.log(`faction treasury records: ${recs.length}`);
let allRegionIds = new Set();
for (const r of recs) {
  for (const id of r.regionIds) allRegionIds.add(id);
}
const ids = [...allRegionIds].sort((a, b) => a - b);
console.log(`distinct region IDs across 23 major records: ${ids.length}`);
console.log(`min=${ids[0]} max=${ids[ids.length - 1]}`);
console.log(`first 30:`, ids.slice(0, 30).join(", "));

console.log("\nper-faction regionCount + first region IDs (live counter candidate):");
for (let i = 0; i < recs.length; i++) {
  const r = recs[i];
  console.log(`  rec ${String(i).padStart(2)} factionId=${String(r.factionId).padStart(3)} regionCount=${String(r.regionCount).padStart(3)} treasury=${r.treasury}  regionIds=[${r.regionIds.slice(0, 8).join(",")}${r.regionIds.length > 8 ? ",..." : ""}]`);
}

// Region records (whole-save signature walk)
const regionRecs = extras.findRegionRecords(buf);
const regRecIds = [...new Set(regionRecs.map(r => r.regionId))].filter(x => x > 0 && x < 100000).sort((a, b) => a - b);
console.log(`\nfindRegionRecords: ${regionRecs.length} records, distinct regionId in [1,100000): ${regRecIds.length}`);
console.log(`region-record IDs min=${regRecIds[0]} max=${regRecIds[regRecIds.length - 1]}`);
