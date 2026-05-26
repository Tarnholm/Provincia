// Verify parseCharacterExtras fix on Macedon T0 RIS save.
const fs = require("fs");
const { parseCharacterExtras } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");
const chars = parseCharacterExtras(buf);
console.log(`total chars: ${chars.length}`);
const byCulture = {};
for (const c of chars) {
  byCulture[c.culture] = (byCulture[c.culture] || 0) + 1;
}
console.log("by culture:");
for (const [k, v] of Object.entries(byCulture).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(20)} ${v}`);
}
// Sample antigonid generals (the player's faction in Macedon T0 RIS)
const antigonid = chars.filter(c => c.culture === "antigonid");
console.log(`\nantigonid characters (${antigonid.length}):`);
for (const c of antigonid.slice(0, 10)) {
  console.log(`  uuid=${c.ownUuid.toString(16).padStart(8,"0")} role=${c.role.padEnd(8)} age=${c.age} region="${c.region}" married=${c.isMarried}`);
}
