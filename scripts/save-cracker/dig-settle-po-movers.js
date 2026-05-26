// dig-settle-po-movers.js — find settlements whose PO changes between two saves.
// Usage: node dig-settle-po-movers.js "<saveA>" "<saveB>"
"use strict";
const { loadSave, findStatsBlock } = require("./dig-settle-lib");
const { findAllSettlementMarkers } = require("../../src/buildingParser");
const bufA = loadSave(process.argv[2]);
const bufB = loadSave(process.argv[3]);
const names = [...new Set(findAllSettlementMarkers(bufA).map(m => m.name))];
const rows = [];
for (const n of names) {
  const a = findStatsBlock(bufA, n), b = findStatsBlock(bufB, n);
  if (!a || !b) continue;
  rows.push({ n, poA: a.po, poB: b.po, dPO: b.po - a.po, popA: a.pop, popB: b.pop, dpop: b.pop - a.pop, incA: a.income, incB: b.income });
}
rows.sort((x, y) => Math.abs(y.dPO) - Math.abs(x.dPO));
console.log("name\t\tPO_A\tPO_B\tdPO\tpop_A\tpop_B\tdpop");
for (const r of rows) {
  if (r.poA > 100 || r.poB > 100) continue; // skip misaligned PO
  if (r.dPO === 0 && r.dpop === 0) continue;
  console.log(`${r.n.padEnd(16)}\t${r.poA}\t${r.poB}\t${r.dPO}\t${r.popA}\t${r.popB}\t${r.dpop}`);
}
