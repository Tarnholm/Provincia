// Run v1 character parser on the RIS save and see what chars it finds.
// Maybe v1 finds the same chars but at offsets different from the role string.
const fs = require("fs");
const { findCharacterRecords } = require("C:/dev/Provincia/src/characterParser.js");
const { parseCharacterExtras } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");
const nameLookup = fs.readFileSync("C:\\RIS\\RIS\\data\\descr_names_lookup.txt", "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames = ["__nontrait__"];
for (const line of fs.readFileSync("C:\\RIS\\RIS\\data\\export_descr_character_traits.txt", "utf8").split(/\r?\n/)) {
  const m = line.match(/^Trait\s+(\S+)/);
  if (m) traitNames.push(m[1]);
}

console.log("running v1 char parser...");
const v1 = findCharacterRecords(buf, nameLookup, traitNames, null);
console.log(`v1 found ${v1.length} chars`);

// Sample first 3 with their traits
console.log("\nFirst 3 v1 chars:");
for (const c of v1.slice(0, 3)) {
  console.log(`  ${c.firstName} ${c.lastName || ""} @0x${c.offset.toString(16)} role=${c.role} age=${c.age}`);
  console.log(`    traits (${c.traits?.length || 0}):`);
  for (const t of (c.traits || []).slice(0, 5)) {
    console.log(`      • ${t.name} (level ${t.level})`);
  }
}

// Bridge: for each parseCharacterExtras char, check if there's a v1 char
// at the same approximate offset. If so, attach traits.
const ext = parseCharacterExtras(buf);
console.log(`\nparseCharacterExtras found ${ext.length} chars`);

// For each ext char, look for v1 chars near it (within +/- 500 bytes)
let matched = 0;
let unmatched = 0;
for (const c of ext.slice(0, 20)) {
  const near = v1.filter(v => Math.abs(v.offset - c.offset) < 500);
  if (near.length > 0) {
    matched++;
    if (matched <= 3) {
      console.log(`\next char @0x${c.offset.toString(16)} (${c.culture} ${c.role}) → ${near.length} v1 chars within 500 bytes:`);
      for (const n of near.slice(0, 2)) {
        console.log(`  v1 @0x${n.offset.toString(16)} (delta ${n.offset - c.offset}): ${n.firstName} ${n.lastName || ""} traits=${n.traits?.length || 0}`);
      }
    }
  } else {
    unmatched++;
  }
}
console.log(`\next chars with nearby v1: ${matched}/${matched+unmatched}`);
