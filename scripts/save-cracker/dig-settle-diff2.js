// dig-settle-diff2.js
//
// Like dig-settle-crossturn-diff but uses the SCORING stats-block finder from
// dig-settle-lib so it picks the real stats block (not the first name-pool hit).
// Also reports the namePos and key fields, and annotates known fields.
//
// Usage: node dig-settle-diff2.js "<saveA>" "<saveB>" <settlementName>

"use strict";
const { loadSave, findStatsBlock } = require("./dig-settle-lib.js");

const bufA = loadSave(process.argv[2]);
const bufB = loadSave(process.argv[3]);
const name = process.argv[4];

const a = findStatsBlock(bufA, name);
const b = findStatsBlock(bufB, name);
if (!a) { console.log("A: stats block not found for " + name); process.exit(1); }
if (!b) { console.log("B: stats block not found for " + name); process.exit(1); }

const LABEL = {
  "-583": "creator/owner?", "-571": "level", "-562": "tax(u8)", "-528": "growthByte?",
  "-524": "popCopy3", "-435": "PO", "-315": "fieldX", "-311": "fieldY",
  "-223": "popCopy2", "-127": "income", "-123": "fieldZ", "-115": "POsub?",
  "-83": "fieldX'", "-79": "fieldY'", "-47": "wealth?", "-35": "population",
  "-34": "popHi", "-9": "flag2/3",
};

console.log(`=== ${name} ===`);
console.log(`A namePos=0x${a.namePos.toString(16)} creator=${a.creator} level=${a.level} tax=${a.tax} PO=${a.po} income=${a.income} pop=${a.pop} score=${a.score}`);
console.log(`B namePos=0x${b.namePos.toString(16)} creator=${b.creator} level=${b.level} tax=${b.tax} PO=${b.po} income=${b.income} pop=${b.pop} score=${b.score}`);
console.log("\nChanged bytes in block dx [-584..-1]:");
console.log("dx\tA(u8)\tB(u8)\t| A(u32)\tB(u32)\tlabel");

for (let dx = -584; dx <= -1; dx++) {
  const oa = a.namePos + dx, ob = b.namePos + dx;
  if (oa < 0 || ob < 0) continue;
  const va = bufA[oa], vb = bufB[ob];
  if (va === vb) continue;
  const ua = (oa + 4 <= bufA.length) ? bufA.readUInt32LE(oa) : null;
  const ub = (ob + 4 <= bufB.length) ? bufB.readUInt32LE(ob) : null;
  console.log(`${dx}\t${va}\t${vb}\t| ${ua}\t${ub}\t${LABEL[dx] || ""}`);
}
