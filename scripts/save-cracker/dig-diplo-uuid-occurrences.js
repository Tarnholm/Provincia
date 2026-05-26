// Cross-reference each diplomatic relation UUID across the WHOLE save.
// If a uuid appears in a GLOBAL lookup table, the OTHER faction can be
// derived from that location.
const fs = require("fs");
const { parseFactionTreasuries, parseFactionDiplomacy, identifyFactionRecordOwners } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");
const treas = parseFactionTreasuries(buf);
const diplo = parseFactionDiplomacy(buf, treas);
const owners = identifyFactionRecordOwners(buf, treas);

// Pick a few specific uuids: carthage's only relation, plus first relation of major factions
const samples = [];
for (let i = 0; i < diplo.length; i++) {
  const rels = diplo[i].relations || [];
  if (rels.length > 0) {
    samples.push({ uuid: rels[0].uuid, fromRec: i, fromName: owners[i].factionName || `rec${i}` });
    if (samples.length >= 6) break;
  }
}

console.log("Sample relation UUIDs:");
for (const s of samples) {
  console.log(`  uuid=0x${s.uuid.toString(16).padStart(8,'0')} from ${s.fromName}`);
}

console.log("\nFor each sample, find ALL u32 occurrences in the save:");
for (const s of samples) {
  const uuid = s.uuid;
  const occs = [];
  for (let p = 0; p + 4 < buf.length; p += 1) {
    const v = (buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16) | (buf[p + 3] << 24)) >>> 0;
    if (v === uuid) occs.push(p);
  }
  console.log(`\nuuid=0x${uuid.toString(16)} (from ${s.fromName}): ${occs.length} occurrences`);
  for (const o of occs.slice(0, 10)) {
    // Determine which faction record this falls in (if any)
    let recIdx = -1;
    for (let i = 0; i < treas.length; i++) {
      const next = i + 1 < treas.length ? treas[i + 1].offset : buf.length;
      if (o >= treas[i].offset && o < next) { recIdx = i; break; }
    }
    const recName = recIdx >= 0 ? (owners[recIdx].factionName || `rec${recIdx}`) : "(outside major recs)";
    console.log(`  0x${o.toString(16).padStart(8,'0')}  in ${recName}`);
  }
  if (occs.length > 10) console.log(`  ... ${occs.length - 10} more`);
}

// Also: are SMALL UUIDs (0x100-0x600) used elsewhere? Maybe they're indices
// into a global table at a fixed location. Check for a region of the save
// where small UUIDs concentrate.
console.log("\n--- Concentration test: where do small uuid values (0x100-0x600) cluster? ---");
const buckets = new Map(); // 64KB bucket → count
for (const s of samples) {
  for (let p = 0; p + 4 < buf.length; p += 1) {
    const v = (buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16) | (buf[p + 3] << 24)) >>> 0;
    if (v === s.uuid) {
      const bucket = p >>> 16;
      buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
    }
  }
}
console.log("buckets with sample-uuid occurrences:");
for (const [b, c] of Array.from(buckets.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  0x${(b << 16).toString(16).padStart(8, '0')}: ${c} sample-uuid hits`);
}
