// Find character whose primary or secondary uuid is 0xcda44c06 (06 4c a4 cd)
const fs = require("fs");
const path = require("path");
const cp = require("../../src/characterParser.js");

const MOD = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS beta/data";
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8")
  .split(/\r?\n/).map(s => s.trim());
const traitNames = [];
{
  const lines = fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/);
  for (const line of lines) {
    const tm = line.match(/^Trait\s+(\S+)/);
    if (tm) traitNames.push(tm[1]);
  }
}

const buf = fs.readFileSync(path.join(SAVES, "save_rome5..sav"));
const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);

// search for 0xcda44c06 as primary or secondary uuid
const target = 0xcda44c06;
const matchPri = recs.filter(r => r.primaryUuid === target);
const matchSec = recs.filter(r => r.secondaryUuid === target);
console.log(`primary matches: ${matchPri.length}`);
matchPri.forEach(r => console.log(`  @0x${r.offset.toString(16)} ${r.firstName} ${r.lastName||""} age=${r.age} t=${r.traits.length}`));
console.log(`secondary matches: ${matchSec.length}`);
matchSec.forEach(r => console.log(`  @0x${r.offset.toString(16)} ${r.firstName} ${r.lastName||""} age=${r.age} t=${r.traits.length}`));

// Where does 06 4c a4 cd appear in this save?
const needle = Buffer.from([0x06, 0x4c, 0xa4, 0xcd]);
let i = 0;
const hits = [];
while ((i = buf.indexOf(needle, i)) !== -1) {
  hits.push(i);
  i++;
}
console.log(`\n06 4c a4 cd appears at ${hits.length} positions:`);
for (const h of hits.slice(0, 20)) {
  console.log(`  0x${h.toString(16)}`);
}

// For each hit, see if there's a character record nearby
console.log("\nChecking for character records near each hit:");
for (const h of hits.slice(0, 20)) {
  // Could be primaryUuid at -47 or secondaryUuid at -43, so candidate record offsets are h+47 or h+43
  const cand1 = recs.find(r => Math.abs(r.offset - (h + 47)) < 8);
  const cand2 = recs.find(r => Math.abs(r.offset - (h + 43)) < 8);
  const cand3 = recs.find(r => r.offset === h); // record start itself
  if (cand1) console.log(`  hit 0x${h.toString(16)}: rec @ +47 = ${cand1.firstName} ${cand1.lastName||""} @0x${cand1.offset.toString(16)}`);
  else if (cand2) console.log(`  hit 0x${h.toString(16)}: rec @ +43 = ${cand2.firstName} ${cand2.lastName||""} @0x${cand2.offset.toString(16)}`);
  else if (cand3) console.log(`  hit 0x${h.toString(16)}: rec @ +0 = ${cand3.firstName} ${cand3.lastName||""}`);
  else console.log(`  hit 0x${h.toString(16)}: no nearby record`);
}
