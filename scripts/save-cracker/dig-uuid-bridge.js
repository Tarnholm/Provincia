// Check if V1's primaryUuid or secondaryUuid matches parseCharacterExtras's
// ownUuid or bodyguardUuid — the bridge between the two parsers.
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

const v1 = findCharacterRecords(buf, nameLookup, traitNames, null);
const ext = parseCharacterExtras(buf);
console.log(`v1: ${v1.length}, ext: ${ext.length}`);

// Build maps of all UUIDs
const v1ByPrimary = new Map();
const v1BySecondary = new Map();
for (const c of v1) {
  if (c.primaryUuid && c.primaryUuid !== 0xffffffff) v1ByPrimary.set(c.primaryUuid, c);
  if (c.secondaryUuid && c.secondaryUuid !== 0xffffffff) v1BySecondary.set(c.secondaryUuid, c);
}
console.log(`v1 primaryUuids: ${v1ByPrimary.size}, secondaryUuids: ${v1BySecondary.size}`);

// Check match modes for ext chars
let matchOwnPrim = 0, matchOwnSec = 0, matchBgPrim = 0, matchBgSec = 0;
const samples = [];
for (const e of ext) {
  if (v1ByPrimary.has(e.ownUuid)) matchOwnPrim++;
  if (v1BySecondary.has(e.ownUuid)) matchOwnSec++;
  if (v1ByPrimary.has(e.bodyguardUuid)) matchBgPrim++;
  if (v1BySecondary.has(e.bodyguardUuid)) matchBgSec++;
  if (samples.length < 3 && v1BySecondary.has(e.ownUuid)) {
    const v = v1BySecondary.get(e.ownUuid);
    samples.push({ e, v });
  }
}
console.log(`match ext.ownUuid → v1.primaryUuid: ${matchOwnPrim}/${ext.length}`);
console.log(`match ext.ownUuid → v1.secondaryUuid: ${matchOwnSec}/${ext.length}`);
console.log(`match ext.bodyguardUuid → v1.primaryUuid: ${matchBgPrim}/${ext.length}`);
console.log(`match ext.bodyguardUuid → v1.secondaryUuid: ${matchBgSec}/${ext.length}`);

if (samples.length > 0) {
  console.log(`\nSample matches via ext.ownUuid → v1.secondaryUuid:`);
  for (const { e, v } of samples) {
    console.log(`  ext ${e.culture} ${e.role} ownUuid=0x${e.ownUuid.toString(16)}`);
    console.log(`  v1  ${v.firstName} ${v.lastName || ""} (${v.traits?.length || 0} traits)`);
  }
}

// Bridge by (x, y) coords
const { attachMapCoords } = require("C:/dev/Provincia/src/saveCrackerExtras.js");
attachMapCoords(buf, ext);

// Build v1 by coord
const v1ByCoord = new Map();
for (const c of v1) {
  if (c.tileX != null && c.tileY != null) {
    v1ByCoord.set(`${c.tileX},${c.tileY}`, c);
  }
}
console.log(`\nv1 chars with tile coords: ${v1ByCoord.size}`);
let coordMatches = 0;
let antigonidMatch = 0;
for (const e of ext) {
  if (e.extX == null || e.extY == null) continue;
  const k = `${e.extX},${e.extY}`;
  if (v1ByCoord.has(k)) {
    coordMatches++;
    if (e.culture === "antigonid" && antigonidMatch < 3) {
      const v = v1ByCoord.get(k);
      console.log(`\next ${e.culture} ${e.role} @(${e.extX},${e.extY}) age=${e.age} region=${e.region}`);
      console.log(`  ↓ v1 match: ${v.firstName} ${v.lastName || ""} (${v.traits?.length || 0} traits)`);
      for (const t of (v.traits || []).slice(0, 5)) {
        console.log(`    • ${t.name} (level ${t.level})`);
      }
      antigonidMatch++;
    }
  }
}
console.log(`\next ↔ v1 coord matches: ${coordMatches}/${ext.length}`);
