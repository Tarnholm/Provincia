// Find which byte offsets are CONSTANT across all named LAYOUT_B chars,
// vs which VARY per char. Constants tell us about RTW system defaults
// (sentinels, magic numbers). Varies tell us about character data.
const fs = require("fs");
const path = require("path");
const savePath = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";
const modPath = "C:/RIS/RIS";
const names = fs.readFileSync(path.join(modPath, "data/descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traits = [];
for (const m of fs.readFileSync(path.join(modPath, "data/export_descr_character_traits.txt"), "utf8").matchAll(/^Trait\s+([A-Za-z0-9_]+)/gm)) traits.push(m[1]);
const { findCharacterRecords } = require("../../src/characterParser.js");
const buf = fs.readFileSync(savePath);
const v1Records = findCharacterRecords(buf, names, traits, null);

const sample = v1Records.filter(c => c.lastName === null && c.tileX != null && (c.traits || []).length > 5).slice(0, 30);
console.log(`Sample size: ${sample.length} LAYOUT_B chars with tiles + traits`);

// For each byte offset 0..295, check if value is CONSTANT or VARIES
const constancy = []; // { offset, constant: bool, value: ? }
for (let off = 0; off < 296; off++) {
  const values = new Set();
  for (const c of sample) values.add(buf[c.offset + off]);
  constancy.push({ offset: off, constant: values.size === 1, value: values.size === 1 ? [...values][0] : null, varCount: values.size });
}

// Group by constant regions
console.log("\nByte-level constancy across 30 LAYOUT_B chars (offset 0..295):");
console.log("Showing only CONSTANT bytes (same value across all 30 chars):\n");
const constants = constancy.filter(x => x.constant);
console.log(`Total constant bytes: ${constants.length} / 296`);
// Print constants in groups
let runStart = -1, runVal = null;
for (let i = 0; i < 296; i++) {
  if (constancy[i].constant) {
    if (runStart < 0) { runStart = i; runVal = constancy[i].value; }
  } else if (runStart >= 0) {
    const runLen = i - runStart;
    if (runLen >= 4 && runVal === 0) {
      console.log(`+${runStart}..+${i-1} (${runLen} bytes of 0x00)`);
    } else if (runLen >= 2) {
      // Print bytes of the run
      const vals = [];
      for (let j = runStart; j < i; j++) vals.push(constancy[j].value.toString(16).padStart(2, "0"));
      console.log(`+${runStart}..+${i-1} (${runLen} bytes): ${vals.join(" ")}`);
    } else {
      console.log(`+${runStart}: 0x${runVal.toString(16)}`);
    }
    runStart = -1; runVal = null;
  }
}
if (runStart >= 0) {
  const runLen = 296 - runStart;
  if (runLen >= 4 && runVal === 0) console.log(`+${runStart}..+295 (${runLen} bytes of 0x00)`);
  else console.log(`+${runStart}..+295 constant`);
}

// Print VARYING ranges
console.log("\n\nVarying byte ranges (likely character-specific data):");
runStart = -1;
for (let i = 0; i < 296; i++) {
  if (!constancy[i].constant) {
    if (runStart < 0) runStart = i;
  } else if (runStart >= 0) {
    console.log(`+${runStart}..+${i-1} (${i-runStart} bytes, ${constancy[i-1].varCount} distinct mid-byte)`);
    runStart = -1;
  }
}
if (runStart >= 0) console.log(`+${runStart}..+295`);
