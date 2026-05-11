// dig-region-list2.js — confirm region lists are stable across all save pairs in the corpus
//
// Dump regionCount and full region lists for all 23 faction records in every save,
// then check stability across same-campaign saves.

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

// Cross-campaign saves: rome corpus, Saka corpus, Sparta corpus, Athens corpus
const corpora = {
  rome: ["save_rome1.sav", "save_rome2.sav", "save_rome3.sav", "save_rome4.sav", "save_rome5..sav", "save_rome6.sav", "save_rome7.sav", "save_rome8.sav", "save_rome9.sav", "save_rome10.sav"],
  sparta: ["save_savestartsparta.sav", "save_1turnstart.sav", "save_1.1.sav", "save_1.2.sav", "save_1.3.sav", "save_1.4.sav", "save_1.5.sav", "save_1.6.sav", "save_1.7.sav", "save_1turnchange.sav", "save_2.sav", "save_2.0.sav", "save_2.1.sav", "save_2.2.sav", "save_3.sav", "save_4.sav", "save_5.sav", "save_6.sav", "save_7.sav", "save_Autosave   Sparta   Turn 4 End.sav", "save_Autosave   Sparta   Turn 5 Start.sav"],
  athens: ["save_08-05-2026   Athens   Turn 21.sav", "save_Autosave   Athens   Turn 22 Start.sav", "save_Autosave   Athens   Turn 22 End.sav", "save_Autosave   Athens   Turn 22.sav"],
  saka: ["save_Autosave   Saka   Turn 1.sav", "save_Autosave   Saka   Turn 1 End.sav", "save_Autosave   Saka   Turn 2 Start.sav", "save_Autosave   Saka   Turn 2.sav"]
};

for (const [name, files] of Object.entries(corpora)) {
  console.log(`\n${'='.repeat(72)}\nCorpus: ${name}\n${'='.repeat(72)}`);
  let canonical = null;
  let allMatch = true;
  let nFiles = 0;
  for (const f of files) {
    const fpath = path.join(SAVES, f);
    if (!fs.existsSync(fpath)) continue;
    const buf = fs.readFileSync(fpath);
    const recs = findMajorRecords(buf);
    if (!canonical) {
      canonical = recs.map(r => ({ count: r.regionCount, hash: r.regions.join(',') }));
      console.log(`\nReference save: ${f}`);
      for (let i = 0; i < recs.length; i++) {
        console.log(`  Rec ${i}: count=${recs[i].regionCount} treasury=${recs[i].treasury} regions=${recs[i].regions.slice(0, 12).join(',')}${recs[i].regions.length > 12 ? '...' : ''}`);
      }
    } else {
      // Compare
      let match = recs.length === canonical.length;
      let mismatches = 0;
      if (match) {
        for (let i = 0; i < recs.length; i++) {
          if (recs[i].regionCount !== canonical[i].count) { match = false; mismatches++; continue; }
          if (recs[i].regions.join(',') !== canonical[i].hash) { match = false; mismatches++; }
        }
      }
      console.log(`  ${f}: ${match ? 'MATCH' : `DIFFER (${mismatches} record mismatches)`}`);
      if (!match) allMatch = false;
    }
    nFiles++;
  }
  console.log(`\nSummary: ${nFiles} files, all match canonical = ${allMatch}`);
}
