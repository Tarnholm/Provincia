// Test the resolvePortraitsByCharacter function from saveCrackerExtras.js
// against save_macedon t0.sav. Expected: 103/109 greek generals resolved.

const fs = require("fs");
const { parseCharacterExtras, resolvePortraitsByCharacter } = require("../../src/saveCrackerExtras.js");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

console.log("parsing character extras...");
const characters = parseCharacterExtras(buf);
console.log(`  ${characters.length} characters`);

console.log("resolving portraits...");
const portraits = resolvePortraitsByCharacter(buf, characters);
console.log(`  ${portraits.size} characters resolved`);

console.log("\nSample (first 15):");
let n = 0;
for (const c of characters) {
  if (n >= 15) break;
  const p = portraits.get(c.ownUuid);
  if (p) {
    const num = p.cards.match(/(\d+)\.tga/)?.[1] || "??";
    console.log(`  ${c.region.padEnd(22)} age=${c.age.toString().padStart(2)} role=${c.role}  → #${num}  ${p.cards.split('/').slice(-3).join('/')}`);
  } else {
    console.log(`  ${c.region.padEnd(22)} age=${c.age.toString().padStart(2)} role=${c.role}  → (no portrait found)`);
  }
  n++;
}

// Stats per role
const byRole = {};
for (const c of characters) {
  if (!byRole[c.role]) byRole[c.role] = { total: 0, resolved: 0 };
  byRole[c.role].total++;
  if (portraits.has(c.ownUuid)) byRole[c.role].resolved++;
}
console.log("\nResolution by role:");
for (const [role, { total, resolved }] of Object.entries(byRole)) {
  console.log(`  ${role.padEnd(12)} ${resolved}/${total}`);
}
