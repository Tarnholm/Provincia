// Find a byte offset in v1's char record that contains characterExtras' ownUuid.
// That would give us a true v1 ↔ characterExtras bridge.
const fs = require("fs");
const { findCharacterRecords } = require("C:/dev/Provincia/src/characterParser.js");
const { parseCharacterExtras, attachMapCoords, resolvePortraitsByCharacter } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const buf = fs.readFileSync("C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav");
const namesPath = "C:/RIS/RIS/data/descr_names_lookup.txt";
const traitsPath = "C:/RIS/RIS/data/export_descr_character_traits.txt";
const nameLookup = fs.readFileSync(namesPath, "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames = [];
for (const line of fs.readFileSync(traitsPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^Trait\s+(\S+)/);
  if (m) traitNames.push(m[1]);
}

const v1Chars = findCharacterRecords(buf, nameLookup, traitNames, null);
const extChars = parseCharacterExtras(buf);

// Build a Set of characterExtras' ownUuids
const extOwnUuids = new Set();
for (const c of extChars) if (c.ownUuid) extOwnUuids.add(c.ownUuid);
console.log(`v1: ${v1Chars.length}, ext: ${extChars.length}, ext own uuids: ${extOwnUuids.size}`);

// For each v1 char, scan their record bytes for u32 values that match an ext ownUuid
// Probe offsets 0..200 from v1.offset. Track how often each offset hits.
const hits = new Map();
let chars_with_any_hit = 0;
for (const c of v1Chars) {
  let foundOff = null;
  for (let off = 0; off + 4 < 350 && c.offset + off + 4 < buf.length; off++) {
    const v = buf.readUInt32LE(c.offset + off);
    if (extOwnUuids.has(v)) {
      hits.set(off, (hits.get(off) || 0) + 1);
      if (foundOff == null) foundOff = off;
    }
  }
  if (foundOff != null) chars_with_any_hit++;
}
console.log(`v1 chars with at least one ext-uuid in record: ${chars_with_any_hit}/${v1Chars.length}`);
console.log("Top offsets where ext-uuid appears:");
for (const [off, n] of [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  +${off}: ${n} hits`);
}

// Pick the top offset and check uniqueness (does each v1 char point to a unique ext char?)
const topOff = [...hits.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
if (topOff != null) {
  console.log(`\nTesting v1[+${topOff}] as bridge to ext.ownUuid:`);
  const bridgedExtUuids = new Set();
  const v1ByExtUuid = new Map();
  for (const c of v1Chars) {
    if (c.offset + topOff + 4 > buf.length) continue;
    const v = buf.readUInt32LE(c.offset + topOff);
    if (extOwnUuids.has(v)) {
      bridgedExtUuids.add(v);
      if (!v1ByExtUuid.has(v)) v1ByExtUuid.set(v, []);
      v1ByExtUuid.get(v).push(c.firstName);
    }
  }
  console.log(`  unique ext uuids reached: ${bridgedExtUuids.size}/${extOwnUuids.size}`);
  const dupes = [...v1ByExtUuid.entries()].filter(([, names]) => names.length > 1);
  console.log(`  ext uuids claimed by >1 v1 char: ${dupes.length} (showing first 5):`);
  for (const [uuid, names] of dupes.slice(0, 5)) {
    console.log(`    ${uuid.toString(16)}: ${names.join(", ")}`);
  }

  // Find AntigonosB specifically
  const antig = v1Chars.find(c => c.firstName === "AntigonosB");
  if (antig && antig.offset + topOff + 4 <= buf.length) {
    const v = buf.readUInt32LE(antig.offset + topOff);
    const extChar = extChars.find(e => e.ownUuid === v);
    console.log(`\nAntigonosB v1 record +${topOff} = ${v.toString(16)} → extChar ${extChar ? "FOUND" : "not in extras"}`);
    if (extChar) {
      attachMapCoords(buf, [extChar]);
      const portraitMap = resolvePortraitsByCharacter(buf, [extChar]);
      const p = portraitMap.get(extChar.ownUuid);
      console.log(`  extChar extX=${extChar.extX} extY=${extChar.extY} portrait=${p?.cards || "(none)"}`);
    }
  }
}
