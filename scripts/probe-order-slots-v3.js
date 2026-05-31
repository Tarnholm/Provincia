// scripts/probe-order-slots-v3.js — promote public-order breakdown slots.
//
// Cross-turn + cross-faction controlled probe. For each save we:
//   - crack to get playerFaction + that faction's region list (its own cities)
//   - parse settlementFields → orderBreakdown[18] per city
//   - parse buildings per city (parseSettlements)
//   - use s11==0 as the CONFIRMED capital proxy
// Then per slot we report: capital vs non-capital means (s10), turn-1 vs later
// activation counts (s7, s14), per-city building presence (s0/s1/s3/s9).
//
// Usage: node scripts/probe-order-slots-v3.js
"use strict";
const fs = require("fs");
const path = require("path");
const { crackSave } = require("../src/saveCracker.js");
const { parseSettlementFields, settlementFieldsAt } = require("../src/settlementFieldsParser.js");
const { findAllSettlementMarkers, parseSettlements } = require("../src/buildingParser.js");

const MOD = "C:\\RIS\\RIS\\data";
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";

// (label, path, turnHint)
const SAVES = [
  ["Carthage1",            path.join(SAVES_DIR, "save_Carthage1.sav"), 1],
  ["carthage2",            path.join(SAVES_DIR, "save_carthage2.sav"), 2],
  ["carthage3",            path.join(SAVES_DIR, "save_carthage3.sav"), 3],
  ["julii1",               path.join(SAVES_DIR, "save_julii1.sav"), 1],
  ["julii2",               path.join(SAVES_DIR, "save_julii2.sav"), 2],
  ["julii3",               path.join(SAVES_DIR, "save_julii3.sav"), 3],
  ["RoR-T1End",            path.join(SAVES_DIR, "save_Autosave   Republic of Rome   Turn 1 End.sav"), 1],
  ["RoR-T2Start",          path.join(SAVES_DIR, "save_Autosave   Republic of Rome   Turn 2 Start.sav"), 2],
  ["RoR-T2End",            path.join(SAVES_DIR, "save_Autosave   Republic of Rome   Turn 2 End.sav"), 2],
  ["RoR-T3Start",          path.join(SAVES_DIR, "save_Autosave   Republic of Rome   Turn 3 Start.sav"), 3],
  ["Cart-T2End",           path.join(SAVES_DIR, "save_Autosave   Carthage   Turn 2 End.sav"), 2],
  ["Cart-T3Start",         path.join(SAVES_DIR, "save_Autosave   Carthage   Turn 3 Start.sav"), 3],
  ["crash-T5Start",        "C:\\dev\\crash-saves-v7.2\\2026-05-30__Raymond__save_Autosave_Republic_of_Rome_Turn_5_Start\\save_Autosave   Republic of Rome   Turn 5 Start.sav", 5],
  ["crash-T8End",          "C:\\dev\\crash-saves-v7.2\\2026-05-30__Raymond__save_Autosave_Republic_of_Rome_Turn_8_End\\save_Autosave   Republic of Rome   Turn 8 End.sav", 8],
  ["crash-T34Start",       "C:\\dev\\crash-saves-v7.2\\2026-05-30__Thibaud_Borny__save_Autosave_Republic_of_Rome_Turn_34_Start\\save_Autosave   Republic of Rome   Turn 34 Start.sav", 34],
];

// happiness-relevant chain name fragments (RIS export_descr_buildings).
// Used only as a coarse "happiness building present?" flag.
const HAPPY_CHAINS = /temple|amphithea|arena|colis|aqueduct|bath|sewer|forum|market|trader|bazaar/i;

function corr(xs, ys) {
  const n = xs.length; if (n < 3) return null;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; syy += ys[i] * ys[i]; sxy += xs[i] * ys[i]; }
  const cov = n * sxy - sx * sy;
  const dx = Math.sqrt(n * sxx - sx * sx), dy = Math.sqrt(n * syy - sy * sy);
  if (dx === 0 || dy === 0) return null;
  return cov / (dx * dy);
}
function mean(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function fmt(x) { return x == null ? "  n/a" : (x >= 0 ? " " : "") + x.toFixed(2); }

const NSLOT = 18;

// Accumulators across all saves (player-faction own cities only).
const all = []; // {label,turn,city,cap,pop,order,slots[18],happyCount,buildingNames}

for (const [label, p, turnHint] of SAVES) {
  if (!fs.existsSync(p)) { console.log(`-- MISSING ${label}: ${p}`); continue; }
  const buf = fs.readFileSync(p);
  let r;
  try { r = crackSave(buf, MOD); } catch (e) { console.log(`-- CRACK FAIL ${label}: ${e.message}`); continue; }
  const fac = r.playerFaction;
  const turn = r.turn != null ? r.turn : turnHint;
  const ownCities = new Set((r.factions[fac] && r.factions[fac].regions) || []);
  const markers = findAllSettlementMarkers(buf);
  const fields = parseSettlementFields(buf, markers);
  // buildings per settlement
  let blds = {};
  try {
    const s = parseSettlements(buf, null, null);
    for (const st of s.settlements) blds[st.name] = (st.buildings || []).map((b) => b.name);
  } catch (e) { /* buildings optional */ }

  for (const city of ownCities) {
    const f = fields[city];
    if (!f || !Array.isArray(f.orderBreakdown)) continue;
    const slots = f.orderBreakdown;
    const cap = slots[11] === 0 ? 1 : 0; // CONFIRMED: s11==0 ⇔ capital
    const bnames = blds[city] || [];
    const happyCount = bnames.filter((n) => HAPPY_CHAINS.test(n)).length;
    all.push({ label, turn, city, cap, pop: f.committedPopulation || 0, order: f.publicOrder || 0, slots, happyCount, bnames });
  }
  console.log(`loaded ${label} turn=${turn} player=${fac} ownCities=${ownCities.size} parsed=${all.filter(x => x.label === label).length}`);
}

console.log(`\n=== total player-own city rows: ${all.length} ===\n`);

// ---- s10: capital-status bonus ----
console.log("--- s10 (capital-status bonus): mean at capital vs non-capital, per save ---");
const bySave = {};
for (const a of all) (bySave[a.label] ||= []).push(a);
for (const [label, rows] of Object.entries(bySave)) {
  const caps = rows.filter((r) => r.cap), non = rows.filter((r) => !r.cap);
  const cs10 = caps.map((r) => r.slots[10]), ns10 = non.map((r) => r.slots[10]);
  console.log(`  ${label.padEnd(16)} capN=${String(caps.length).padStart(2)} s10cap=${fmt(mean(cs10))}  nonN=${String(non.length).padStart(3)} s10non=${fmt(mean(ns10))}  capVals=[${cs10.map(v=>v.toFixed(1)).join(",")}]`);
}

// ---- s7: turn-1 transient ----
console.log("\n--- s7 (turn-1 transient): fraction of cities with s7>0, by turn ---");
for (const [label, rows] of Object.entries(bySave)) {
  const active = rows.filter((r) => r.slots[7] > 0);
  console.log(`  ${label.padEnd(16)} turn=${rows[0].turn}  s7>0: ${active.length}/${rows.length}  meanActive=${fmt(mean(active.map(r=>r.slots[7])))}`);
}

// ---- s14: tax-onset line ----
console.log("\n--- s14 (econ/tax line): fraction with s14>0, by turn ---");
for (const [label, rows] of Object.entries(bySave)) {
  const active = rows.filter((r) => r.slots[14] > 0);
  console.log(`  ${label.padEnd(16)} turn=${rows[0].turn}  s14>0: ${active.length}/${rows.length}  meanActive=${fmt(mean(active.map(r=>r.slots[14])))}  sum=${active.reduce((s,r)=>s+r.slots[14],0).toFixed(0)}`);
}

// ---- s0/s1/s3/s9 vs buildings & pop ----
console.log("\n--- happiness-building slots: corr(slot, happyBuildingCount) and corr(slot, pop) over all rows ---");
const happyCounts = all.map((a) => a.happyCount);
const pops = all.map((a) => a.pop);
const orders = all.map((a) => a.order);
for (const i of [0, 1, 3, 9]) {
  const sv = all.map((a) => a.slots[i]);
  console.log(`  s${String(i).padStart(2)}  corr(happyBld)=${fmt(corr(sv, happyCounts))}  corr(pop)=${fmt(corr(sv, pops))}  corr(order)=${fmt(corr(sv, orders))}  meanActive=${fmt(mean(sv.filter(v=>v>0)))}  active=${sv.filter(v=>v>0).length}/${sv.length}`);
}

// ---- per-slot global activity summary ----
console.log("\n--- per-slot activity (all rows): active count, mean(active), min, max, corr(order) ---");
for (let i = 0; i < NSLOT; i++) {
  const sv = all.map((a) => a.slots[i]);
  const act = sv.filter((v) => v !== 0);
  console.log(`  s${String(i).padStart(2)}  active=${String(act.length).padStart(4)}/${sv.length}  mean=${fmt(mean(act))}  min=${Math.min(...sv).toFixed(1)}  max=${Math.max(...sv).toFixed(1)}  corr(order)=${fmt(corr(sv, orders))}`);
}

// ---- export raw for any deeper slicing ----
fs.writeFileSync(path.join(__dirname, "..", "tmp-order-slots-v3.json"), JSON.stringify(all.map(a => ({label:a.label,turn:a.turn,city:a.city,cap:a.cap,pop:a.pop,order:a.order,slots:a.slots,happy:a.happyCount})), null, 0));
console.log("\nwrote tmp-order-slots-v3.json");
