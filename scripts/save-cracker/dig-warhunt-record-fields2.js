// dig-warhunt-record-fields2.js
// Correct field offsets (from dumps, base-relative):
//   base+0x00 = 200 (base attitude)
//   base+0x04 = live attitude (DS)   <-- 600 = WAR
//   base+0x08 = flag (0/1/2)
//   base+0x0c = counter (small)
//   base+0x10 = handle/uuid (235,260,210,745...)  <-- partner reference?
//   base-0x04 = key (13)
// Dump all att=600 records with these fields + look for any field == a faction id.
"use strict";
const fs = require("fs");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const save = process.argv[2] || "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav";
const buf = fs.readFileSync(SAVES_DIR + save);
const lo = parseInt(process.argv[3] || "0x8000", 16);
const hi = parseInt(process.argv[4] || "0x3f000", 16);

const recs = [];
for (let o = lo; o + 0x14 <= hi; o++) {
  if (buf.readUInt32LE(o) !== 200) continue;
  const att = buf.readUInt32LE(o + 4);
  if (![0,100,200,400,600,850,1000].includes(att)) continue;
  if (buf.readUInt32LE(o - 4) !== 13) continue;
  recs.push({
    base: o, att,
    flag: buf.readUInt32LE(o + 8),
    counter: buf.readUInt32LE(o + 0x0c),
    h10: buf.readUInt32LE(o + 0x10),
    h14: buf.readUInt32LE(o + 0x14),
  });
}
console.log(`${save}: ${recs.length} key=13 records`);
const w = recs.filter(r => r.att === 600);
console.log(`\natt=600 records (${w.length}):  base / flag / counter / h10 / h14`);
for (const r of w) {
  console.log(`  0x${r.base.toString(16)}  flag=${r.flag} counter=${r.counter} h10=${r.h10} h14=${r.h14}`);
}
// histogram of h10 across all records to understand its space
const h10set = {};
for (const r of recs) h10set[r.h10] = (h10set[r.h10]||0)+1;
const keys = Object.keys(h10set).map(Number).sort((a,b)=>a-b);
console.log(`\nh10 value range: ${keys[0]}..${keys[keys.length-1]}, distinct=${keys.length}`);
