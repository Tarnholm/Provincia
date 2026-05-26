// dig-settle-owner-change.js — find settlements whose creator(-583) OR any
// small-int field changes between two saves (= ownership/capture events).
// Usage: node dig-settle-owner-change.js "<saveA>" "<saveB>"
"use strict";
const { loadSave, findStatsBlock } = require("./dig-settle-lib");
const { findAllSettlementMarkers } = require("../../src/buildingParser");
const bufA = loadSave(process.argv[2]);
const bufB = loadSave(process.argv[3]);
const names = [...new Set(findAllSettlementMarkers(bufA).map(m => m.name))];
console.log("name\tcreator_A\tcreator_B\tlvl_A\tlvl_B\tPO_A\tPO_B\tpop_A\tpop_B");
for (const n of names) {
  const a = findStatsBlock(bufA, n), b = findStatsBlock(bufB, n);
  if (!a || !b) continue;
  if (a.creator !== b.creator || a.level !== b.level) {
    console.log(`${n.padEnd(16)}\t${a.creator}\t${b.creator}\t${a.level}\t${b.level}\t${a.po}\t${b.po}\t${a.pop}\t${b.pop}  <== CHANGED`);
  }
}
console.log("(only changed rows shown)");
