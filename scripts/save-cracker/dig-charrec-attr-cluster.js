// dig-charrec-attr-cluster.js
// Examine the attribute cluster +94..+126 in detail to nail down the
// command/influence/management/loyalty + their growth-point / sentinel slots.
// RTW attributes have a (value, level-points-progress) structure. Print for a
// spread of chars including high-loyalty and high-command ones.
const fs = require("fs");
const path = require("path");
const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";
const modPath = "C:/RIS/RIS";
const names = fs.readFileSync(path.join(modPath, "data/descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames=[]; for(const m of fs.readFileSync(path.join(modPath,"data/export_descr_character_traits.txt"),"utf8").matchAll(/^Trait\s+([A-Za-z0-9_]+)/gm)) traitNames.push(m[1]);
const { findCharacterRecords } = require("../../src/characterParser.js");
const buf = fs.readFileSync(SAVE);
const v1 = findCharacterRecords(buf,names,traitNames,null);
// pick variety: leader, heir, high-command, high-loyalty, high-influence
const picks=[];
picks.push(v1.find(c=>c.isLeader));
picks.push(v1.find(c=>c.isHeir));
const byCmd=[...v1].filter(c=>c.command!=null).sort((a,b)=>b.command-a.command).slice(0,3);
const byInf=[...v1].filter(c=>c.influence!=null).sort((a,b)=>b.influence-a.influence).slice(0,2);
const byLoy=[...v1].filter(c=>c.loyalty!=null).sort((a,b)=>b.loyalty-a.loyalty).slice(0,2);
for(const c of [...byCmd,...byInf,...byLoy]) if(!picks.includes(c)) picks.push(c);

console.log(`SAVE=${path.basename(SAVE)}`);
console.log("\nFor each char: raw u32 LE at record-relative offsets 94..130 (LAYOUT_B raw; LAYOUT_A +4 applied).");
console.log("Header: cmd/inf/mgmt/loy = v1 parsed values\n");
for(const c of picks.filter(Boolean)){
  const lb=c.lastName===null; const adj=lb?0:4;
  const rd=(p)=>buf.readInt32LE(c.offset+p+adj);
  console.log(`${(c.firstName+(c.lastName?(" "+c.lastName):"")).padEnd(24)} L=${lb?"B":"A"} cmd=${c.command} inf=${c.influence} mgmt=${c.management} loy=${c.loyalty}`);
  const parts=[];
  for(let p=94;p<=126;p+=4){ parts.push(`+${p}=${rd(p)}`); }
  console.log("   "+parts.join("  "));
}
