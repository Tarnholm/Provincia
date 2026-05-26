// dig-settle-crossturn-diff.js
//
// Diff the SAME settlement's stats block across two saves (consecutive turns).
// Anchors each save on the settlement name marker (marker+1 convention), then
// compares the 583-byte block (dx -584..-1) byte-by-byte and reports every dx
// that changed, with old/new values as u8/u16/u32.
//
// This is the reliable way to label dynamic fields (pop growth, PO, income,
// food, squalor, owner-on-capture) vs static fields (creator, level, UUID).
//
// Usage: node dig-settle-crossturn-diff.js "<saveA>" "<saveB>" <settlementName>

"use strict";
const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
function loadSave(arg) {
  if (fs.existsSync(arg)) return fs.readFileSync(arg);
  const p = path.join(SAVES, arg); if (fs.existsSync(p)) return fs.readFileSync(p);
  throw new Error("save not found: " + arg);
}

// Find the STATS-BLOCK occurrence of a name: the occurrence whose -583/-571/
// -435/-127/-35 reads are sane (creator<300, level<10, PO<=200, income, pop).
function findStatsBlock(buf, name) {
  const cands = [];
  for (const flag of [0x01, 0x00]) {
    const b = Buffer.alloc(3 + name.length * 2 + 2);
    b[0] = flag; b[1] = name.length; b[2] = 0;
    for (let i = 0; i < name.length; i++) { b[3 + i * 2] = name.charCodeAt(i); b[3 + i * 2 + 1] = 0; }
    let p = 0; while ((p = buf.indexOf(b, p)) !== -1) { cands.push(p + 1); p += 1; }
  }
  for (const namePos of cands.sort((a, b) => a - b)) {
    if (namePos - 583 < 0) continue;
    const rd = (dx) => buf.readUInt32LE(namePos + dx);
    const creator = buf[namePos - 583], level = rd(-571), po = rd(-435), income = rd(-127), pop = rd(-35);
    if (creator < 300 && level < 10 && po <= 200 && income < 200000 && pop >= 100 && pop < 300000) {
      return { namePos, creator, level, po, income, pop };
    }
  }
  return null;
}

const bufA = loadSave(process.argv[2]);
const bufB = loadSave(process.argv[3]);
const name = process.argv[4];

const a = findStatsBlock(bufA, name);
const b = findStatsBlock(bufB, name);
if (!a) { console.log("A: stats block not found for " + name); process.exit(1); }
if (!b) { console.log("B: stats block not found for " + name); process.exit(1); }

console.log(`=== ${name} ===`);
console.log(`A namePos=${a.namePos} creator=${a.creator} level=${a.level} PO=${a.po} income=${a.income} pop=${a.pop}`);
console.log(`B namePos=${b.namePos} creator=${b.creator} level=${b.level} PO=${b.po} income=${b.income} pop=${b.pop}`);
console.log("\nChanged bytes in block dx [-584..-1]:");
console.log("dx\tA(u8)\tB(u8)\t| A(u32@dx)\tB(u32@dx)");

for (let dx = -584; dx <= -1; dx++) {
  const oa = a.namePos + dx, ob = b.namePos + dx;
  if (oa < 0 || ob < 0) continue;
  const va = bufA[oa], vb = bufB[ob];
  if (va === vb) continue;
  // Show u32 reads anchored at this dx (when in range)
  const ua = (oa + 4 <= bufA.length) ? bufA.readUInt32LE(oa) : null;
  const ub = (ob + 4 <= bufB.length) ? bufB.readUInt32LE(ob) : null;
  console.log(`${dx}\t${va}\t${vb}\t| ${ua}\t${ub}`);
}
