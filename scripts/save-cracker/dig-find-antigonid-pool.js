// Find where the antigonid character UUIDs are referenced in the save.
// If they're not in any of the 23 faction records, there must be a separate pool.
const fs = require("fs");
const { parseFactionTreasuries, parseCharacterExtras } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const chars = parseCharacterExtras(buf);
const antigonid = chars.filter(c => c.culture === "antigonid").map(c => c.ownUuid);
console.log(`looking for ${antigonid.length} antigonid char UUIDs in the save...`);

// For each antigonid UUID, find every occurrence in the buffer
const occurrences = {}; // uuid -> [offsets]
for (const uuid of antigonid) {
  const off = [];
  for (let p = 0; p + 4 < buf.length; p += 1) {
    const v = (buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16) | (buf[p + 3] << 24)) >>> 0;
    if (v === uuid) off.push(p);
  }
  occurrences[uuid] = off;
}

// Get the offset where the FIRST antigonid record lives (so we know where the chars are)
const firstAntigonid = chars.find(c => c.culture === "antigonid");
console.log(`first antigonid char record at offset 0x${firstAntigonid.offset.toString(16)}`);

// Cluster occurrences by offset proximity
const allOffsets = [];
for (const [uuid, offs] of Object.entries(occurrences)) {
  for (const o of offs) allOffsets.push({ uuid: parseInt(uuid), offset: o });
}
allOffsets.sort((a, b) => a.offset - b.offset);

// Find clusters (offsets within 100KB of each other with at least 5 antigonid UUIDs)
let clusterStart = null;
let clusterUuids = new Set();
let clusterCount = 0;
const clusters = [];

for (let i = 0; i < allOffsets.length; i++) {
  const o = allOffsets[i];
  if (clusterStart === null) {
    clusterStart = o.offset;
    clusterUuids = new Set([o.uuid]);
    clusterCount = 1;
    continue;
  }
  if (o.offset - allOffsets[i - 1].offset > 100000) {
    // Save cluster if big enough
    if (clusterUuids.size >= 5) {
      clusters.push({ start: clusterStart, end: allOffsets[i - 1].offset, uniqueUuids: clusterUuids.size, totalOcc: clusterCount });
    }
    clusterStart = o.offset;
    clusterUuids = new Set([o.uuid]);
    clusterCount = 1;
  } else {
    clusterUuids.add(o.uuid);
    clusterCount += 1;
  }
}
if (clusterUuids.size >= 5) {
  clusters.push({ start: clusterStart, end: allOffsets[allOffsets.length - 1].offset, uniqueUuids: clusterUuids.size, totalOcc: clusterCount });
}

console.log("\nclusters (>=5 unique antigonid UUIDs, gap <100KB):");
for (const c of clusters) {
  console.log(`  0x${c.start.toString(16).padStart(8,'0')} → 0x${c.end.toString(16).padStart(8,'0')} : ${c.uniqueUuids}/${antigonid.length} uuids, ${c.totalOcc} total occurrences (span ${(c.end - c.start).toLocaleString()} bytes)`);
}

// Now find the cluster with the most unique UUIDs — that's the roster!
const top = clusters.sort((a, b) => b.uniqueUuids - a.uniqueUuids)[0];
console.log(`\ntop cluster: 0x${top.start.toString(16)} - 0x${top.end.toString(16)}`);

// Check what's right BEFORE the cluster start - is it a section header?
console.log("\n128 bytes before cluster start:");
const ctxStart = Math.max(0, top.start - 128);
for (let off = ctxStart; off < top.start; off += 16) {
  let hex = "", asc = "";
  for (let i = 0; i < 16 && off + i < top.start; i++) {
    const b = buf[off + i];
    hex += b.toString(16).padStart(2, "0") + " ";
    asc += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".";
  }
  console.log(`  ${off.toString(16).padStart(8,'0')}: ${hex.padEnd(48)} | ${asc}`);
}
