// dig-unitstats22.js — More exhaustive scan: across the entire Macedon corpus + Rome corpus + Alexander,
// find ANY unit with +16 > 0 (would confirm armor field is +16). If never found, mark +16 as HYPOTHESIS.

const fs = require("fs");
const path = require("path");
const { findUnitRecords } = require("../../src/unitParser.js");

function regionEnd(buf, u) {
  const len = buf.readUInt16LE(u.offset);
  const ns = u.offset + 2, ne = ns + len - 1;
  for (let q = ne + 1; q < ne + 80; q++) {
    const rlen = buf[q];
    if (rlen < 3 || rlen > 50 || buf[q + 1] !== 0) continue;
    const rs = q + 2, re = rs + rlen * 2;
    if (re + 8 > buf.length) continue;
    let ok = true;
    for (let j = rs; j < re; j += 2) {
      if (buf[j + 1] !== 0 || buf[j] < 0x20 || buf[j] > 0x7e) { ok = false; break; }
    }
    if (!ok) continue;
    return re + 4;
  }
  return -1;
}

const CORPUS = [
  ["C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z", true], // Macedon
  ["C:/dev/Provincia/calibration/archive/2026-04-21T22-49-17-100Z", true], // Other archive
  ["C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves", false],
  ["C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves", false],
];

const d16 = new Map();
const d17 = new Map();
const d19 = new Map();
const d20 = new Map();
let totalUnits = 0;
let totalFiles = 0;

for (const [dir, archive] of CORPUS) {
  if (!fs.existsSync(dir)) continue;
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".sav"));
  for (const f of files.slice(0, archive ? 30 : 10)) {  // sample 30 archive / all real
    try {
      const buf = fs.readFileSync(path.join(dir, f));
      const units = findUnitRecords(buf);
      totalFiles++;
      for (const u of units) {
        const rE = regionEnd(buf, u);
        if (rE < 0) continue;
        totalUnits++;
        d16.set(buf[rE+16], (d16.get(buf[rE+16]) || 0) + 1);
        d17.set(buf[rE+17], (d17.get(buf[rE+17]) || 0) + 1);
        d19.set(buf[rE+19], (d19.get(buf[rE+19]) || 0) + 1);
        d20.set(buf[rE+20], (d20.get(buf[rE+20]) || 0) + 1);
      }
    } catch (e) { /* skip */ }
  }
}

console.log(`Scanned ${totalFiles} files, ${totalUnits} unit records`);

console.log(`\n+16 (armor?) distribution:`);
for (const [v, c] of [...d16.entries()].sort((a,b)=>a[0]-b[0]).slice(0, 12)) {
  console.log(`  +16=${v}: ${c}`);
}
console.log(`\n+17 (weapon?) distribution:`);
for (const [v, c] of [...d17.entries()].sort((a,b)=>a[0]-b[0]).slice(0, 12)) {
  console.log(`  +17=${v}: ${c}`);
}
console.log(`\n+19 (morale?) distribution:`);
for (const [v, c] of [...d19.entries()].sort((a,b)=>a[0]-b[0]).slice(0, 20)) {
  console.log(`  +19=${v}: ${c}`);
}
console.log(`\n+20 (XP) distribution:`);
for (const [v, c] of [...d20.entries()].sort((a,b)=>a[0]-b[0]).slice(0, 16)) {
  console.log(`  +20=${v}: ${c}`);
}
