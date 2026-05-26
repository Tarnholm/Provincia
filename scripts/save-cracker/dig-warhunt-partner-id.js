// dig-warhunt-partner-id.js
// The 46 pre-existing att=600 records in Spain are faction<->slave wars (slave
// id=20 vanilla). The 2 new ones are spain(18)<->carthage(7). Find the partner
// faction id in each att=600 record by dumping a window around each and looking
// for the id. Use the head-anchored finder (base=200 + att=600).
"use strict";
const fs = require("fs");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const pre = fs.readFileSync(SAVES_DIR + "save_Autosave   Spain   Turn 4 Start.sav");
const war = fs.readFileSync(SAVES_DIR + "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav");

function find600(buf, lo, hi) {
  const out = [];
  for (let o = lo; o + 8 <= hi; o++) {
    if (buf.readUInt32LE(o) === 200 && buf.readUInt32LE(o + 4) === 600) out.push(o); // o = base offset
  }
  return out;
}
// new war records (in war but not pre, by base offset)
const preSet = new Set(find600(pre, 0x8000, 0x3f000));
const warList = find600(war, 0x8000, 0x3f000);
const newOnes = warList.filter(o => !preSet.has(o));
console.log(`pre 600-bases: ${preSet.size}, war 600-bases: ${warList.length}, new: ${newOnes.length}`);
console.log("new war 600-record base offsets:", newOnes.map(o => "0x" + o.toString(16)));

// Dump 0x30 bytes BEFORE base and 0x10 after attitude for the new records and
// for 3 pre-existing ones, looking for faction ids 7,18,20.
function dump(buf, base, label) {
  console.log(`\n--- ${label} base=0x${base.toString(16)} ---`);
  for (let r = -0x30; r < 0x18; r += 16) {
    const o = base + r; const sl = buf.slice(o, o + 16);
    const u = []; for (let j = 0; j + 4 <= sl.length; j += 4) u.push(sl.readUInt32LE(j));
    const hex = Array.from(sl).map(x => x.toString(16).padStart(2, "0")).join(" ");
    console.log(`  0x${o.toString(16)}  ${hex}  [${u.join(",")}]`);
  }
}
for (const o of newOnes) dump(war, o, "NEW (spain<->carthage)");
const preEx = [...preSet].slice(0, 3);
for (const o of preEx) dump(pre, o, "PRE-EXISTING (faction<->slave)");
