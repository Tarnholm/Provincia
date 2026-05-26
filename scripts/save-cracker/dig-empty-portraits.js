// dig-empty-portraits.js — characters where v1 finds the record but
// portraits[] is empty. Hypothesis: the portrait-pstr search bails early
// for chars with no ancillaries (so the parser never scans past traits).

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
const targetNames = new Set(["Neoptolemos", "Artemios", "Paterinos", "Kleitos", "Apollodoros", "Paramonos", "Abantidas", "Admatos", "Philotas", "Deukalos", "Polyperchon", "Baias", "Choirilos", "Agis", "Akylos", "Timarchos", "Andromachos", "Euthydemos", "Nearchos", "SeleukosB"]);

const hits = chars.filter(c => targetNames.has(c.firstName));
console.log(`Found ${hits.length} target characters\n`);

for (const c of hits.slice(0, 5)) {
  console.log(`\n=== ${c.firstName} ${c.lastName || ""} age=${c.age} traits=${(c.traits||[]).length} ancillaries=${(c.ancillaries||[]).length} portraitsCount=${(c.portraits||[]).length} ===`);
  console.log(`  offset = 0x${c.offset.toString(16)}, tileX=${c.tileX}, tileY=${c.tileY}, secondaryUuid=0x${(c.secondaryUuid||0).toString(16)}`);
  console.log(`  portraits = [${(c.portraits||[]).join(", ")}]`);

  // Scan +0 to +1024 of this record for pstr16 portrait strings
  console.log(`  Scanning record [+0..+1024] for pstr16 strings matching /portraits/:`);
  for (let i = 0; i < 1024 && c.offset + i + 2 < buf.length; i++) {
    const len = buf.readUInt16LE(c.offset + i);
    if (len < 10 || len > 200) continue;
    const start = c.offset + i + 2;
    if (start + len > buf.length) continue;
    // Check it's printable ASCII
    let valid = true;
    let s = "";
    for (let j = 0; j < len; j++) {
      const b = buf[start + j];
      if (b < 0x20 || b > 0x7e) { valid = false; break; }
      s += String.fromCharCode(b);
    }
    if (!valid) continue;
    if (/portraits/i.test(s) || /\.tga/i.test(s)) {
      console.log(`    @+${i} (len=${len}): "${s}"`);
    }
  }
}

// Also check: total breakdown of why portraits[] is empty
const withTraits = chars.filter(c => (c.traits||[]).length > 0);
const emptyPortraits = chars.filter(c => (c.portraits||[]).length === 0);
const emptyPortraitsWithTraits = emptyPortraits.filter(c => (c.traits||[]).length > 0);
console.log(`\n\n=== Population analysis ===`);
console.log(`Total v1 chars: ${chars.length}`);
console.log(`Chars with at least 1 trait: ${withTraits.length}`);
console.log(`Chars with portraits.length === 0: ${emptyPortraits.length}`);
console.log(`Chars with empty portraits BUT >=1 trait: ${emptyPortraitsWithTraits.length}`);

// Sample of empty-portrait chars to see patterns
console.log(`\nSample of 10 empty-portrait chars:`);
for (const c of emptyPortraits.slice(0, 10)) {
  console.log(`  ${c.firstName} ${c.lastName||""} age=${c.age} traits=${(c.traits||[]).length} ancil=${(c.ancillaries||[]).length} layout=${c.lastName?"A":"B"} dead=${c.isDead} off=0x${c.offset.toString(16)}`);
}
