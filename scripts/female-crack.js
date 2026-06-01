// Crack female gender. Run the REAL parser (no false positives), cross-ref each
// record's TRUE gender from descr_strat (by first name), and tally the raw
// gender byte (+4) + other candidate fields by true gender to find the real
// male/female discriminator.
"use strict";
const fs = require("fs");
const path = require("path");
const { findCharacterRecords } = require("../src/characterParser.js");
const MOD = "C:/RIS/RIS/data";
const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_julii1.sav";

const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames = [];
for (const m of fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").matchAll(/^Trait\s+(\w+)/gm)) traitNames.push(m[1]);
const stratText = fs.readFileSync(path.join(MOD, "world/maps/campaign/imperial_campaign/descr_strat.txt"), "utf8");
const genderByName = new Map();
for (const m of stratText.matchAll(/^character_record\s+([^,]+?),\s*(male|female)\b/gm)) {
  genderByName.set(m[1].trim().split(/\s+/)[0], m[2]);
}
const buf = fs.readFileSync(SAVE);
const recs = findCharacterRecords(buf, nameLookup, traitNames, null);
console.log(`real parser found ${recs.length} records; strat has ${[...genderByName.values()].filter(g=>g==="female").length} female / ${[...genderByName.values()].filter(g=>g==="male").length} male names`);

// candidate field readers (relative to record offset; layout-aware via .layoutB if present)
function fields(r) {
  const i = r.offset;
  const lb = r.layoutB || (buf.readUInt32LE(i + 5) < 50); // best-effort layout guess
  return {
    gByte: buf[i + 4],
    role: buf[i + (lb ? 38 : 42)],
    b6: buf[i + 6], b7: buf[i + 7],
    d34: buf[i + (lb ? 30 : 34)],
    secU: i >= 43 ? buf.readUInt32LE(i - 43) : 0,
  };
}

let fem = [], mal = [], unknownStrat = 0;
for (const r of recs) {
  const g = genderByName.get(r.firstName);
  if (!g) { unknownStrat++; continue; }
  (g === "female" ? fem : mal).push({ r, f: fields(r) });
}
console.log(`matched to strat gender: ${fem.length} female, ${mal.length} male (${unknownStrat} not in strat / runtime-spawned)`);

const tally = (arr, key) => { const d = {}; for (const e of arr) { const v = e.f[key]; d[v] = (d[v]||0)+1; } return d; };
for (const key of ["gByte", "role", "b6", "b7", "d34"]) {
  console.log(`\n=== ${key} by true gender ===`);
  console.log("  female:", JSON.stringify(tally(fem, key)));
  console.log("  male:  ", JSON.stringify(tally(mal, key)));
}
// secondaryUuid presence (bodyguard) by gender
const hasBG = (arr) => arr.filter(e => e.f.secU > 0xffff && e.f.secU !== 0xffffffff).length;
console.log(`\n=== bodyguard (secU big) ===`);
console.log(`  female: ${hasBG(fem)}/${fem.length}   male: ${hasBG(mal)}/${mal.length}`);
console.log(`\nsample females:`, fem.slice(0,10).map(e=>`${e.r.firstName}(g${e.f.gByte},r${e.f.role},bg${e.f.secU>0xffff?1:0})`).join("  "));
console.log(`sample males:  `, mal.slice(0,10).map(e=>`${e.r.firstName}(g${e.f.gByte},r${e.f.role},bg${e.f.secU>0xffff?1:0})`).join("  "));
