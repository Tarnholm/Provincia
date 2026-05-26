// Try to derive Antigonos's stats by summing Effect lines from his traits
// and ancillaries. Compare to in-game (Command 7, Influence 6, Management 5).
const fs = require("fs");
const path = require("path");

// Parse traits file
const traitsTxt = fs.readFileSync("C:/RIS/RIS/data/export_descr_character_traits.txt", "utf8");
const modTraitLevels = {};
let curTrait = null, curLevelIdx = 0, curLvl = null;
for (const line of traitsTxt.split(/\r?\n/)) {
  const tm = line.match(/^Trait\s+(\S+)/);
  if (tm) { curTrait = tm[1]; curLevelIdx = 0; curLvl = null; continue; }
  const lm = line.match(/^\s*Level\s+(\S+)/);
  if (lm) {
    curLevelIdx++;
    curLvl = { levelIdx: curLevelIdx, levelName: lm[1], threshold: null, effects: [] };
    if (!modTraitLevels[curTrait]) modTraitLevels[curTrait] = [];
    modTraitLevels[curTrait].push(curLvl);
    continue;
  }
  if (curLvl) {
    const thm = line.match(/^\s*Threshold\s+(\d+)/);
    if (thm) { curLvl.threshold = parseInt(thm[1]); continue; }
    const efm = line.match(/^\s*Effect\s+(\S+)\s+(-?\d+)/);
    if (efm) curLvl.effects.push({ name: efm[1], value: parseInt(efm[2]) });
  }
}

// Parse ancillaries file
const ancTxt = fs.readFileSync("C:/RIS/RIS/data/export_descr_ancillaries.txt", "utf8");
const modAncillaryData = {};
let curAnc = null;
for (const line of ancTxt.split(/\r?\n/)) {
  const m = line.match(/^Ancillary\s+(\S+)/);
  if (m) { curAnc = { effects: [] }; modAncillaryData[m[1]] = curAnc; continue; }
  if (!curAnc) continue;
  const efm = line.match(/^\s*Effect\s+(\S+)\s+(-?\d+)/);
  if (efm) curAnc.effects.push({ name: efm[1], value: parseInt(efm[2]) });
}

// Antigonos's traits & ancillaries from descr_strat
const antigonosTraits = [
  ["BeingMacedonian", 1], ["ReligionAssigned", 1], ["GoodCommander", 3],
  ["NaturalMilitarySkill", 2], ["VictorOthersVirtue", 2], ["PoliticsSkill", 1],
  ["Antigonid", 1], ["GoodCavalryGeneral", 1], ["GloriousFool", 2],
  ["Selflessness", 3], ["Temperament", 3], ["Wealthy", 2],
  ["GoodAdministrator", 2], ["GeneralExperience", 3], ["Energetic", 2],
  ["NaturalEnergy", 4], ["NaturalIntelligence", 4], ["NaturalCharisma", 5],
  ["Drink", 1], ["KindRuler", 1], ["Leader_Rating", 3],
  ["LoyaltyLevel", 7], ["HatesGreek", 2], ["Supplies", 4],
  ["FasterCharacters", 1], ["HatesDardania", 2], ["HatesEpirus", 3],
  ["StrategicSkill", 2], ["TacticalSkill", 2], ["Gonatas", 1],
  ["TurnsAlive", 5],
];
const antigonosAncillaries = ["poet", "historian", "tutor"];

let cmd = 0, inf = 0, mgmt = 0, sub = 0;
const contribs = { Command: [], Influence: [], Management: [], Subterfuge: [] };

for (const [name, level] of antigonosTraits) {
  const lvls = modTraitLevels[name];
  if (!lvls) continue;
  // Engine picks the highest level whose Threshold <= character.level
  // The descr_strat `traits Name N` is the "points" not always the level index.
  // RIS uses points-based traits — find the highest level whose Threshold <= N.
  let chosen = null;
  for (const lvl of lvls) {
    if (lvl.threshold != null && lvl.threshold <= level) chosen = lvl;
  }
  if (!chosen) chosen = lvls[Math.min(level - 1, lvls.length - 1)];
  for (const e of chosen.effects || []) {
    if (e.name === "Command") { cmd += e.value; contribs.Command.push(`${name}=${e.value}`); }
    else if (e.name === "Influence") { inf += e.value; contribs.Influence.push(`${name}=${e.value}`); }
    else if (e.name === "Management") { mgmt += e.value; contribs.Management.push(`${name}=${e.value}`); }
    else if (e.name === "Subterfuge") { sub += e.value; contribs.Subterfuge.push(`${name}=${e.value}`); }
  }
}

for (const ancName of antigonosAncillaries) {
  const data = modAncillaryData[ancName];
  if (!data) continue;
  for (const e of data.effects || []) {
    if (e.name === "Command") { cmd += e.value; contribs.Command.push(`anc:${ancName}=${e.value}`); }
    else if (e.name === "Influence") { inf += e.value; contribs.Influence.push(`anc:${ancName}=${e.value}`); }
    else if (e.name === "Management") { mgmt += e.value; contribs.Management.push(`anc:${ancName}=${e.value}`); }
    else if (e.name === "Subterfuge") { sub += e.value; contribs.Subterfuge.push(`anc:${ancName}=${e.value}`); }
  }
}

console.log(`Derived stats (vs in-game 7/6/5):`);
console.log(`  Command:    ${cmd}  (in-game 7)`);
console.log(`  Influence:  ${inf}  (in-game 6)`);
console.log(`  Management: ${mgmt}  (in-game 5)`);
console.log(`  Subterfuge: ${sub}`);
console.log("\nContributions:");
for (const stat of Object.keys(contribs)) {
  console.log(`  ${stat}: ${contribs[stat].join(", ") || "(none)"}`);
}
