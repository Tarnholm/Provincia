// dig-diploterms-27-final.js
// Final consolidation. Seleucid: 10 allies (199), of which 7 are -10 locked.
// Player zone: class1=10, class4=5. Test: class1 = NON-locked allies (10-?),
// class4 = locked allies (subset). Reconcile the numbers.
"use strict";
const fs = require("fs");
const ds = fs.readFileSync("C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt", "latin1");
const lines = ds.split(/\r?\n/);

function relsFor(faction) {
  const out = [];
  const re = new RegExp(`^\\s*faction_relationships\\s+${faction}\\s*,\\s*(\\d+)\\s+(\\w+)`, "i");
  for (const ln of lines) { const code = ln.split(";")[0]; const m = re.exec(code); if (m) out.push({ val:+m[1], partner:m[2].toLowerCase() }); }
  return out;
}
function attFor(faction) {
  const out = new Map();
  const re = new RegExp(`^\\s*core_attitudes\\s+${faction}\\s*,\\s*(-?\\d+)\\s+(.+)$`, "i");
  for (const ln of lines) { const code = ln.split(";")[0]; const m = re.exec(code); if (m) { const v=+m[1]; m[2].split(",").map(s=>s.trim().toLowerCase()).filter(Boolean).forEach(p=>out.set(p, v)); } }
  return out;
}

const rels = relsFor("seleucid");
const att = attFor("seleucid");
const allies = rels.filter(r=>r.val<=199).map(r=>r.partner);
console.log("Seleucid 10 ally+trade(199) partners and their core_attitude:");
let locked=0, nonlocked=0;
for (const p of allies) {
  const a = att.get(p);
  const isLocked = a === -10;
  if (isLocked) locked++; else nonlocked++;
  console.log(`  ${p.padEnd(14)} core_attitude=${a===undefined?"(none)":a} ${isLocked?"<-- LOCKED (-10)":""}`);
}
console.log(`\n  locked allies: ${locked}   non-locked allies: ${nonlocked}`);
console.log(`  player-zone: class1=10, class4=5`);
console.log(`\nInterpretation:`);
console.log(`  - 10 ally+trade relationships -> ALL appear as class1 OR class4`);
console.log(`  - class4 (5) likely = the met locked-allies/protectorates`);
console.log(`  - class1 captures alliance; class2(19) = trade-only (no alliance)`);
