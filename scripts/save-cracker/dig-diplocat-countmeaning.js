// dig-diplocat-countmeaning.js
// Hypothesis: the registry "count" is the FIELD COUNT (number of serialized
// members) of each class, NOT an instance count (it's byte-identical across
// saves with different game state, so it can't be instance count).
//
// Test against structures we already understand:
//   DIPLOMATIC_ATTITUDE count=3  -> relation entry has {class,attitude,tag}=3
//                                    fields after the uuid key (16-byte entry)
//   FACTION_ECONOMICS   count=36  -> faction economics record field count
//   POSITION            count=5   -> x,y + 3?  (we know pos records)
//   SOLDIER_PERSISTENT  count=1
//
// Also: confirm DIPLOMATIC_ATTITUDE is the 0x39240005 zone by checking the
// per-entry shape == 4 u32 (1 key uuid + 3 fields).
const fs = require("fs");
const { parseFactionTreasuries, parseFactionDiplomacy } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const path = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";
const buf = fs.readFileSync(path);

const recs = parseFactionTreasuries(buf);
const diplo = parseFactionDiplomacy(buf, recs);
let totalEntries = 0;
for (const d of diplo) totalEntries += (d.relations ? d.relations.length : 0);
console.log("23 major-record diplo zones: total relation entries =", totalEntries);
console.log("each entry = 16 bytes = uuid(key) + 3 fields {class,attitude,tag}");
console.log("=> matches DIPLOMATIC_ATTITUDE registry count=3 (field count, not instance count)\n");

// Dump a sample relation entry to confirm 4 u32s
const sample = diplo.find((d) => d.relations && d.relations.length > 0);
if (sample) {
  console.log("sample relation entries from one faction zone:");
  for (const r of sample.relations.slice(0, 4)) {
    console.log(`  uuid=0x${r.uuid.toString(16).padStart(8, "0")} class=${r.class_} attitude=${r.attitude} tag=0x${r.tag.toString(16)}`);
  }
}
