// dig-verify-sentinel.js — check the +66..+69 == 0xFFFFFFFF "end-of-children"
// sentinel claim from reference_character_record_layout. If it holds across
// real chars, we can add it as a parser gate to reject false positives like
// Appuleius_Saturninus.

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

const chars = findCharacterRecords(buf, names, traits, null);

// For each char read u32 at the LAYOUT-appropriate +66 / +70 offset
function readSentinel(c) {
  const off = c.lastName ? 70 : 66;
  return buf.readUInt32LE(c.offset + off);
}
function readConstAt74(c) {
  const off = c.lastName ? 78 : 74;
  return buf.readUInt32LE(c.offset + off);
}

// Cross-reference: which chars are "in descr_strat" (real) vs not
const descrStrat = fs.readFileSync(path.join(modPath, "data/world/maps/campaign/imperial_campaign/descr_strat.txt"), "utf8");
const realNames = new Set();
for (const m of descrStrat.matchAll(/^character[_record]?\b[^,]*,\s*([A-Za-z_][A-Za-z0-9_]*)/gm)) {
  realNames.add(m[1]);
}
console.log(`descr_strat contains ${realNames.size} unique character names`);

let inStrat_ffff = 0, inStrat_other = 0;
let outStrat_ffff = 0, outStrat_other = 0;
const outStratSamples = [];
const inStratNonFFFFSamples = [];

// Try a stronger gate: +66/+70 == 0xFFFFFFFF OR +74/+78 == 2
let comboGate_inStratPass = 0, comboGate_inStratFail = 0;
let comboGate_outStratPass = 0, comboGate_outStratFail = 0;
const comboGate_outStratPassSamples = [];
const comboGate_inStratFailSamples = [];
for (const c of chars) {
  const s = readSentinel(c);
  const k = readConstAt74(c);
  const inStrat = realNames.has(c.firstName);
  const pass = (s === 0xFFFFFFFF) || (k === 2);
  if (inStrat) {
    if (pass) comboGate_inStratPass++;
    else { comboGate_inStratFail++; if (comboGate_inStratFailSamples.length < 5) comboGate_inStratFailSamples.push({c,s,k}); }
  } else {
    if (pass) { comboGate_outStratPass++; if (comboGate_outStratPassSamples.length < 5) comboGate_outStratPassSamples.push({c,s,k}); }
    else comboGate_outStratFail++;
  }
}
console.log("\n=== Combo gate: (+66/+70 == 0xFFFFFFFF) OR (+74/+78 == 2) ===");
console.log(`  in descr_strat passing: ${comboGate_inStratPass}, failing: ${comboGate_inStratFail}`);
console.log(`  NOT in strat passing: ${comboGate_outStratPass}, failing: ${comboGate_outStratFail}`);
console.log(`  In-strat failures (chars we'd lose):`);
for (const {c,s,k} of comboGate_inStratFailSamples) {
  console.log(`    ${c.firstName} ${c.lastName||""} age=${c.age} layout=${c.lastName?"A":"B"} off=0x${c.offset.toString(16)} sentinel=0x${s.toString(16)} const74=0x${k.toString(16)}`);
}
console.log(`  Out-strat passes (chars we'd keep — false-positives among these?):`);
for (const {c,s,k} of comboGate_outStratPassSamples) {
  console.log(`    ${c.firstName} ${c.lastName||""} age=${c.age} layout=${c.lastName?"A":"B"} off=0x${c.offset.toString(16)} sentinel=0x${s.toString(16)} const74=0x${k.toString(16)}`);
}

for (const c of chars) {
  const s = readSentinel(c);
  const inStrat = realNames.has(c.firstName);
  const ffff = s === 0xFFFFFFFF;
  if (inStrat) {
    if (ffff) inStrat_ffff++; else { inStrat_other++; if (inStratNonFFFFSamples.length < 8) inStratNonFFFFSamples.push({ c, s }); }
  } else {
    if (ffff) outStrat_ffff++; else { outStrat_other++; if (outStratSamples.length < 8) outStratSamples.push({ c, s }); }
  }
}

console.log(`\n=== Sentinel-vs-descr_strat cross-tab ===`);
console.log(`  Chars in descr_strat with +66/+70 = 0xFFFFFFFF: ${inStrat_ffff}`);
console.log(`  Chars in descr_strat with OTHER value:          ${inStrat_other}`);
console.log(`  Chars NOT in descr_strat with 0xFFFFFFFF:       ${outStrat_ffff}`);
console.log(`  Chars NOT in descr_strat with OTHER value:      ${outStrat_other}`);

console.log(`\n=== Sample: chars in descr_strat WITHOUT the sentinel (potential false negatives if we gate on it) ===`);
for (const { c, s } of inStratNonFFFFSamples) {
  console.log(`  ${c.firstName} ${c.lastName||""} age=${c.age} traits=${(c.traits||[]).length} layout=${c.lastName?"A":"B"} off=0x${c.offset.toString(16)} sentinel=0x${s.toString(16)}`);
}

console.log(`\n=== Sample: chars NOT in descr_strat WITHOUT the sentinel (would be filtered by gate) ===`);
for (const { c, s } of outStratSamples) {
  console.log(`  ${c.firstName} ${c.lastName||""} age=${c.age} traits=${(c.traits||[]).length} layout=${c.lastName?"A":"B"} off=0x${c.offset.toString(16)} sentinel=0x${s.toString(16)}`);
}
