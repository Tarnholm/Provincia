// dig-victory-find-objects.js
// Find every occurrence of the win-condition-related type-name ASCII strings
// in the save body (beyond the registry @0x3310). RTW saves often embed the
// type name inline at the head of each serialized object instance.
// Research/diagnostics only.

const fs = require("fs");
const SAVES = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const file = process.argv[2] || "save_macedon t0.sav";
const buf = fs.readFileSync(SAVES + file);
console.log(`=== ${file} (${buf.length} bytes) ===\n`);

const NAMES = ["WIN_CONDITION", "OUTLIVE_FACTIONS", "HOLD_REGIONS", "TAKE_ROME",
  "MAP_REGIONS", "TAKE_CITY", "WORLD", "TAKE_ROME"];

const REGISTRY_END = 0x3b93;

for (const name of NAMES) {
  const t = Buffer.from(name, "ascii");
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(t, p)) !== -1) {
    hits.push(p);
    p += 1;
    if (hits.length > 50) break;
  }
  const beyond = hits.filter(h => h > REGISTRY_END);
  console.log(`${name.padEnd(18)} total=${hits.length} beyondRegistry=${beyond.length}`);
  for (const h of beyond.slice(0, 12)) {
    console.log(`    @0x${h.toString(16)}`);
  }
}
