// dig-chartail10.js — what is +18 across many save sources, ALL LAYOUT_A
// chars with non-sentinel +18?

const fs = require("fs");
const path = require("path");
const cp = require("../../src/characterParser.js");

const MOD = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS beta/data";
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8")
  .split(/\r?\n/).map(s => s.trim());
const traitNames = [];
{
  const lines = fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/);
  for (const line of lines) {
    const tm = line.match(/^Trait\s+(\S+)/);
    if (tm) traitNames.push(tm[1]);
  }
}

for (const f of ["save_rome7.sav", "save_Autosave   Sparta   Turn 5 Start.sav",
                 "save_Autosave   Athens   Turn 22 End.sav"]) {
  const buf = fs.readFileSync(path.join(SAVES, f));
  const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
  const aChars = recs.filter(r => r.lastName);
  let nonSentinel = 0;
  const distrib = new Map();
  for (const r of aChars) {
    const v = buf.readUInt32LE(r.offset + 18);
    if (v !== 0xffffffff) nonSentinel++;
    distrib.set(v, (distrib.get(v) || 0) + 1);
  }
  console.log(`\n## ${f}: ${aChars.length} LAYOUT_A chars, ${nonSentinel} non-sentinel at +18`);
  const sorted = [...distrib.entries()].filter(([k]) => k !== 0xffffffff).sort((a, b) => b[1] - a[1]).slice(0, 15);
  for (const [v, c] of sorted) {
    console.log(`  +18 = ${v}  (${nameLookup[v] || "?"})  ${c}x`);
  }
}
