// Plan: build a v1-derived coord→portrait map and verify it gives consistent
// results for known characters. If yes, the fix is: family tree uses
// v1-coord-portrait map (same as unit cards) instead of broken cracker map.
const fs = require("fs");
const path = require("path");
const savePath = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";
const modPath = "C:/RIS/RIS";
const names = fs.readFileSync(path.join(modPath, "data/descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traits = [];
for (const m of fs.readFileSync(path.join(modPath, "data/export_descr_character_traits.txt"), "utf8").matchAll(/^Trait\s+([A-Za-z0-9_]+)/gm)) traits.push(m[1]);
const { findCharacterRecords } = require("../src/characterParser.js");
const sce = require("../src/saveCrackerExtras.js");
const buf = fs.readFileSync(savePath);

const v1Records = findCharacterRecords(buf, names, traits, null);
const crackerChars = sce.parseCharacterExtras(buf);
sce.attachMapCoords(buf, crackerChars);
const crackerPortraits = sce.resolvePortraitsByCharacter(buf, crackerChars);

// Build v1 coord → best portrait (same logic as the cache builder)
function pickV1(c) {
  const isBadPath = (p) =>
    !p ||
    /\/000\.tga$/i.test(p) ||
    (!c.isDead && /\/dead\//i.test(p));
  const ports = Array.isArray(c.portraits) ? c.portraits : [];
  // Prefer the /portraits/portraits/ variant (large portrait) over /portraits/cards/ (small)
  // because the family tree shows the large portrait.
  const goodLarge = ports.find(p => !isBadPath(p) && /\/portraits\//.test(p) && !/\/cards\//.test(p));
  const goodAny = ports.find(p => !isBadPath(p));
  return goodLarge || goodAny || null;
}

const v1CoordToPortrait = new Map();
for (const c of v1Records) {
  if (c.tileX == null || c.tileY == null) continue;
  const p = pickV1(c);
  if (!p) continue;
  const k = `${c.tileX},${c.tileY}`;
  // last write wins — multiple chars per tile is rare; we don't have a discriminator
  v1CoordToPortrait.set(k, p);
}
console.log(`v1CoordToPortrait built: ${v1CoordToPortrait.size} entries`);

// Build cracker coord → portrait (the BROKEN family tree map currently used)
const crackerCoordToPortrait = new Map();
for (const cc of crackerChars) {
  if (!cc.extX || !cc.extY) continue;
  const p = crackerPortraits.get(cc.ownUuid);
  if (p && p.cards) crackerCoordToPortrait.set(`${cc.extX},${cc.extY}`, p.cards);
}
console.log(`crackerCoordToPortrait: ${crackerCoordToPortrait.size} entries`);

// Now check: for each named character, is the v1 portrait consistent with both
// what the bodyguard-swap shows AND what the family tree would show?
const targets = ["DemetriosC", "DemetriosD", "AntigonosB", "Achaios", "Attalos", "Halkyoneus", "Ameinias", "KraterosB"];
console.log("\n=== Per-character: v1's coord-mapped portrait vs cracker's coord-mapped portrait ===");
for (const c of v1Records) {
  if (!targets.includes(c.firstName)) continue;
  if (c.tileX == null) continue;
  const k = `${c.tileX},${c.tileY}`;
  const v1P = v1CoordToPortrait.get(k);
  const ccP = crackerCoordToPortrait.get(k);
  const status = v1P === ccP ? "MATCH" : "DIFFER";
  console.log(`${c.firstName} @ ${k} [${status}]`);
  console.log(`  v1 (would feed both UI paths):  ${v1P || "(none)"}`);
  console.log(`  cracker (current family tree): ${ccP || "(none)"}`);
}
