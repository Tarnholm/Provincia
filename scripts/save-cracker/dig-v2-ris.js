// Run V2 char parser on the user's RIS save and see how many chars + traits
// it extracts.
const fs = require("fs");
const { findScriptedCharacters } = require("C:/dev/Provincia/src/characterParserV2.js");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

// Load lookup tables
const nameLookup = fs.readFileSync("C:\\RIS\\RIS\\data\\descr_names_lookup.txt", "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames = ["__nontrait__"];
for (const line of fs.readFileSync("C:\\RIS\\RIS\\data\\export_descr_character_traits.txt", "utf8").split(/\r?\n/)) {
  const m = line.match(/^Trait\s+(\S+)/);
  if (m) traitNames.push(m[1]);
}
console.log(`nameLookup: ${nameLookup.length}, traitNames: ${traitNames.length}`);

const v2 = findScriptedCharacters(buf, nameLookup, traitNames);
console.log(`V2 found ${v2.length} chars\n`);

// Show factions distribution
const byFaction = new Map();
for (const c of v2) {
  byFaction.set(c.faction || "(none)", (byFaction.get(c.faction || "(none)") || 0) + 1);
}
console.log("V2 chars by faction:");
for (const [f, n] of Array.from(byFaction.entries()).sort((a, b) => b[1] - a[1]).slice(0, 30)) {
  console.log(`  ${f}: ${n}`);
}

// Stats on traits
const withTraits = v2.filter(c => c.traits && c.traits.length > 0).length;
console.log(`\nchars with at least 1 trait: ${withTraits}/${v2.length}`);

// Show first 3 V2 chars with their traits
console.log("\nFirst 3 chars with traits:");
let shown = 0;
for (const c of v2) {
  if (!c.traits || c.traits.length === 0) continue;
  if (shown >= 3) break;
  console.log(`\n  ${c.firstName} ${c.lastName || ""} (${c.faction})`);
  console.log(`    commanderUuid=0x${c.commanderUuid?.toString(16) || "?"} (${c.traits.length} traits)`);
  for (const t of c.traits) {
    console.log(`      • ${t.name} (level ${t.level})`);
  }
  shown++;
}
