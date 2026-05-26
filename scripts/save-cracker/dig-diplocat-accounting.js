// dig-diplocat-accounting.js
// Final accounting: where do ALL 0x39240005 (DIPLOMATIC_ATTITUDE) zones live,
// and is every one attributable to a faction? Confirms nothing diplomacy-
// related sits outside the faction-record region. Also reports the offset
// span of the diplomacy region vs the whole file.
const fs = require("fs");
const { parseFactionTreasuries } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const SAVES = {
  "macedon t0 (RIS)": "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav",
};

for (const [label, path] of Object.entries(SAVES)) {
  const buf = fs.readFileSync(path);
  const recs = parseFactionTreasuries(buf);
  const firstMajor = recs[0].offset;
  const lastMajorEnd = recs[recs.length - 1].offset; // approx
  console.log(`############ ${label} ############  fileSize=0x${buf.length.toString(16)}`);

  const zonePositions = [];
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== 0x39240005) continue;
    const c = buf.readUInt32LE(i + 4); if (c > 0 && c <= 250) zonePositions.push(i);
  }
  console.log(`total DIPLOMATIC_ATTITUDE zones: ${zonePositions.length}`);
  console.log(`first zone @0x${zonePositions[0].toString(16)}  last zone @0x${zonePositions[zonePositions.length - 1].toString(16)}`);
  console.log(`faction-record region: 0x${firstMajor.toString(16)}..0x${recs[recs.length - 1].offset.toString(16)}`);

  // How many zones are BEFORE firstMajor (player + minors+senate sitting in the
  // player/minor-faction region) vs WITHIN the major-record region vs AFTER?
  let before = 0, within = 0, after = 0;
  const lastEnd = recs[recs.length - 1].offset + 250000; // rough end of last record
  for (const z of zonePositions) {
    if (z < firstMajor) before++;
    else if (z <= recs[recs.length - 1].offset) within++;
    else after++;
  }
  console.log(`zones before firstMajor (player+minors region): ${before}`);
  console.log(`zones within major-record region:              ${within}`);
  console.log(`zones after last major record:                 ${after}`);

  // Histogram zone offsets into 1MB buckets to see clustering
  const buckets = {};
  for (const z of zonePositions) { const b = (z >> 20); buckets[b] = (buckets[b] || 0) + 1; }
  console.log("zone distribution by 1MB bucket (MB:count):",
    Object.entries(buckets).sort((a, b) => a[0] - b[0]).map(([b, c]) => `${b}:${c}`).join("  "));
}
