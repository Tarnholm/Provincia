// dig-unitstats21.js — Check older save corpus (rome10, Macedon Turn 97-99) for armor-upgrades.
// If any unit has +16 > 0 there, that confirms +16 is armor_lvl.

const fs = require("fs");
const path = require("path");
const { findUnitRecords } = require("../../src/unitParser.js");

const FILES = [
  ["C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves", "save_rome10.sav"],
  ["C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves", "save_Autosave   Republic of Rome   Turn 1.sav"],
  ["C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves", "save_Autosave   Macedon   Turn 97.sav"],
  ["C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves", "save_Autosave   Macedon   Turn 98 End.sav"],
  ["C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves", "save_Autosave   Macedon   Turn 99 Start.sav"],
];

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

for (const [dir, f] of FILES) {
  const buf = fs.readFileSync(path.join(dir, f));
  const units = findUnitRecords(buf);
  console.log(`\n=== ${f} (${units.length} units) ===`);
  // Distribution of +16, +17, +20
  const d16 = new Map(), d17 = new Map(), d19 = new Map(), d20 = new Map();
  for (const u of units) {
    const rE = regionEnd(buf, u);
    if (rE < 0) continue;
    d16.set(buf[rE+16], (d16.get(buf[rE+16]) || 0) + 1);
    d17.set(buf[rE+17], (d17.get(buf[rE+17]) || 0) + 1);
    d19.set(buf[rE+19], (d19.get(buf[rE+19]) || 0) + 1);
    d20.set(buf[rE+20], (d20.get(buf[rE+20]) || 0) + 1);
  }
  const sd = m => [...m.entries()].sort((a,b)=>a[0]-b[0]).slice(0, 12).map(([v,c])=>`${v}=${c}`).join(", ");
  console.log(`  +16 (armor?): ${sd(d16)}`);
  console.log(`  +17 (weapon?): ${sd(d17)}`);
  console.log(`  +19 (morale?): ${sd(d19)}`);
  console.log(`  +20 (XP):     ${sd(d20)}`);

  // Show units with non-zero +16 (armor)
  let s16 = 0;
  for (const u of units) {
    if (s16 >= 10) break;
    const rE = regionEnd(buf, u);
    if (rE < 0) continue;
    if (buf[rE + 16] > 0) {
      console.log(`    +16=${buf[rE+16]} ${u.name} @ ${u.region} +17=${buf[rE+17]} +19=${buf[rE+19]} +20=${buf[rE+20]}`);
      s16++;
    }
  }
  let s17 = 0;
  for (const u of units) {
    if (s17 >= 10) break;
    const rE = regionEnd(buf, u);
    if (rE < 0) continue;
    if (buf[rE + 17] > 0) {
      console.log(`    +17=${buf[rE+17]} ${u.name} @ ${u.region} +16=${buf[rE+16]} +19=${buf[rE+19]} +20=${buf[rE+20]}`);
      s17++;
    }
  }
  let s20 = 0;
  for (const u of units) {
    if (s20 >= 10) break;
    const rE = regionEnd(buf, u);
    if (rE < 0) continue;
    if (buf[rE + 20] >= 3) {
      console.log(`    +20=${buf[rE+20]} ${u.name} @ ${u.region} +16=${buf[rE+16]} +17=${buf[rE+17]} +19=${buf[rE+19]}`);
      s20++;
    }
  }
}
