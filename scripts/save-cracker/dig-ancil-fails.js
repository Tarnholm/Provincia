// dig-ancil-fails.js — research/diagnostic ONLY
// Dump raw trait-tail + ancillary bytes for the 14 decoder failures to
// understand whether they are (a) genuine engine-vs-descr_strat differences,
// (b) wrong-tile bridges, or (c) a layout edge case.

const fs = require("fs");
const path = require("path");
const cp = require("../../src/characterParser.js");

const MOD = "C:/RIS/RIS/data";
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const SAVE = "save_macedon t0.sav";

const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames = [];
for (const line of fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/)) {
  const tm = line.match(/^Trait\s+(\S+)/); if (tm) traitNames.push(tm[1]);
}
const ancNames = [];
for (const line of fs.readFileSync(path.join(MOD, "export_descr_ancillaries.txt"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^Ancillary\s+(\S+)/); if (m) ancNames.push(m[1]);
}

const buf = fs.readFileSync(path.join(SAVES, SAVE));
const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
const recByTile = new Map();
for (const r of recs) if (r.tileX != null) recByTile.set(`${r.tileX},${r.tileY}`, r);

const targets = [
  { name: "Gaius", x: 261, y: 425, exp: ["doctor"] },
  { name: "Bituitus", x: 191, y: 472, exp: ["drunken_uncle", "drinking_companion"] },
  { name: "Spartokos", x: 434, y: 420, exp: ["philosopher", "priest_of_Artemis", "Rider_Treasure"] },
  { name: "Rhoigos", x: 421, y: 420, exp: ["wine_steward", "comedian", "aged_retainer", "Rhyton_Amphora", "priest_of_Bendis", "Royal_Numismatist", "former_makedonian"] },
  { name: "Solon", x: 144, y: 373, exp: ["merchant"] },
  { name: "Dropion", x: 387, y: 401, exp: ["tutor"] },
];

function hex(b){return b.toString(16).padStart(2,"0");}

for (const t of targets) {
  const r = recByTile.get(`${t.x},${t.y}`);
  if (!r) { console.log(`\n### ${t.name} @${t.x},${t.y} NO RECORD`); continue; }
  const layoutA = !!r.lastName;
  const tsOff = layoutA ? 308 : 304;
  const tcOff = layoutA ? 302 : 298;
  const tc = buf.readUInt16LE(r.offset + tcOff);
  const trEnd = r.offset + tsOff + tc * 8;
  console.log(`\n### ${t.name} @${t.x},${t.y}  parsedName=${r.firstName} ${r.lastName||""}  layout=${layoutA?"A":"B"} tc=${tc}`);
  console.log(`    parser-traits(last5): ` + r.traits.slice(-5).map(x=>x.name+`(${x.points})`).join(", "));
  console.log(`    expected ancs: [${t.exp.join(", ")}]`);
  // Dump from trEnd-12 to first "data/"
  let dataPos=-1;
  for (let i=-4;i<260 && trEnd+i+5<buf.length;i++){
    if(buf[trEnd+i]===0x64&&buf[trEnd+i+1]===0x61&&buf[trEnd+i+2]===0x74&&buf[trEnd+i+3]===0x61&&buf[trEnd+i+4]===0x2f){dataPos=i;break;}
  }
  const s=trEnd-12, e=trEnd+(dataPos>=0?dataPos+2:48);
  let row=[];
  for(let p=s;p<e;p++){const rel=p-trEnd;row.push((rel===0?"|":"")+hex(buf[p]));if(row.length===16){console.log("      "+row.join(" "));row=[];}}
  if(row.length)console.log("      "+row.join(" "));
  console.log(`    dataPos(rel to trEnd)=${dataPos}`);
  // Show the count@trEnd-4 interpretation and an alternative count@trEnd interpretation
  const cntA=buf.readUInt16LE(trEnd-4);
  const cntB=buf.readUInt16LE(trEnd);
  console.log(`    count@(trEnd-4)=${cntA}  count@(trEnd)=${cntB}`);
  // Decode ids both ways
  const idsA=[]; for(let k=0;k<cntA && k<16;k++){const o=(trEnd-2)+k*4; if(o+4<=buf.length) idsA.push(buf.readUInt32LE(o));}
  console.log(`    ids via (trEnd-2 + k*4): ` + idsA.map(id=>id+"="+(ancNames[id]||"?")).join(", "));
}
