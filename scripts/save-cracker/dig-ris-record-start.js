// Look BEFORE the role string for a firstName index pattern that would
// mark the start of the v1-style character record. Then check if traits
// follow at record_start + 302/304.
const fs = require("fs");
const { parseCharacterExtras } = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

// Load mod's descr_names_lookup (~6000 entries typical)
const nameLookupTxt = fs.readFileSync("C:\\RIS\\RIS\\data\\descr_names_lookup.txt", "utf8");
const nameLookup = nameLookupTxt.split(/\r?\n/).map(s => s.trim());
console.log(`nameLookup: ${nameLookup.length} entries`);

const traitsTxt = fs.readFileSync("C:\\RIS\\RIS\\data\\export_descr_character_traits.txt", "utf8");
const traitNames = ["__nontrait__"];
for (const line of traitsTxt.split(/\r?\n/)) {
  const m = line.match(/^Trait\s+(\S+)/);
  if (m) traitNames.push(m[1]);
}
console.log(`traitNames: ${traitNames.length - 1}\n`);

const chars = parseCharacterExtras(buf);
const c = chars.find(x => x.culture === "antigonid");
const idx = c.offset;

console.log(`searching for v1-style record start before role @0x${idx.toString(16)}`);
// Scan idx-500 to idx-30 for a u32 that's a valid firstName index AND
// the resulting record_start+302/304 gives a plausible traitCount
for (let back = 200; back >= 30; back -= 1) {
  const candStart = idx - back;
  if (candStart < 0) continue;
  const firstNameIdx = buf.readUInt32LE(candStart);
  if (firstNameIdx < 50 || firstNameIdx >= nameLookup.length) continue;
  const firstName = nameLookup[firstNameIdx];
  if (!firstName || firstName.length < 3) continue;
  if (firstName[0] < "A" || firstName[0] > "Z") continue;
  // Try traitCount at candStart+302 or +298
  for (const tcOff of [298, 302]) {
    if (candStart + tcOff + 2 > buf.length) continue;
    const tc = buf.readUInt16LE(candStart + tcOff);
    if (tc < 1 || tc > 50) continue;
    // Validate first trait entry
    const tsOff = tcOff + 6; // traitsStart is 6 bytes after traitCount
    const tid0 = buf.readUInt32LE(candStart + tsOff);
    if (tid0 < 1 || tid0 >= traitNames.length) continue;
    const lvl0 = buf.readUInt16LE(candStart + tsOff + 4);
    if (lvl0 < 1 || lvl0 > 100) continue;
    console.log(`STRONG CANDIDATE: record_start=0x${candStart.toString(16)} (idx-${back}) firstName=${firstName} (idx=${firstNameIdx}) tc=${tc} firstTrait=${traitNames[tid0]} level=${lvl0}`);
    // Show first 5 traits
    for (let i = 0; i < Math.min(5, tc); i++) {
      const tid = buf.readUInt32LE(candStart + tsOff + i * 8);
      const level = buf.readUInt16LE(candStart + tsOff + i * 8 + 4);
      console.log(`  [${i}] ${traitNames[tid] || "?"} (id=${tid}) level=${level}`);
    }
    return;
  }
}
console.log("no candidate found");
