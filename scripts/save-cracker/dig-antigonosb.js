// Find AntigonosB in characterExtras and check his coords + portrait
const fs = require("fs");
const { parseCharacterExtras, attachMapCoords, resolvePortraitsByCharacter, bridgeV1Traits } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const buf = fs.readFileSync("C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav");
const chars = parseCharacterExtras(buf);
attachMapCoords(buf, chars);
const portraitsByOwn = resolvePortraitsByCharacter(buf, chars);

console.log(`total extras: ${chars.length}`);

// Find chars with extX=0 or invalid
const invalidCoord = chars.filter(c => c.extX === 0 || c.extY === 0 || c.extX == null || c.extY == null);
console.log(`chars with extX=0 or null: ${invalidCoord.length}`);

// Show the role/culture distribution of invalid-coord chars
const byRoleCulture = new Map();
for (const c of invalidCoord) {
  const k = `${c.culture}/${c.role}`;
  byRoleCulture.set(k, (byRoleCulture.get(k) || 0) + 1);
}
console.log("invalid-coord chars by role/culture:");
for (const [k, n] of [...byRoleCulture.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${k}: ${n}`);
}

// Find chars with portrait at coord (393, 391) — AntigonosB's descr_strat position
console.log("\nChars near (393, 391):");
for (const c of chars) {
  if (c.extX != null && c.extY != null && Math.abs(c.extX - 393) <= 5 && Math.abs(c.extY - 391) <= 5) {
    const p = portraitsByOwn.get(c.ownUuid);
    console.log(`  (${c.extX},${c.extY}) role=${c.role} age=${c.age} own=${c.ownUuid.toString(16)} portrait=${p?.cards || "(none)"}`);
  }
}

// Check ALL chars whose portraitCardsPath suggests they're Antigonos II (cards/old/000)
console.log("\nChars with portrait cards/old/000.tga:");
let count = 0;
for (const c of chars) {
  const p = portraitsByOwn.get(c.ownUuid);
  if (p && p.cards && p.cards.endsWith("cards/old/generals/000.tga")) {
    count++;
    if (count <= 10) {
      console.log(`  extX=${c.extX} extY=${c.extY} role=${c.role} age=${c.age} own=${c.ownUuid.toString(16)} primary=${c.primaryUuid?.toString(16) || "?"}`);
    }
  }
}
console.log(`  total: ${count}`);
