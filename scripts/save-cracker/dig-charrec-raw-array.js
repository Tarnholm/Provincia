// dig-charrec-raw-array.js
// Dump the FULL raw u32 array from +90..+310 (every 4 bytes) for named chars,
// plus the byte region just before (+60..+94) and just after (+298..+330) so we
// can see the array header/terminator. Ground-truth char: AntigonosB (Antigonos
// II Gonatas) Command 7 Influence 6 Management 5 per memory.
const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
const modPath = "C:/RIS/RIS";
const names = fs.readFileSync(path.join(modPath, "data/descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames=[]; for(const m of fs.readFileSync(path.join(modPath,"data/export_descr_character_traits.txt"),"utf8").matchAll(/^Trait\s+([A-Za-z0-9_]+)/gm)) traitNames.push(m[1]);
const { findCharacterRecords } = require("../../src/characterParser.js");
const file = process.argv[2] || "save_macedon t0.sav";
const buf = fs.readFileSync(SAVES+file);
const v1 = findCharacterRecords(buf,names,traitNames,null);
const want = process.argv.slice(3);
const picks = want.length ? v1.filter(c=>want.includes(c.firstName)) : v1.filter(c=>c.isLeader||c.isHeir).slice(0,3);
for(const c of picks){
  const adj = c.lastName===null?0:4;
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${c.firstName}${c.lastName?" "+c.lastName:""}  L=${c.lastName===null?"B":"A"}  cmd=${c.command} inf=${c.influence} mgmt=${c.management} loy=${c.loyalty} traits=${(c.traits||[]).length} anc=${(c.ancillaries||[]).length}`);
  // raw u32 LE at logical offset p (LAYOUT_A adds +4)
  const rd = (p)=>{const o=c.offset+p+adj; return o+4<=buf.length?buf.readInt32LE(o):null;};
  const rdu=(p)=>{const o=c.offset+p+adj; return o+4<=buf.length?buf.readUInt32LE(o):null;};
  let line=[];
  for(let p=60;p<=310;p+=4){
    const v=rd(p);
    line.push(`+${p}=${v}`);
    if(line.length===6){console.log("  "+line.join("  "));line=[];}
  }
  if(line.length) console.log("  "+line.join("  "));
}
