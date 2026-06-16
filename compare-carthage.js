// Headless: run the real income model on the Carthage turn-1 save and diff every
// town against docs/carthage-screenshots-truth.json (transcribed from in-game shots).
// Model reads ONLY save + mod files. Usage: node compare-carthage.js [channel]
const fs = require("fs");
const path = require("path");
const { crackSave } = require("./src/saveCracker.js");
const te = require("./src/traitEffects.js");
const im = require("./src/incomeModel.js");

const MOD = "C:/RIS/RIS/data";
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Carthage   Turn 1.sav";
const TRUTH = require("./docs/carthage-screenshots-truth.json");

const cr = crackSave(fs.readFileSync(SAVE), MOD);
const gov = te.govEffectByCityFromSave(cr, te.parseTraitEffects(MOD), MOD);
const B = im.computeTurn1Budget(MOD, "carthage", null, { govEffectByCity: gov });
if (B.error) { console.error("ERROR:", B.error); process.exit(1); }

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const byName = {};
for (const s of B.settlements) byName[norm(s.settlement)] = s;

const channels = ["farms->farming", "taxes->taxes", "trade->trade", "admin->admin", "corruption->corruption"];
const sums = {}; const absErr = {}; const exactCnt = {}; const n = {};
for (const c of channels) { sums[c] = { t: 0, m: 0 }; absErr[c] = 0; exactCnt[c] = 0; n[c] = 0; }

const rows = [];
for (const tw of TRUTH.settlements) {
  const m = byName[norm(tw.name)];
  const row = { name: tw.name, pop: tw.pop, gov: tw.governor && tw.governor.name, age: tw.governor && tw.governor.age };
  for (const c of channels) {
    const [tk, mk] = c.split("->");
    const tv = tw[tk];
    const mv = m ? m[mk] : null;
    if (tv == null) continue;
    const mvv = mv == null ? 0 : mv;
    const d = mvv - tv;
    row[tk] = `${tv} | ${mv == null ? "?" : mv} | ${d >= 0 ? "+" : ""}${d}`;
    sums[c].t += tv; sums[c].m += mvv; absErr[c] += Math.abs(d); n[c]++;
    if (d === 0) exactCnt[c]++;
  }
  if (!m) row._missing = true;
  rows.push(row);
}

const which = process.argv[2];
console.log("\n=== PER-TOWN (truth | model | delta) ===");
for (const r of rows) {
  const tag = which ? (r[which] || "") : `T:${r.taxes || ""}  Tr:${r.trade || ""}  Co:${r.corruption || ""}`;
  console.log(`${(r.name + (r._missing ? " [MISSING]" : "")).padEnd(24)} pop${String(r.pop).padEnd(6)} ${r.gov || ""}/${r.age || ""}  ${tag}`);
}

console.log("\n=== CHANNEL SUMMARY ===");
for (const c of channels) {
  const k = c.split("->")[0];
  console.log(`${k.padEnd(12)} exact ${exactCnt[c]}/${n[c]}   sumTruth ${sums[c].t}  sumModel ${sums[c].m}  (${((sums[c].m / sums[c].t - 1) * 100).toFixed(1)}%)   MAE ${(absErr[c] / n[c]).toFixed(1)}`);
}
console.log("\nFaction totals (truth): farming", TRUTH.faction_totals.farming, "trade", TRUTH.faction_totals.trade, "taxes", TRUTH.faction_totals.taxes);
console.log("Model totals:", JSON.stringify(B.totals));
