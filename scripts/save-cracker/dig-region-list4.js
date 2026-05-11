// dig-region-list4.js — cross-campaign region list comparison
//
// Take Romans Julii's record across all campaigns (rome5, savestartsparta, Saka, Athens):
// Is the SAME set of 35 regions reported for Romans Julii each time?

const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function findMajorRecords(buf) {
  const hits = [];
  for (let i = 0; i + 64 < buf.length; i += 1) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 32) !== 0 || buf.readUInt32LE(i + 36) !== 0) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    const regionCount = buf.readUInt32LE(i + 48);
    if (regionCount > 200) continue;
    const treasury = buf.readInt32LE(i);
    const regions = [];
    for (let j = 0; j < regionCount; j++) regions.push(buf.readUInt32LE(i + 52 + j * 4));
    hits.push({ pos: i, treasury, regionCount, regions });
  }
  return hits;
}

const saves = [
  "save_rome5..sav",
  "save_savestartsparta.sav",
  "save_Autosave   Saka   Turn 1.sav",
  "save_08-05-2026   Athens   Turn 21.sav"
];

// Find a record with regions=35 (Romans Julii signature) in each
const fingerprints = [];
for (const f of saves) {
  const buf = fs.readFileSync(path.join(SAVES, f));
  const recs = findMajorRecords(buf);
  const julii = recs.find(r => r.regionCount === 35);
  if (julii) {
    const sorted = [...julii.regions].sort((a, b) => a - b);
    fingerprints.push({ save: f, hash: sorted.join(',') });
    console.log(`${f}: Romans Julii (35 regions) sorted: ${sorted.join(',')}`);
  }
}

// Check if all fingerprints match
const set = new Set(fingerprints.map(f => f.hash));
console.log(`\n${set.size} unique Romans Julii region lists across ${fingerprints.length} campaigns`);
console.log(`All match: ${set.size === 1}`);

// Same for Carthage (22 regions)
const carthFingerprints = [];
for (const f of saves) {
  const buf = fs.readFileSync(path.join(SAVES, f));
  const recs = findMajorRecords(buf);
  // Carthage has 22 regions in this corpus
  const carthage = recs.find(r => r.regionCount === 22);
  if (carthage) {
    const sorted = [...carthage.regions].sort((a, b) => a - b);
    carthFingerprints.push({ save: f, hash: sorted.join(',') });
  }
}
const carthSet = new Set(carthFingerprints.map(f => f.hash));
console.log(`\nCarthage (22 regions): ${carthSet.size} unique fingerprints across ${carthFingerprints.length} campaigns; all match: ${carthSet.size === 1}`);
