// Dump what the SAVE stores for each Carthage governor: management stat, all traits
// (name + level/points), and the model's computed govEffect (tax/trade/mgmt). Compare the
// tax-residual extremes (Ebusus model-over vs Rusadir model-under) to see if a tax-relevant
// trait/stat differs in the save — i.e. whether the governor tax effect is save-derivable.
const fs = require("fs");
const { crackSave } = require("./src/saveCracker.js");
const te = require("./src/traitEffects.js");
const MOD = "C:/RIS/RIS/data";
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Carthage   Turn 1.sav";
const cr = crackSave(fs.readFileSync(SAVE), MOD);
const parsed = te.parseTraitEffects(MOD);
const eff = te.govEffectByCityFromSave(cr, parsed, MOD);

// what does eff look like? dump keys + a couple entries fully
const keys = Object.keys(eff);
console.log("govEffectByCityFromSave keys (sample):", keys.slice(0, 5), "... total", keys.length);
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const focus = ["Ebusus", "Sulci", "Carthage", "Gigthis", "Rusadir", "Hadrumetum", "Utica", "Melite"];
for (const f of focus) {
  const k = keys.find(k => norm(k) === norm(f));
  console.log(`\n=== ${f} -> key ${k || "(none)"} ===`);
  if (k) console.log(JSON.stringify(eff[k], null, 1));
}
// also: raw governor records from the cracked save (traits + stats), if exposed
console.log("\n=== cracked save: governor/character record shape ===");
for (const prop of Object.keys(cr)) {
  if (/char|general|gov|family|trait|stat/i.test(prop)) console.log("  cr." + prop, Array.isArray(cr[prop]) ? `[${cr[prop].length}]` : typeof cr[prop]);
}
