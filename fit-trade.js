// Fit the sea/land trade law against the ~180 real route values from the screenshots.
// Runs the model with TRADE_DEBUG, matches each modeled lane to the truth route, then
// reports (cargo, d, popSum, TRUE export) so the slope law can be cracked.
process.env.TRADE_DEBUG = "1";
const fs = require("fs");
const { crackSave } = require("./src/saveCracker.js");
const te = require("./src/traitEffects.js");
const im = require("./src/incomeModel.js");
const MOD = "C:/RIS/RIS/data";
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Carthage   Turn 1.sav";
const TRUTH = require("./docs/carthage-screenshots-truth.json");

const cr = crackSave(fs.readFileSync(SAVE), MOD);
const gov = te.govEffectByCityFromSave(cr, te.parseTraitEffects(MOD), MOD);
global.__TDBG = [];
const B = im.computeTurn1Budget(MOD, "carthage", null, { govEffectByCity: gov });
const dbg = global.__TDBG;

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
// region -> settlement name
const regToSet = {};
for (const s of B.settlements) regToSet[norm(s.region)] = s.settlement;
const setExists = new Set(B.settlements.map(s => norm(s.settlement)));

// index model export rows by from-settlement + to-settlement
const modelRows = {};
for (const r of dbg) {
  const toSet = regToSet[norm(r.toRegion)] || r.toRegion;
  const key = norm(r.from) + "|" + norm(toSet);
  (modelRows[key] = modelRows[key] || []).push({ ...r, toSet });
}

const paired = [];
let unmatched = 0, unmatchedVal = 0;
for (const tw of TRUTH.settlements) {
  for (const rt of tw.routes) {
    const key = norm(tw.name) + "|" + norm(rt.partner);
    const cand = modelRows[key];
    if (!cand || !cand.length) { unmatched++; unmatchedVal += rt.value; continue; }
    // a partner can appear twice (import+export). Pop one candidate per truth row.
    const m = cand.shift();
    paired.push({ from: tw.name, to: rt.partner, kind: m.kind, cargo: m.cargo, d: m.d, popFrom: m.popFrom, popTo: m.popTo, modelExp: m.exp, truth: rt.value, weak: m.weak, pinned: m.pinned });
  }
}

console.log(`paired ${paired.length} routes; unmatched ${unmatched} (sum ${unmatchedVal})`);
console.log("\nkind  from->to                         cargo   d    popF   popT  model  truth  slope=(truth-base)/cargo  (base=1.1*sqrt(popSum))");
const base = (pf, pt) => 1.10 * Math.sqrt((pf || 1500) + (pt || 1500));
for (const p of paired.filter(p => p.kind === "sea").sort((a, b) => a.d - b.d || a.cargo - b.cargo)) {
  const b = base(p.popFrom, p.popTo);
  const slope = p.cargo > 0 ? (p.truth - b) / p.cargo : NaN;
  console.log(`${p.kind.padEnd(5)} ${(p.from + "->" + p.to).padEnd(32)} ${String(p.cargo).padEnd(6)} ${String(p.d).padEnd(4)} ${String(p.popFrom).padEnd(6)} ${String(p.popTo).padEnd(5)} ${String(p.modelExp).padEnd(6)} ${String(p.truth).padEnd(6)} ${isNaN(slope) ? "" : slope.toFixed(2)}`);
}

// slope-vs-distance buckets (sea, cargo>1.5 so base noise small)
console.log("\n=== SEA slope by distance (cargo>2, popSum-base removed) ===");
const byD = {};
for (const p of paired) {
  if (p.kind !== "sea" || p.cargo < 2 || p.weak) continue;
  const b = base(p.popFrom, p.popTo);
  const slope = (p.truth - b) / p.cargo;
  (byD[p.d] = byD[p.d] || []).push(slope);
}
for (const d of Object.keys(byD).map(Number).sort((a, b) => a - b)) {
  const a = byD[d]; const mean = a.reduce((x, y) => x + y, 0) / a.length;
  console.log(`d=${String(d).padEnd(4)} n=${String(a.length).padEnd(3)} meanSlope ${mean.toFixed(2)}  [${a.map(x => x.toFixed(1)).join(", ")}]`);
}

fs.writeFileSync("./docs/trade-pairs.json", JSON.stringify(paired, null, 1));
console.log("\nwrote docs/trade-pairs.json");
