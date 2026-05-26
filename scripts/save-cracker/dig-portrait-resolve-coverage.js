// How many of the 421 chars get a portrait path resolved + map coords attached?
const fs = require("fs");
const { parseCharacterExtras, attachMapCoords, resolvePortraitsByCharacter } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const chars = parseCharacterExtras(buf);
console.log(`parseCharacterExtras: ${chars.length} chars`);

attachMapCoords(buf, chars);
const withCoords = chars.filter(c => c.extX != null);
console.log(`map coords attached: ${withCoords.length}/${chars.length}`);

const portraitMap = resolvePortraitsByCharacter(buf, chars);
console.log(`portraits resolved: ${portraitMap.size}/${chars.length}`);

// Break down resolution by culture
const stats = new Map();
for (const c of chars) {
  if (!stats.has(c.culture)) stats.set(c.culture, { total: 0, resolved: 0, withCoords: 0 });
  const s = stats.get(c.culture);
  s.total += 1;
  if (portraitMap.has(c.ownUuid)) s.resolved += 1;
  if (c.extX != null) s.withCoords += 1;
}
console.log("\nby culture (resolved / withCoords / total):");
for (const [k, v] of Array.from(stats.entries()).sort((a, b) => b[1].total - a[1].total)) {
  console.log(`  ${k.padEnd(20)}  portraits=${v.resolved.toString().padStart(3)}/${v.total.toString().padStart(3)}  coords=${v.withCoords}/${v.total}`);
}
