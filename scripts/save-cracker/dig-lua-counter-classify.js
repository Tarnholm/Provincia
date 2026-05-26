// dig-lua-counter-classify.js
//
// Classify the ~115 Lua counters in save_macedon t0.sav into meaningful
// categories, and characterize the cyclic "turn_number" counter using the
// consecutive t0..t7 series so the report can explain WHY it isn't the turn.

const fs = require("fs");
const path = require("path");
const { findLuaCounters, indexCountersByName } = require("../../src/luaCounterParser");

const SAVES_DIR =
  "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function load(file) {
  const buf = fs.readFileSync(path.join(SAVES_DIR, file));
  const recs = findLuaCounters(buf);
  return { recs, byName: indexCountersByName(recs) };
}

const mac = load("save_macedon t0.sav");

// Classify by name pattern + value shape.
const cats = {
  factionId: [],   // id_* big integers (faction internal IDs)
  stateFlag: [],   // 0/1 flags
  rebellion: [],   // *Rebellion* progress
  reformCounter: [],
  battleCounter: [],
  other: [],
};
for (const r of mac.recs) {
  const n = r.name;
  if (/^id_/.test(n)) cats.factionId.push(r);
  else if (/Rebellion/i.test(n)) cats.rebellion.push(r);
  else if (/reform/i.test(n)) cats.reformCounter.push(r);
  else if (/battle|num_battles/i.test(n)) cats.battleCounter.push(r);
  else if (r.value === 0 || r.value === 1) cats.stateFlag.push(r);
  else cats.other.push(r);
}

console.log("=== Counter classification (save_macedon t0.sav) ===");
for (const c in cats) {
  console.log(`\n[${c}] ${cats[c].length}`);
  for (const r of cats[c]) console.log(`   ${r.name.padEnd(46)} = ${r.value | 0}`);
}

// Characterize turn_number across the consecutive t0..t7 series.
console.log("\n=== turn_number across player t0..t7 (cyclic check) ===");
for (let i = 0; i <= 7; i++) {
  const f = `save_t${i}.sav`;
  const full = path.join(SAVES_DIR, f);
  if (!fs.existsSync(full)) continue;
  const { byName } = load(f);
  const v = byName.has("turn_number") ? (byName.get("turn_number") | 0) : "(absent)";
  console.log(`  t${i}: turn_number = ${v}`);
}
console.log("\nObservation: turn_number cycles -3,-2,-1,0 every 4 turns -> it is a");
console.log("scripted relative counter (RIS), NOT the absolute turn. Absent in vanilla.");
