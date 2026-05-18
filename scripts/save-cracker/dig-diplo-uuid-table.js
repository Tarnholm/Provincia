// Search for a table somewhere in the save that maps relation UUIDs to
// (factionA, factionB) pairs. If such a table exists, it'd have all 283
// relation UUIDs clustered together with adjacent identifiers.

const fs = require("fs");
const { parseFactionTreasuries, parseFactionDiplomacy } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const treas = parseFactionTreasuries(buf);
const diplo = parseFactionDiplomacy(buf, treas);

// Collect all relation UUIDs
const allUuids = new Set();
for (const d of diplo) {
  for (const r of d.relations) allUuids.add(r.uuid);
}
console.log(`looking for ${allUuids.size} relation UUIDs as a clustered table`);

// For each UUID, find ALL positions where that u32 appears
const uuidPositions = new Map();
for (const uuid of allUuids) {
  const target = Buffer.alloc(4);
  target.writeUInt32LE(uuid);
  const positions = [];
  let p = 0;
  while ((p = buf.indexOf(target, p)) !== -1) { positions.push(p); p += 4; }
  uuidPositions.set(uuid, positions);
}

// Each UUID appears at least twice (once in its diplomacy entry, plus maybe
// elsewhere). Print average occurrences.
let totalOccs = 0;
let multiOccs = 0;
for (const [, positions] of uuidPositions) {
  totalOccs += positions.length;
  if (positions.length > 1) multiOccs++;
}
console.log(`average occurrences per UUID: ${(totalOccs / allUuids.size).toFixed(2)}`);
console.log(`UUIDs appearing >1 time: ${multiOccs}/${allUuids.size}`);

// For each UUID, find OTHER occurrences (excluding the diplomacy entry).
// Cluster them by region to find potential lookup table.
const otherPositions = [];
for (const d of diplo) {
  if (!d.markerOffset) continue;
  for (let k = 0; k < d.relations.length; k++) {
    const knownPos = d.markerOffset + 8 + k * 16;
    const uuid = d.relations[k].uuid;
    for (const p of uuidPositions.get(uuid)) {
      if (p !== knownPos) otherPositions.push(p);
    }
  }
}
console.log(`UUIDs found OUTSIDE their diplomacy entry: ${otherPositions.length}`);

if (otherPositions.length > 0) {
  // Bucket by 4KB regions to find clusters
  const buckets = new Map();
  for (const p of otherPositions) {
    const bucket = Math.floor(p / 4096);
    buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
  }
  const sorted = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
  console.log("top 10 clusters (4KB bucket → count):");
  for (const [bucket, count] of sorted.slice(0, 10)) {
    console.log(`  0x${(bucket * 4096).toString(16)}: ${count} UUIDs`);
  }
}
