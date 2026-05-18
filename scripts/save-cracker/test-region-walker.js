// Validate the new findRegionRecords function across multiple saves.

const fs = require("fs");
const path = require("path");
const { findRegionRecords, parseFactionTreasuries } = require("../../src/saveCrackerExtras.js");

const SAVES = [
  "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav",
  "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_17-05-2026   Spain   Turn 1.sav",
];

for (const f of SAVES) {
  if (!fs.existsSync(f)) { console.log(`MISSING: ${path.basename(f)}`); continue; }
  const buf = fs.readFileSync(f);
  console.log(`\n=== ${path.basename(f)} (${(buf.length/1024).toFixed(0)} KB) ===`);

  const t0 = Date.now();
  const regions = findRegionRecords(buf);
  console.log(`region records: ${regions.length} (in ${Date.now() - t0} ms)`);
  if (regions.length > 0) {
    console.log(`  first 5: ${regions.slice(0, 5).map(r => `id=${r.regionId} uuid=${r.regionUuid.toString(16)}`).join(", ")}`);
    const uniqueIds = new Set(regions.map(r => r.regionId));
    console.log(`  unique region IDs: ${uniqueIds.size}`);
  }

  // Cross-check with faction treasuries' regionIds
  const treas = parseFactionTreasuries(buf);
  if (treas.length > 0) {
    const playerRegionIds = new Set(treas[0].regionIds);
    const matched = regions.filter(r => playerRegionIds.has(r.regionId)).length;
    console.log(`  player's ${playerRegionIds.size} region IDs matched ${matched} region records`);
  }
}
