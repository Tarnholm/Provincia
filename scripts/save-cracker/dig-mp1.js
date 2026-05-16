// dig-mp1.js — locate Manius Aemilius Paullus in both saves and diff bytes.
//
// Controlled experiment:
//   before: y=425   after: y=424   single 1-tile vertical move
//   sizes differ by 10 bytes (before is larger)

"use strict";
const fs = require("fs");
const path = require("path");
const PROVINCIA_SRC = path.resolve(__dirname, "../../src");
const { findCharacterRecords } = require(path.join(PROVINCIA_SRC, "characterParser.js"));

const BEFORE = "C:/Users/vtarn/Downloads/save_mp_before.sav";
const AFTER  = "C:/Users/vtarn/Downloads/save_mp_after.sav";

const MOD = "C:/RIS/RIS/data";
function loadNames() { return fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim()); }
function loadTraits() {
  const lines = fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/);
  const out = [];
  for (const l of lines) { const m = l.match(/^Trait\s+(\S+)/); if (m) out.push(m[1]); }
  return out;
}

const names = loadNames();
const traits = loadTraits();
const bufB = fs.readFileSync(BEFORE);
const bufA = fs.readFileSync(AFTER);
console.log("before:", bufB.length, "after:", bufA.length, "delta:", bufB.length - bufA.length);

// Find by first+last name. Manius is the firstName, Aemilius_Paullus is likely the surname token.
// We'll do broad scan and filter by name.
const charsB = findCharacterRecords(bufB, names, traits, null);
const charsA = findCharacterRecords(bufA, names, traits, null);
console.log("characters: before=", charsB.length, "after=", charsA.length);

function find(chars, first, lastMatcher) {
  return chars.filter(c => c.firstName === first && (lastMatcher === null || (c.lastName && lastMatcher.test(c.lastName))));
}

// Try different surname spellings
for (const lastRx of [/aemilius/i, /paullus/i, /aemilius_paullus/i, /Aemilius/]) {
  const hitsB = find(charsB, "Manius", lastRx);
  const hitsA = find(charsA, "Manius", lastRx);
  console.log(`\nmatch firstName=Manius lastName=${lastRx}: before=${hitsB.length} after=${hitsA.length}`);
  for (const h of hitsB.slice(0, 5)) console.log("  B:", h.offset.toString(16), h.firstName, h.lastName, "age", h.age, "uuid", h.primaryUuid?.toString(16), h.secondaryUuid?.toString(16));
  for (const h of hitsA.slice(0, 5)) console.log("  A:", h.offset.toString(16), h.firstName, h.lastName, "age", h.age, "uuid", h.primaryUuid?.toString(16), h.secondaryUuid?.toString(16));
}

// Also: list all "Manius" chars
const allManiusB = charsB.filter(c => c.firstName === "Manius");
const allManiusA = charsA.filter(c => c.firstName === "Manius");
console.log("\nAll Manius chars (before):");
for (const h of allManiusB) console.log("  B:", h.offset.toString(16), h.firstName, h.lastName, "age", h.age);
console.log("\nAll Manius chars (after):");
for (const h of allManiusA) console.log("  A:", h.offset.toString(16), h.firstName, h.lastName, "age", h.age);
