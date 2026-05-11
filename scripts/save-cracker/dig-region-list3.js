// dig-region-list3.js — diff details for sparta corpus saves that DIFFER
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

const refBuf = fs.readFileSync(path.join(SAVES, "save_savestartsparta.sav"));
const refRecs = findMajorRecords(refBuf);

// Sparta corpus diff against reference for each save
const sparta = ["save_1turnstart.sav", "save_1.1.sav", "save_1turnchange.sav", "save_2.sav", "save_2.0.sav", "save_3.sav", "save_4.sav", "save_5.sav", "save_6.sav", "save_7.sav", "save_Autosave   Sparta   Turn 4 End.sav", "save_Autosave   Sparta   Turn 5 Start.sav"];

for (const f of sparta) {
  const fpath = path.join(SAVES, f);
  if (!fs.existsSync(fpath)) continue;
  const buf = fs.readFileSync(fpath);
  const recs = findMajorRecords(buf);
  const sameOrder = recs.length === refRecs.length && refRecs.every((r, i) => r.regions.join(',') === recs[i].regions.join(','));
  console.log(`\n${f}: ${sameOrder ? 'SAME_ORDER' : 'REORDERED'}`);
  if (!sameOrder) {
    // Try: do the same SETS of region lists exist, just reordered?
    const refHashes = refRecs.map(r => `${r.regionCount}:${r.regions.join(',')}`);
    const curHashes = recs.map(r => `${r.regionCount}:${r.regions.join(',')}`);
    const refSet = new Set(refHashes);
    const curSet = new Set(curHashes);
    const onlyRef = refHashes.filter(h => !curSet.has(h));
    const onlyCur = curHashes.filter(h => !refSet.has(h));
    if (onlyRef.length === 0 && onlyCur.length === 0) {
      // Just reordered. Show the reorder map.
      console.log("  Region lists IDENTICAL, just reordered. Mapping ref idx → cur idx:");
      for (let i = 0; i < refRecs.length; i++) {
        const curIdx = recs.findIndex(r => r.regions.join(',') === refRecs[i].regions.join(','));
        if (curIdx !== i) {
          console.log(`    ref[${i}] (treasury ${refRecs[i].treasury}, regions=${refRecs[i].regionCount}) → cur[${curIdx}] (treasury ${recs[curIdx]?.treasury})`);
        }
      }
    } else {
      console.log(`  Region lists actually differ. ${onlyRef.length} unique in ref, ${onlyCur.length} unique in cur`);
      for (let i = 0; i < Math.max(refHashes.length, curHashes.length); i++) {
        if (refHashes[i] !== curHashes[i]) {
          const a = refRecs[i] ? `count=${refRecs[i].regionCount} t=${refRecs[i].treasury} regions=${refRecs[i].regions.slice(0, 10).join(',')}` : 'MISSING';
          const b = recs[i] ? `count=${recs[i].regionCount} t=${recs[i].treasury} regions=${recs[i].regions.slice(0, 10).join(',')}` : 'MISSING';
          console.log(`    [${i}]:`);
          console.log(`      ref: ${a}`);
          console.log(`      cur: ${b}`);
        }
      }
    }
  }
}
