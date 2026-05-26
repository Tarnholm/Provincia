// For each diplomatic relation uuid in faction A's table, find the
// OTHER major faction record that contains the same uuid in its body.
// That's the partner.
const fs = require("fs");
const {
  parseFactionTreasuries,
  parseFactionDiplomacy,
  identifyFactionRecordOwners,
} = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const treas = parseFactionTreasuries(buf);
const diplo = parseFactionDiplomacy(buf, treas);
const owners = identifyFactionRecordOwners(buf, treas);

const recOffsets = treas.map(t => t.offset);
// Compute each rec's [start, end) span
const recSpans = treas.map((t, i) => ({
  start: t.offset,
  end: i + 1 < treas.length ? treas[i + 1].offset : buf.length,
  name: owners[i].factionName || `rec${i}`,
}));

// Pre-build: for each uuid value (within typical relation range 0x80..0x1000),
// find the FIRST occurrence in each major faction record body.
// (We could find ALL but first is sufficient as an existence check.)
const uuidLocations = new Map(); // uuid -> Set of rec indices containing it

console.log("Indexing uuid → rec membership (this scans each rec body)...");
for (let r = 0; r < recSpans.length; r++) {
  const span = recSpans[r];
  for (let p = span.start; p + 4 < span.end; p += 1) {
    const v = (buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16) | (buf[p + 3] << 24)) >>> 0;
    if (v > 0x80 && v < 0x1000) {
      if (!uuidLocations.has(v)) uuidLocations.set(v, new Set());
      uuidLocations.get(v).add(r);
    }
  }
}
console.log(`indexed ${uuidLocations.size} candidate uuids`);

// For each relation in each faction's diplomacy table, find the partner
console.log("\n--- Pairing relations ---");
let totalRels = 0;
let pairedCount = 0;
let triCount = 0;
let multiCount = 0;
const samplePairs = [];
for (let i = 0; i < diplo.length; i++) {
  const rels = diplo[i].relations || [];
  for (const r of rels) {
    totalRels += 1;
    const recs = uuidLocations.get(r.uuid);
    if (!recs) continue;
    // Other recs that contain this uuid
    const others = [...recs].filter(x => x !== i);
    if (others.length === 1) {
      pairedCount += 1;
      if (samplePairs.length < 30) {
        const partner = owners[others[0]].factionName || `rec${others[0]}`;
        const me = owners[i].factionName || `rec${i}`;
        samplePairs.push(`${me.padEnd(18)} <-> ${partner.padEnd(18)}  uuid=0x${r.uuid.toString(16).padStart(4,'0')}  class=${r.class_}  attitude=${r.attitude}`);
      }
    } else if (others.length === 2) {
      triCount += 1;
    } else if (others.length > 2) {
      multiCount += 1;
    }
  }
}

console.log(`total relations: ${totalRels}`);
console.log(`paired (uuid in exactly 1 other rec): ${pairedCount}`);
console.log(`tri (uuid in 2 other recs): ${triCount}`);
console.log(`multi (uuid in 3+ other recs): ${multiCount}`);
console.log("\nsample paired relations:");
for (const s of samplePairs) console.log("  " + s);

// Quality check: for each pair, both sides should agree on class+attitude
console.log("\n--- consistency check on paired entries ---");
let consistent = 0;
let inconsistent = 0;
const inconsistentSamples = [];
for (let i = 0; i < diplo.length; i++) {
  const rels = diplo[i].relations || [];
  for (const r of rels) {
    const recs = uuidLocations.get(r.uuid);
    if (!recs || recs.size !== 2) continue;
    const otherIdx = [...recs].find(x => x !== i);
    if (otherIdx === undefined) continue;
    const otherRels = (diplo[otherIdx] && diplo[otherIdx].relations) || [];
    const mirror = otherRels.find(x => x.uuid === r.uuid);
    if (!mirror) continue;
    if (mirror.class_ === r.class_ && mirror.attitude === r.attitude) consistent += 1;
    else {
      inconsistent += 1;
      if (inconsistentSamples.length < 5) {
        inconsistentSamples.push(`uuid=0x${r.uuid.toString(16)} mine(class=${r.class_} att=${r.attitude}) vs theirs(class=${mirror.class_} att=${mirror.attitude})`);
      }
    }
  }
}
console.log(`consistent: ${consistent}, inconsistent: ${inconsistent}`);
for (const s of inconsistentSamples) console.log("  " + s);
