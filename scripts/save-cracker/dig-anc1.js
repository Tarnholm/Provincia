// dig-anc1.js — exploration of where ancillaries live
// Strategy: do whole-file diff between rome5 (same turn baseline) saves and
// see what shape of data exists around character records that is NOT the
// trait block. Also probe specifically for the ANCILLARY_UNIT section by
// finding section signatures that hold per-character ancillary lists.

const fs = require("fs");
const path = require("path");
const cp = require("../../src/characterParser.js");
const MOD = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS beta/data";
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames = [];
for (const line of fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/)) {
  const tm = line.match(/^Trait\s+(\S+)/); if (tm) traitNames.push(tm[1]);
}
// Load ancillary names (numbered by file order)
const ancNames = [];
for (const line of fs.readFileSync(path.join(MOD, "export_descr_ancillaries.txt"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^Ancillary\s+(\S+)/); if (m) ancNames.push(m[1]);
}
console.log("Loaded "+nameLookup.length+" names, "+traitNames.length+" traits, "+ancNames.length+" ancillaries");

const buf5 = fs.readFileSync(path.join(SAVES, "save_rome5..sav"));
const buf6 = fs.readFileSync(path.join(SAVES, "save_rome6.sav"));
const buf7 = fs.readFileSync(path.join(SAVES, "save_rome7.sav"));

// Find Drusus in each
function findD(buf) {
  const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
  return recs.find(r => r.firstName==='Marcus' && (r.lastName||'').toLowerCase().includes('drusus'));
}
const d5 = findD(buf5);
const d6 = findD(buf6);
const d7 = findD(buf7);
console.log("rome5: 0x"+d5.offset.toString(16)+" tc="+(buf5.readUInt16LE(d5.offset+302)));
console.log("rome6: 0x"+d6.offset.toString(16)+" tc="+(buf6.readUInt16LE(d6.offset+302)));
console.log("rome7: 0x"+d7.offset.toString(16)+" tc="+(buf7.readUInt16LE(d7.offset+302)));

// Compare byte-by-byte the record contents for matching-size pair rome5/rome6 (same turn)
const tc5 = buf5.readUInt16LE(d5.offset+302);
const recSize5 = 308 + tc5*8; // up to portrait
console.log("Record body length (to end of trait block): "+recSize5);
let diffs=[];
for(let i=-50;i<recSize5+300;i++){
  if(buf5[d5.offset+i] !== buf6[d6.offset+i]) diffs.push(i);
}
console.log("rome5↔rome6 diffs within Drusus record (-50..+"+(recSize5+300)+"): "+diffs.length);
if(diffs.length<50) console.log("offsets:", diffs.slice(0,40).join(","));

// Same-turn baseline — rome5 vs rome6 should be near-identical for static fields
