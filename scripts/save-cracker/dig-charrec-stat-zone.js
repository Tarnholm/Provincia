// dig-charrec-stat-zone.js
// Dump the +94..+300 region of well-known LAYOUT_B character records so we
// can reconcile the stat-cluster (command/influence/management/loyalty) with
// the so-called "43-effect array". Print as u32 LE columns with deltas
// against derived stats. Anchor: v1 character records.
const fs = require("fs");
const path = require("path");
const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";
const modPath = "C:/RIS/RIS";
const names = fs.readFileSync(path.join(modPath, "data/descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traits = [];
for (const m of fs.readFileSync(path.join(modPath, "data/export_descr_character_traits.txt"), "utf8").matchAll(/^Trait\s+([A-Za-z0-9_]+)/gm)) traits.push(m[1]);
const { findCharacterRecords } = require("../../src/characterParser.js");
const buf = fs.readFileSync(SAVE);
const v1 = findCharacterRecords(buf, names, traits, null);
console.log(`SAVE=${path.basename(SAVE)}  v1Records=${v1.length}`);

// Pick interesting chars: leader, heir, several many-trait generals
const leader = v1.find(c => c.isLeader);
const heir = v1.find(c => c.isHeir);
const fewTrait = v1.filter(c => (c.traits||[]).length >= 1 && (c.traits||[]).length <= 3 && c.lastName === null).slice(0, 2);
const manyTrait = v1.filter(c => (c.traits||[]).length >= 10).sort((a,b)=>b.traits.length-a.traits.length).slice(0, 3);
const picks = [leader, heir, ...fewTrait, ...manyTrait].filter(Boolean);

for (const c of picks) {
  const off = c.offset;
  const lb = c.lastName === null; // layoutB
  const base = lb ? -4 : 0;
  console.log("\n" + "=".repeat(78));
  console.log(`${c.firstName}${c.lastName?(" "+c.lastName):""}  age=${c.age} role=${c.role} layout=${lb?"B":"A"} traits=${c.traits.length}`);
  console.log(`  leader=${c.isLeader} heir=${c.isHeir}`);
  console.log(`  v1 stats: command=${c.command} influence=${c.influence} management=${c.management} loyalty=${c.loyalty}`);
  console.log(`  traits: ${c.traits.map(t=>t.name+":"+t.points).join(", ")}`);
  // Stat cluster offsets in code: command=+102+base, influence=+106, management=+110, loyalty=+126
  // memo says LAYOUT_B effect array at +126..+297. Dump +90..+300 as u32 LE.
  console.log(`  --- u32 LE dump from record (offset-relative), +90..+300 ---`);
  for (let p = 90; p <= 300; p += 4) {
    const o = off + p;
    if (o + 4 > buf.length) break;
    const u = buf.readUInt32LE(o);
    const s = buf.readInt32LE(o);
    let tag = "";
    if (p === 94+base) tag = " <- code: u16(23)/u16(50) cluster begins (+94)";
    if (p === 98+base) tag = " <- memo command u32 (+98)";
    if (p === 102+base) tag = " <- code command (+102) / memo influence (+102)";
    if (p === 106+base) tag = " <- code influence (+106) / memo management (+106)";
    if (p === 110+base) tag = " <- code management (+110)";
    if (p === 114+base) tag = " <- memo 0xffffffff sentinel (+114)";
    if (p === 122+base) tag = " <- memo loyalty (+122)";
    if (p === 126+base) tag = " <- code loyalty (+126) / memo effect[0] (+126)";
    if (p === 298+base) tag = " <- traitCount (+298)";
    const note = (s >= -1000 && s <= 1000 && s !== 0) ? `  [s32=${s}]` : "";
    console.log(`    +${p}: u32=${u}${u>0xffff?` (0x${u.toString(16)})`:""}${note}${tag}`);
  }
}
