// Look at known character (Bouzos, Eumedes, Aulus Gabinius) across MANY turns
// to see how candidate fields evolve.
const fs = require("fs");
const path = require("path");
const cp = require("../../src/characterParser.js");
const MOD = "C:/RIS/RIS/data";
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames = [];
for (const line of fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/)) {
  const tm = line.match(/^Trait\s+(\S+)/); if (tm) traitNames.push(tm[1]);
}
// Track Bouzos (LAYOUT_B) across all rome saves
const targetName = process.argv[2] || "Bouzos";
const fnames = ["save_rome1.sav","save_rome2.sav","save_rome3.sav","save_rome4.sav","save_rome5..sav","save_rome6.sav","save_rome7.sav","save_rome8.sav","save_rome9.sav","save_rome10.sav"];
console.log(`Tracking ${targetName} across ${fnames.length} rome saves`);
const offsets = [102,106,118,119,120,121,122,158,170,178,179,180,181,218,219,220,221,222,250,254,298];

for (const f of fnames) {
  let buf;
  try { buf = fs.readFileSync(path.join(SAVES, f)); } catch (e) { continue; }
  const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
  const r = recs.find(x => x.firstName === targetName);
  if (!r) { console.log(`  ${f}: MISSING`); continue; }
  const o = r.offset;
  const layout = r.lastName ? "A" : "B";
  // Adjust offsets for LAYOUT_B (-4)
  const shift = r.lastName ? 0 : -4;
  let row = `${f.padEnd(22)} L=${layout} t=${String(r.traits.length).padStart(2)} age=${String(r.age).padStart(2)} role=${r.role}`;
  for (const off of offsets) {
    const o2 = o + off + shift;
    if (o2 < 0 || o2 >= buf.length) { row += `  +${off}=??`; continue; }
    row += `  +${off}=${buf[o2]}`;
  }
  console.log(row);
}
