// Run v1 characterParser on the user's save and check that:
//   1. Roman governors exist
//   2. Each has a secondaryUuid (links to unit.commanderUuid)
//   3. Each has a portrait path
const fs = require("fs");
const { findCharacterRecords, parseCharacter } = require("C:/dev/Provincia/src/characterParser.js");

const path = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav";
const buf = fs.readFileSync(path);

const recs = findCharacterRecords(buf);
const characters = recs.map(r => parseCharacter(buf, r.offset)).filter(Boolean);
console.log(`v1 characterParser: ${characters.length} chars\n`);

// Filter to roman characters
const romans = characters.filter(c => c.faction === "roman" || c.faction === "rome" || c.faction === "romans_julii" || c.faction === "rome_julii");
console.log(`roman/rome chars: ${romans.length}`);

// Show first 5 with portraits + secondaryUuid
console.log("\nFirst 5 with details:");
for (const c of characters.slice(0, 5)) {
  console.log(`  ${(c.firstName || '?').padEnd(20)} ${(c.lastName || '?').padEnd(25)} faction=${c.faction || '?'} secondaryUuid=${c.secondaryUuid ? '0x' + c.secondaryUuid.toString(16) : 'null'} portraits=${(c.portraits || []).length}`);
  if (c.portraits && c.portraits.length > 0) {
    console.log(`    [0]: ${c.portraits[0]}`);
    if (c.portraits[1]) console.log(`    [1]: ${c.portraits[1]}`);
  }
}

// Search for "Milon" and "Aulus" specifically
console.log("\nSearching for Milon/Aulus:");
for (const c of characters) {
  if (/milon/i.test(c.firstName || "") || /aulus/i.test(c.firstName || "")) {
    console.log(`  FOUND: ${c.firstName} ${c.lastName || ""} faction=${c.faction} secondaryUuid=${c.secondaryUuid ? '0x' + c.secondaryUuid.toString(16) : 'null'}`);
    if (c.portraits) {
      for (let i = 0; i < c.portraits.length; i++) console.log(`    [${i}]: ${c.portraits[i]}`);
    }
  }
}

// Check how many have non-null secondaryUuid AND non-empty portraits
const linkable = characters.filter(c => c.secondaryUuid && c.portraits && c.portraits.length > 0);
console.log(`\n${linkable.length}/${characters.length} chars have BOTH secondaryUuid and portrait[0] — these can be bridged.`);
