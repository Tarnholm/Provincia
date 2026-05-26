// Each diplomatic relation has a globally unique UUID. If two factions
// participate in the same relation, that UUID appears in BOTH their
// faction records' relation lists. Pair them up.
const fs = require("fs");
const {
  parseFactionTreasuries,
  parseFactionDiplomacy,
  identifyFactionRecordOwners,
  identifyPlayerFactionFromSave,
} = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const treas = parseFactionTreasuries(buf);
const diplo = parseFactionDiplomacy(buf, treas);
const owners = identifyFactionRecordOwners(buf, treas);
const player = identifyPlayerFactionFromSave(buf, treas);

console.log(`treas: ${treas.length} records, diplo: ${diplo.length} faction-records`);
console.log(`player: ${player}`);

// Build uuid → [record indices] map
const uuidToRecs = new Map();
for (let i = 0; i < diplo.length; i++) {
  const relations = diplo[i].relations || [];
  for (const r of relations) {
    if (!uuidToRecs.has(r.relationUuid)) uuidToRecs.set(r.relationUuid, []);
    uuidToRecs.get(r.relationUuid).push({ rec: i, class: r.class, attitude: r.attitudeTier });
  }
}

// Count by membership size
const sizes = new Map();
for (const v of uuidToRecs.values()) {
  sizes.set(v.length, (sizes.get(v.length) || 0) + 1);
}
console.log("\nuuid membership distribution:");
for (const [size, count] of Array.from(sizes.entries()).sort((a, b) => a[0] - b[0])) {
  console.log(`  ${size} record(s) contain uuid : ${count} relations`);
}

// Show pairs (uuid in exactly 2 records)
const pairs = Array.from(uuidToRecs.values()).filter(v => v.length === 2);
console.log(`\n${pairs.length} relations are PAIRED (uuid in exactly 2 records):`);
for (const p of pairs.slice(0, 30)) {
  const r1 = p[0], r2 = p[1];
  const name1 = owners[r1.rec].factionName || `rec${r1.rec}`;
  const name2 = owners[r2.rec].factionName || `rec${r2.rec}`;
  const consistent = r1.class === r2.class && r1.attitude === r2.attitude;
  console.log(`  ${name1.padEnd(18)} <-> ${name2.padEnd(18)}  class=${r1.class} att=${r1.attitude}  ${consistent ? "CONSISTENT" : "DIFFERS!"}`);
}

// Show singletons (uuid in only 1 record) - might be relations with the PLAYER
const singles = Array.from(uuidToRecs.entries()).filter(([k, v]) => v.length === 1);
console.log(`\n${singles.length} uuids appear in only 1 record (probably player-related relations):`);
const singleByRec = new Map();
for (const [uuid, v] of singles) {
  singleByRec.set(v[0].rec, (singleByRec.get(v[0].rec) || 0) + 1);
}
for (const [rec, count] of Array.from(singleByRec.entries()).sort((a, b) => b[1] - a[1])) {
  const name = owners[rec].factionName || `rec${rec}`;
  console.log(`  ${name.padEnd(18)} rec ${rec}: ${count} singleton relations`);
}
