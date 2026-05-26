// dig-94-age.js — verify hypothesis: u16 at +94..+95 = age in years (LAYOUT_B)
"use strict";
const fs = require("fs");
const path = require("path");
const savePath = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";
const modPath = "C:/RIS/RIS";
const names = fs.readFileSync(path.join(modPath, "data/descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traits = [];
for (const m of fs.readFileSync(path.join(modPath, "data/export_descr_character_traits.txt"), "utf8").matchAll(/^Trait\s+([A-Za-z0-9_]+)/gm)) traits.push(m[1]);
const { findCharacterRecords } = require("../../src/characterParser.js");
const buf = fs.readFileSync(savePath);
const chars = findCharacterRecords(buf, names, traits, null).filter(c => c.age != null && c.age > 0);

let matches = 0, total = 0;
const mismatches = [];
for (const c of chars) {
  const shift = c.lastName ? 4 : 0;
  const off94 = c.offset + 94 + shift;
  if (off94 + 2 > buf.length) continue;
  const v94 = buf.readUInt16LE(off94);
  total++;
  if (v94 === c.age) matches++;
  else if (mismatches.length < 12) mismatches.push({ name: c.firstName, age: c.age, v94, layout: c.lastName?"A":"B" });
}
console.log(`+94..+95 == age in years: ${matches}/${total} = ${(matches*100/total).toFixed(1)}%`);
console.log("Sample mismatches:");
for (const m of mismatches) console.log(`  ${m.name} age=${m.age} v94=${m.v94} layout=${m.layout}`);

// Also try +96..+97
let matches96 = 0;
for (const c of chars) {
  const shift = c.lastName ? 4 : 0;
  const off = c.offset + 96 + shift;
  if (off + 2 > buf.length) continue;
  if (buf.readUInt16LE(off) === c.age) matches96++;
}
console.log(`\n+96..+97 == age: ${matches96}/${total}`);

// And +92..+93
let matches92 = 0;
for (const c of chars) {
  const shift = c.lastName ? 4 : 0;
  const off = c.offset + 92 + shift;
  if (off + 2 > buf.length) continue;
  if (buf.readUInt16LE(off) === c.age) matches92++;
}
console.log(`+92..+93 == age: ${matches92}/${total}`);

// What about birth-year (or birth-quarter)?
// Macedon T0 = turn 1, year 270 BC. AntigonosB age 50 → born 320 BC = 320 years before "year 0".
// In RTW the year is internally an int (turn/4 + start_year).
// Let's compute expected birth-year-as-int: 270 - age, and search.
console.log("\nSearch for birth year (in BC, as int): age 50 → 320, age 16 → 286, etc.");
const yearStart = 270;
let m_y32 = 0, m_y16 = 0;
for (const c of chars) {
  const shift = c.lastName ? 4 : 0;
  const birthYear = yearStart + c.age;
  const birthYearNeg = -(yearStart + c.age);
  // Try every offset 0..298
  for (let off = 0; off < 298; off++) {
    const o = c.offset + off + shift;
    if (o + 4 > buf.length) continue;
    const v32 = buf.readInt32LE(o);
    if (v32 === birthYear || v32 === birthYearNeg) m_y32++;
    const v16 = buf.readInt16LE(o);
    if (v16 === birthYear || v16 === birthYearNeg) m_y16++;
  }
}
console.log(`  Total u32 matches anywhere in record: ${m_y32}`);
console.log(`  Total u16 matches anywhere in record: ${m_y16}`);
