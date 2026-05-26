// dig-settle-occurrences.js
//
// Show EVERY name-marker occurrence of a settlement and the candidate field
// reads at the canonical stats-block offsets, so we can identify which
// occurrence is the real stats block (the one with sane PO + income + level).
//
// Usage: node dig-settle-occurrences.js "<save>" <settlementName>

"use strict";
const { loadSave, nameOccurrences } = require("./dig-settle-lib.js");

const buf = loadSave(process.argv[2]);
const name = process.argv[3];

const occs = nameOccurrences(buf, name);
console.log(`${name}: ${occs.length} marker occurrences`);
console.log("namePos(hex)\tcreator\tlevel\ttax\tPO\tincome\tpop\tpopCopy(-223)\tpop3(-524)");
for (const np of occs) {
  if (np - 583 < 0 || np + 4 > buf.length) { console.log(`0x${np.toString(16)}\t<too early/late>`); continue; }
  const u32 = (dx) => buf.readUInt32LE(np + dx);
  const creator = buf[np - 583];
  const level = u32(-571);
  const tax = buf[np - 562];
  const po = u32(-435);
  const income = u32(-127);
  const pop = u32(-35);
  const popCopy = u32(-223);
  const pop3 = u32(-524);
  console.log(`0x${np.toString(16)}\t${creator}\t${level}\t${tax}\t${po}\t${income}\t${pop}\t${popCopy}\t${pop3}`);
}
