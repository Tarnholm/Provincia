// Decompose tax: model exposes taxParts.{w (=W(pop)), flat (=4*buildingPts)}. At turn-1
// normal rate with gTax=1, model_tax = w + flat. Compute the implied TRUE W per town =
// truth_tax - flat (buildings held as modeled), and compare to the model's W(pop) curve.
// If implied W is a clean function of pop that differs from the anchors, refit the anchors.
const fs = require("fs");
const { crackSave } = require("./src/saveCracker.js");
const te = require("./src/traitEffects.js");
const im = require("./src/incomeModel.js");
const MOD = "C:/RIS/RIS/data";
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Carthage   Turn 1.sav";
const TRUTH = require("./docs/carthage-screenshots-truth.json");
const cr = crackSave(fs.readFileSync(SAVE), MOD);
const gov = te.govEffectByCityFromSave(cr, te.parseTraitEffects(MOD), MOD);
const B = im.computeTurn1Budget(MOD, "carthage", null, { govEffectByCity: gov });
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const byName = {}; for (const s of B.settlements) byName[norm(s.settlement)] = s;
const govByName = {}; for (const k of Object.keys(gov)) govByName[norm(k)] = gov[k];

const rows = [];
for (const tw of TRUTH.settlements) {
  const m = byName[norm(tw.name)];
  if (!m || tw.taxes == null || tw.pop == null) continue;
  const w = m.taxParts ? m.taxParts.w : null, flat = m.taxParts ? m.taxParts.flat : null;
  const g = govByName[norm(tw.name)] || {};
  const impliedW = tw.taxes - (flat || 0);            // true W if buildings held & no gov
  rows.push({ name: tw.name, pop: tw.pop, modelW: Math.round(w), flat: Math.round(flat), modelTax: m.taxes, truth: tw.taxes, impliedW: Math.round(impliedW), govTax: g.tax || 0, mgmt: g.mgmtStat });
}
// add the model's ACTUAL (descr_strat) pop
for (const r of rows) r.actualPop = byName[norm(r.name)].pop;
console.log("name                   dispPop actualPop modelW flat truth impliedW(=truth-flat)");
for (const r of rows.sort((a, b) => a.actualPop - b.actualPop))
  console.log(`${r.name.padEnd(22)} ${String(r.pop).padEnd(7)} ${String(r.actualPop).padEnd(9)} ${String(r.modelW).padEnd(6)} ${String(r.flat).padEnd(4)} ${String(r.truth).padEnd(5)} ${r.impliedW}`);
console.log("\n=== (actualPop, impliedW) for W-curve refit ===");
console.log(JSON.stringify(rows.sort((a, b) => a.actualPop - b.actualPop).map(r => [r.actualPop, r.impliedW])));

// group impliedW by pop — is W(pop) consistent within a pop bucket?
console.log("\n=== impliedW by population bucket (mean / min / max / n) ===");
const byPop = {};
for (const r of rows) (byPop[r.pop] = byPop[r.pop] || []).push(r.impliedW);
for (const p of Object.keys(byPop).map(Number).sort((a, b) => a - b)) {
  const a = byPop[p]; const mean = a.reduce((x, y) => x + y, 0) / a.length;
  console.log(`pop ${String(p).padEnd(6)} n=${String(a.length).padEnd(3)} mean ${mean.toFixed(0)}  min ${Math.min(...a)}  max ${Math.max(...a)}   modelW ${Math.round((byName[norm(rows.find(r => r.pop === p).name)] || {}).taxParts.w)}`);
}
