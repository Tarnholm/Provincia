// dig-diploterms-20-seleucidcount.js
// Parse RIS descr_strat faction_relationships for SELEUCID and categorize by
// the RIS legend (<=199 ally+trade, 200 neutral, >=201 war). Compare counts to
// the Seleucid player-zone class histogram {1:10, 2:19, 4:5, 5:81}.
"use strict";
const fs = require("fs");

const ds = fs.readFileSync("C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt", "latin1");
const lines = ds.split(/\r?\n/);

// faction_relationships seleucid, <val> <partner>   (from seleucid's perspective)
const fromSel = [];
const reFR = /^\s*faction_relationships\s+seleucid\s*,\s*(\d+)\s+(\w+)/i;
for (const ln of lines) {
  // strip comments
  const code = ln.split(";")[0];
  const m = reFR.exec(code);
  if (m) fromSel.push({ val: parseInt(m[1], 10), partner: m[2].toLowerCase() });
}
console.log(`Seleucid faction_relationships (from seleucid's perspective): ${fromSel.length}`);
const ally = fromSel.filter(r => r.val <= 199);
const neutral = fromSel.filter(r => r.val === 200);
const war = fromSel.filter(r => r.val >= 201);
console.log(`  ally+trade (<=199): ${ally.length}  -> ${ally.map(r=>`${r.partner}(${r.val})`).join(", ")}`);
console.log(`  neutral (200):      ${neutral.length}`);
console.log(`  war (>=201):        ${war.length}  -> ${war.map(r=>`${r.partner}(${r.val})`).join(", ")}`);

// core_attitudes seleucid (the attitude tier the engine uses)
const ca = [];
const reCA = /^\s*core_attitudes\s+seleucid\s*,\s*(-?\d+)\s+(.+)$/i;
for (const ln of lines) {
  const code = ln.split(";")[0];
  const m = reCA.exec(code);
  if (m) {
    const val = parseInt(m[1], 10);
    const partners = m[2].split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);
    for (const p of partners) ca.push({ val, partner: p });
  }
}
console.log(`\nSeleucid core_attitudes entries: ${ca.length}`);
const caHist = {};
for (const r of ca) caHist[r.val] = (caHist[r.val]||0)+1;
console.log(`  attitude-value histogram: ${JSON.stringify(caHist)}`);

console.log(`\nSeleucid player-zone class histogram from save: {1:10, 2:19, 4:5, 5:81}`);
console.log(`Hypothesis check: class1(10) vs ally count(${ally.length}); class4(5) could be locked-ally/protectorate`);
