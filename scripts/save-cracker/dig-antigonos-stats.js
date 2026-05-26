// Find Antigonos II Gonatas in Macedon T0 RIS save via v1 parser.
// Expected stats from in-game: 7 command, 6 influence, 5 management.
// Verify the v1 parser's session-91 stat block reading.
const fs = require("fs");
const { findCharacterRecords } = require("C:/dev/Provincia/src/characterParser.js");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");
const nameLookup = fs.readFileSync("C:\\RIS\\RIS\\data\\descr_names_lookup.txt", "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames = ["__nontrait__"];
for (const line of fs.readFileSync("C:\\RIS\\RIS\\data\\export_descr_character_traits.txt", "utf8").split(/\r?\n/)) {
  const m = line.match(/^Trait\s+(\S+)/);
  if (m) traitNames.push(m[1]);
}

const v1 = findCharacterRecords(buf, nameLookup, traitNames, null);
console.log(`v1 found ${v1.length} chars`);

// Find Antigonos. RIS descr_strat uses naming like "AntigonosB" → display "Antigonos II"
const antigonos = v1.filter(c =>
  /antigonos/i.test(c.firstName) && c.firstName !== "Antigonos"
);
console.log(`\nAntigonos variants found: ${antigonos.length}`);
for (const c of antigonos) {
  console.log(`\n${c.firstName} ${c.lastName || ""}`);
  console.log(`  age=${c.age} role=${c.role} faction=${c.faction || "?"}`);
  console.log(`  tile=(${c.tileX || "?"}, ${c.tileY || "?"})`);
  console.log(`  STATS: management=${c.management}  command=${c.command}  influence=${c.influence}  loyalty=${c.loyalty}`);
  console.log(`  traits (${c.traits?.length || 0}):`);
  for (const t of (c.traits || []).slice(0, 8)) console.log(`    • ${t.name} (level ${t.level})`);
  if (c.traits?.length > 8) console.log(`    ... +${c.traits.length - 8} more`);
}

// Pella is at... need to find. Search ALL chars at tiles near where Pella might be.
// Show first 5 chars with traits to confirm parser works
console.log("\n=== First 5 chars with traits ===");
let shown = 0;
for (const c of v1) {
  if (!c.traits || c.traits.length === 0) continue;
  if (shown >= 5) break;
  console.log(`  ${c.firstName} ${c.lastName || ""} mgmt=${c.management} cmd=${c.command} inf=${c.influence}`);
  shown++;
}
