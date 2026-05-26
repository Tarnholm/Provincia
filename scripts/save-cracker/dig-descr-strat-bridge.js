// Check trait threshold table — when "Estates" trait has 26 points, what level does that map to?
// If descr_strat says "Estates 2", and v1 reads 26 at +4, then 26 should map to level 2 via thresholds.
const fs = require("fs");
const path = require("path");
const modPath = "C:/RIS/RIS";
const traitsTxt = fs.readFileSync(path.join(modPath, "data/export_descr_character_traits.txt"), "utf8");

// Parse trait → levels with thresholds
const traitThresholds = new Map(); // name → [threshold for level 1, 2, 3...]
let curTrait = null;
let curLevels = [];
for (const line of traitsTxt.split(/\r?\n/)) {
  const tM = line.match(/^Trait\s+([A-Za-z0-9_]+)/);
  if (tM) {
    if (curTrait) traitThresholds.set(curTrait, curLevels);
    curTrait = tM[1]; curLevels = [];
    continue;
  }
  const lvlM = line.match(/^\s*Level\s+(\S+)/);
  if (lvlM) curLevels.push({ name: lvlM[1], threshold: null });
  const thrM = line.match(/^\s*Threshold\s+(\d+)/);
  if (thrM && curLevels.length) curLevels[curLevels.length - 1].threshold = parseInt(thrM[1]);
}
if (curTrait) traitThresholds.set(curTrait, curLevels);

// Spot-check: Estates trait thresholds
console.log("Estates thresholds:", JSON.stringify(traitThresholds.get("Estates")));
console.log("FasterCharacters thresholds:", JSON.stringify(traitThresholds.get("FasterCharacters")));
console.log("ReligionAssigned thresholds:", JSON.stringify(traitThresholds.get("ReligionAssigned")));
console.log("TurnsAlive thresholds:", JSON.stringify(traitThresholds.get("TurnsAlive")));
console.log("Civil_Career_Restriction thresholds:", JSON.stringify(traitThresholds.get("Civil_Career_Restriction")));
console.log("GoodAdministrator thresholds:", JSON.stringify(traitThresholds.get("GoodAdministrator")));

// So "Estates 26" points means we look up thresholds; if level 1 needs 0, level 2 needs 10, level 3 needs 30 → 26 points = level 2.
// Let me verify: Quintus has Estates@26 in v1, Estates 2 in descr_strat. So 26 should be in [level 2 threshold, level 3 threshold).
function pointsToLevel(traitName, points) {
  const lvls = traitThresholds.get(traitName);
  if (!lvls || !lvls.length) return null;
  let lvl = 0;
  for (let i = 0; i < lvls.length; i++) {
    if (lvls[i].threshold == null) continue;
    if (points >= lvls[i].threshold) lvl = i + 1;
  }
  return lvl;
}
console.log("\nQuintus checks (descr_strat → v1 points → derived level):");
console.log(`  Estates: ds=2, v1=26 → derived level ${pointsToLevel("Estates", 26)}`);
console.log(`  FasterCharacters: ds=1, v1=136 → derived level ${pointsToLevel("FasterCharacters", 136)}`);
console.log(`  ReligionAssigned: ds=1, v1=6 → derived level ${pointsToLevel("ReligionAssigned", 6)}`);
console.log(`  Civil_Career_Restriction: ds=5, v1=1 → derived level ${pointsToLevel("Civil_Career_Restriction", 1)}`);
console.log(`  GoodAdministrator: ds=2, v1=3 → derived level ${pointsToLevel("GoodAdministrator", 3)}`);
