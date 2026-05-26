// Verify the modTraitLevels parser produces expected output for RIS.
const fs = require("fs");
const path = require("path");

const MOD = "C:\\RIS\\RIS\\data";
const lines = fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/);

const modTraitNames = [];
const modTraitLevels = {};
let curTrait = null, curLevelIdx = 0, curLevelObj = null;
for (const line of lines) {
  const tm = line.match(/^Trait\s+(\S+)/);
  if (tm) { curTrait = tm[1]; curLevelIdx = 0; curLevelObj = null; modTraitNames.push(curTrait); continue; }
  const lm = line.match(/^\s*Level\s+(\S+)/);
  if (lm) {
    curLevelIdx++;
    curLevelObj = { levelIdx: curLevelIdx, levelName: lm[1], descKey: null, effectsKey: null, threshold: null, effects: [], desc: null, effectsDesc: null };
    if (!modTraitLevels[curTrait]) modTraitLevels[curTrait] = [];
    modTraitLevels[curTrait].push(curLevelObj);
    continue;
  }
  if (curLevelObj) {
    const dm = line.match(/^\s*Description\s+(\S+)/);
    if (dm) { curLevelObj.descKey = dm[1]; continue; }
    const efdm = line.match(/^\s*EffectsDescription\s+(\S+)/);
    if (efdm) { curLevelObj.effectsKey = efdm[1]; continue; }
    const thm = line.match(/^\s*Threshold\s+(\d+)/);
    if (thm) { curLevelObj.threshold = parseInt(thm[1], 10); continue; }
    const efm = line.match(/^\s*Effect\s+(\S+)\s+(-?\d+)/);
    if (efm) { curLevelObj.effects.push({ name: efm[1], value: parseInt(efm[2], 10) }); }
  }
}

// Resolve vnvs
const buf3 = fs.readFileSync(path.join(MOD, "text", "export_vnvs.txt"));
const text = (buf3[0] === 0xff && buf3[1] === 0xfe) ? buf3.toString("utf16le", 2) : buf3.toString("utf8");
const vnvLines = text.split(/\r?\n/);
const keyToText = new Map();
for (let i = 0; i < vnvLines.length; i++) {
  const line = vnvLines[i];
  const m = line.match(/^\{([^}]+)\}\s*(.+?)\s*$/);
  if (m) { keyToText.set(m[1], m[2]); continue; }
  const mk = line.match(/^\{([^}]+)\}\s*$/);
  if (mk) {
    let j = i + 1;
    while (j < vnvLines.length && vnvLines[j].trim() === "") j++;
    if (j < vnvLines.length && !vnvLines[j].startsWith("{")) keyToText.set(mk[1], vnvLines[j].trim());
  }
}

console.log(`traits: ${modTraitNames.length}`);
console.log(`vnvs keys: ${keyToText.size}`);

// Resolve
let withDesc = 0, withEffectsDesc = 0;
for (const t of Object.keys(modTraitLevels)) {
  for (const lvl of modTraitLevels[t]) {
    if (lvl.descKey && keyToText.has(lvl.descKey)) { lvl.desc = keyToText.get(lvl.descKey); withDesc++; }
    if (lvl.effectsKey && keyToText.has(lvl.effectsKey)) { lvl.effectsDesc = keyToText.get(lvl.effectsKey); withEffectsDesc++; }
  }
}
console.log(`level entries with description: ${withDesc}`);
console.log(`level entries with effectsDesc: ${withEffectsDesc}`);

// Sample
const sample = modTraitLevels["GoodCommander"];
console.log("\nGoodCommander levels:");
for (const lvl of sample || []) {
  console.log(`  [${lvl.levelIdx}] ${lvl.levelName} (thr ${lvl.threshold})`);
  console.log(`     effects: ${lvl.effects.map(e => `${e.value > 0 ? "+" : ""}${e.value} ${e.name}`).join(", ")}`);
  console.log(`     effectsDesc: ${lvl.effectsDesc || "(none)"}`);
  console.log(`     desc: ${lvl.desc ? lvl.desc.slice(0, 80) + "..." : "(none)"}`);
}
