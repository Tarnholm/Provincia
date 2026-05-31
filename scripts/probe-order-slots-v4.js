// scripts/probe-order-slots-v4.js — separate s0/s1/s3/s9 by SPECIFIC source.
//
// Builds a chain->category map from the RIS export_descr_buildings.txt (by `tag`)
// and, per player-own settlement, the MAX level present in each happiness
// category:  entertainment, temple(religion), sanitation(health), market/trade.
// Then correlates each of s0/s1/s3/s9 against each category level (not a coarse
// "any happiness building" flag).  Also does CROSS-SAVE COMPLETION DIFFS: for any
// city appearing in two consecutive autosaves where a category level rose, report
// which slot jumped.
//
// Usage: node scripts/probe-order-slots-v4.js
"use strict";
const fs = require("fs");
const path = require("path");
const { crackSave } = require("../src/saveCracker.js");
const { parseSettlementFields } = require("../src/settlementFieldsParser.js");
const { findAllSettlementMarkers, parseSettlements } = require("../src/buildingParser.js");

const MOD = "C:\\RIS\\RIS\\data";
const EDB = path.join(MOD, "export_descr_buildings.txt");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";

const SAVES = [
  ["Carthage1",     path.join(SAVES_DIR, "save_Carthage1.sav"), 1],
  ["carthage2",     path.join(SAVES_DIR, "save_carthage2.sav"), 2],
  ["carthage3",     path.join(SAVES_DIR, "save_carthage3.sav"), 3],
  ["julii1",        path.join(SAVES_DIR, "save_julii1.sav"), 1],
  ["julii2",        path.join(SAVES_DIR, "save_julii2.sav"), 2],
  ["julii3",        path.join(SAVES_DIR, "save_julii3.sav"), 3],
  ["RoR-T1End",     path.join(SAVES_DIR, "save_Autosave   Republic of Rome   Turn 1 End.sav"), 1],
  ["RoR-T2Start",   path.join(SAVES_DIR, "save_Autosave   Republic of Rome   Turn 2 Start.sav"), 2],
  ["RoR-T2End",     path.join(SAVES_DIR, "save_Autosave   Republic of Rome   Turn 2 End.sav"), 2],
  ["RoR-T3Start",   path.join(SAVES_DIR, "save_Autosave   Republic of Rome   Turn 3 Start.sav"), 3],
  ["Cart-T2End",    path.join(SAVES_DIR, "save_Autosave   Carthage   Turn 2 End.sav"), 2],
  ["Cart-T3Start",  path.join(SAVES_DIR, "save_Autosave   Carthage   Turn 3 Start.sav"), 3],
  ["crash-T5Start", "C:\\dev\\crash-saves-v7.2\\2026-05-30__Raymond__save_Autosave_Republic_of_Rome_Turn_5_Start\\save_Autosave   Republic of Rome   Turn 5 Start.sav", 5],
  ["crash-T8End",   "C:\\dev\\crash-saves-v7.2\\2026-05-30__Raymond__save_Autosave_Republic_of_Rome_Turn_8_End\\save_Autosave   Republic of Rome   Turn 8 End.sav", 8],
  ["crash-T34Start","C:\\dev\\crash-saves-v7.2\\2026-05-30__Thibaud_Borny__save_Autosave_Republic_of_Rome_Turn_34_Start\\save_Autosave   Republic of Rome   Turn 34 Start.sav", 34],
];

// ---- build chain -> category map from EDB tags ----
function buildChainCategories() {
  const txt = fs.readFileSync(EDB, "utf8").split(/\r?\n/);
  const cat = {}; // chain -> {tag, happy}
  let cur = null;
  for (const ln of txt) {
    const mb = ln.match(/^building\s+(\w+)/);
    if (mb) { cur = mb[1]; cat[cur] = { tag: null, happy: false }; continue; }
    if (!cur) continue;
    const mt = ln.match(/^\s*tag\s+(\w+)/);
    if (mt) cat[cur].tag = mt[1];
    if (/happiness_bonus/.test(ln)) cat[cur].happy = true;
  }
  return cat;
}
const CAT = buildChainCategories();

// Map a chain name -> a coarse happiness CATEGORY.
function categoryOf(name) {
  const c = CAT[name];
  if (c && c.tag === "entertainment") return "ent";
  if (c && c.tag === "temple") return "temple";
  if (c && c.tag === "sanitation") return "health";
  if (c && c.tag === "civic") return "civic";
  // trade-ish: markets/ports/traders that grant happiness
  if (name === "market" || name === "harbour" || /trader|market|forum|bazaar/.test(name)) return "trade";
  return null;
}

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

const HAPPY_SLOTS = [0, 1, 3, 9];
const all = []; // {label,turn,city,pop,order,slots,ent,temple,health,trade,civic,entN,templeN}

for (const [label, p, turnHint] of SAVES) {
  if (!fs.existsSync(p)) { console.log(`-- MISSING ${label}`); continue; }
  const buf = fs.readFileSync(p);
  let r;
  try { r = crackSave(buf, MOD); } catch (e) { console.log(`-- CRACK FAIL ${label}: ${e.message}`); continue; }
  const fac = r.playerFaction;
  const turn = r.turn != null ? r.turn : turnHint;
  const ownCities = new Set((r.factions[fac] && r.factions[fac].regions) || []);
  const markers = findAllSettlementMarkers(buf);
  const fields = parseSettlementFields(buf, markers);
  let blds = {};
  try {
    const s = parseSettlements(buf, null, null);
    for (const st of s.settlements) blds[st.name] = (st.buildings || []);
  } catch (e) {}

  for (const city of ownCities) {
    const f = fields[city];
    if (!f || !Array.isArray(f.orderBreakdown)) continue;
    const bs = blds[city] || [];
    // MAX level + COUNT per category. level is 0-based; use level+1 as a "tier".
    const lvl = { ent: 0, temple: 0, health: 0, trade: 0, civic: 0 };
    const cnt = { ent: 0, temple: 0, health: 0, trade: 0, civic: 0 };
    for (const b of bs) {
      const cat = categoryOf(b.name);
      if (!cat) continue;
      const tier = (b.level || 0) + 1;
      if (tier > lvl[cat]) lvl[cat] = tier;
      cnt[cat] += 1;
    }
    all.push({
      label, turn, city,
      pop: f.committedPopulation || 0,
      order: f.publicOrder || 0,
      slots: f.orderBreakdown,
      ent: lvl.ent, temple: lvl.temple, health: lvl.health, trade: lvl.trade, civic: lvl.civic,
      entN: cnt.ent, templeN: cnt.temple, healthN: cnt.health, tradeN: cnt.trade, civicN: cnt.civic,
    });
  }
  const rows = all.filter(x => x.label === label);
  const withEnt = rows.filter(r => r.ent > 0).length;
  const withTemple = rows.filter(r => r.temple > 0).length;
  const withHealth = rows.filter(r => r.health > 0).length;
  const withTrade = rows.filter(r => r.trade > 0).length;
  console.log(`loaded ${label.padEnd(15)} turn=${String(turn).padStart(2)} player=${fac.padEnd(20)} cities=${rows.length} ent=${withEnt} temple=${withTemple} health=${withHealth} trade=${withTrade}`);
}

console.log(`\n=== total player-own city rows: ${all.length} ===\n`);

// ---- per-slot correlation against each category LEVEL (max tier) and pop ----
const pops = all.map(a => a.pop);
const orders = all.map(a => a.order);
const cats = ["ent", "temple", "health", "trade", "civic"];
console.log("--- corr(slot, category-max-level) and corr(slot, pop) over all rows ---");
console.log("        ent     temple   health   trade    civic    pop");
for (const i of HAPPY_SLOTS) {
  const sv = all.map(a => a.slots[i]);
  const row = cats.map(c => fmt(corr(sv, all.map(a => a[c]))));
  console.log(`  s${String(i).padStart(2)}  ${row.join("  ")}  ${fmt(corr(sv, pops))}`);
}

// ---- partial: hold pop, look at slot mean conditioned on category present/absent ----
console.log("\n--- slot mean conditioned on category presence (level>0 vs ==0) ---");
for (const c of cats) {
  const has = all.filter(a => a[c] > 0), no = all.filter(a => a[c] === 0);
  if (has.length < 3) { console.log(`  ${c}: only ${has.length} rows have it — skip`); continue; }
  console.log(`  category ${c.padEnd(7)} (has=${has.length}, no=${no.length}):`);
  for (const i of HAPPY_SLOTS) {
    const mh = mean(has.map(a => a.slots[i])), mn = mean(no.map(a => a.slots[i]));
    console.log(`      s${String(i).padStart(2)}  has=${fmt(mh)}  no=${fmt(mn)}  delta=${fmt(mh - mn)}`);
  }
}

// ---- CROSS-SAVE COMPLETION DIFF ----
// Pair consecutive saves of same campaign; for cities present in both where a
// category level ROSE, show slot deltas.
console.log("\n--- cross-save completion diffs (category level rose between consecutive saves) ---");
const PAIRS = [
  ["Carthage1", "carthage2"], ["carthage2", "carthage3"],
  ["julii1", "julii2"], ["julii2", "julii3"],
  ["RoR-T1End", "RoR-T2Start"], ["RoR-T2Start", "RoR-T2End"], ["RoR-T2End", "RoR-T3Start"],
  ["Cart-T2End", "Cart-T3Start"],
  ["crash-T5Start", "crash-T8End"],
];
const byLabelCity = {};
for (const a of all) byLabelCity[a.label + " " + a.city] = a;
let anyJump = false;
for (const [la, lb] of PAIRS) {
  for (const a of all.filter(x => x.label === la)) {
    const b = byLabelCity[lb + " " + a.city];
    if (!b) continue;
    for (const c of cats) {
      if (b[c] > a[c]) {
        anyJump = true;
        const deltas = HAPPY_SLOTS.map(i => `s${i}:${(b.slots[i] - a.slots[i]).toFixed(1)}`).join(" ");
        const allDeltas = b.slots.map((v, i) => Math.abs(v - a.slots[i]) > 0.01 ? `s${i}:${(v - a.slots[i]).toFixed(1)}` : null).filter(Boolean).join(" ");
        console.log(`  ${a.city.padEnd(14)} ${la}->${lb}  ${c} ${a[c]}->${b[c]}  | happy:[${deltas}]  | ALL changed:[${allDeltas}]`);
      }
    }
  }
}
if (!anyJump) console.log("  (no category-level increases found across any consecutive save pair)");

// ---- detailed dump: a few high-temple, high-ent cities to eyeball slot pattern ----
console.log("\n--- sample rows (sorted by temple level then ent) ---");
const sample = [...all].sort((x, y) => (y.temple - x.temple) || (y.ent - x.ent)).slice(0, 25);
console.log("  city/label              pop  ent tmp hlt trd | s0   s1   s3   s9");
for (const a of sample) {
  console.log(`  ${(a.city + "@" + a.label).padEnd(24)} ${String(a.pop).padStart(5)}  ${a.ent}  ${a.temple}  ${a.health}  ${a.trade}  | ${a.slots[0].toFixed(1).padStart(4)} ${a.slots[1].toFixed(1).padStart(4)} ${a.slots[3].toFixed(1).padStart(4)} ${a.slots[9].toFixed(1).padStart(4)}`);
}

fs.writeFileSync(path.join(__dirname, "..", "tmp-order-slots-v4.json"),
  JSON.stringify(all.map(a => ({ label: a.label, turn: a.turn, city: a.city, pop: a.pop, order: a.order, slots: a.slots, ent: a.ent, temple: a.temple, health: a.health, trade: a.trade, civic: a.civic })), null, 0));
console.log("\nwrote tmp-order-slots-v4.json");
