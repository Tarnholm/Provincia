// Show sample relation entries to understand what relationUuid really is.
const fs = require("fs");
const { parseFactionTreasuries, parseFactionDiplomacy, identifyFactionRecordOwners } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");
const treas = parseFactionTreasuries(buf);
const diplo = parseFactionDiplomacy(buf, treas);
const owners = identifyFactionRecordOwners(buf, treas);

console.log("First 5 records' first 5 relations each:");
for (let i = 0; i < Math.min(5, diplo.length); i++) {
  const name = owners[i].factionName || `rec${i}`;
  console.log(`\n${name} (rec ${i}) - ${diplo[i].relations ? diplo[i].relations.length : 0} relations:`);
  const rels = diplo[i].relations || [];
  for (const r of rels.slice(0, 5)) {
    console.log(`  uuid=0x${r.uuid.toString(16).padStart(8,'0')}  class=${r.class_}  attitude=${r.attitude}  tag=0x${(r.tag||0).toString(16)}`);
  }
}

// Are all uuids the same? unique count
const allUuids = new Set();
let total = 0;
for (let i = 0; i < diplo.length; i++) {
  for (const r of (diplo[i].relations || [])) {
    allUuids.add(r.uuid);
    total++;
  }
}
console.log(`\ntotal relations: ${total}, unique uuids: ${allUuids.size}`);
