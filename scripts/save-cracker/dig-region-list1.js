// dig-region-list1.js — test whether region-list at +52..+(52+4N) is "currently owned"
//
// Hypothesis to test: each major faction's region list changes when a region changes hands.
//
// Available save pairs:
//   - rome5 → rome7 (turn boundary; some AI conquests likely happen)
//   - savestartsparta → save_1.1 (Sparta sieges Prasiai in Argos territory)
//
// Approach: extract every faction's regionCount and region IDs, compare across saves.

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

function findMinorRecords(buf) {
  const hits = [];
  for (let i = 0; i + 64 < buf.length; i += 1) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 8) continue;  // minor discriminator
    const treasury = buf.readInt32LE(i);
    const treasuryDup = buf.readInt32LE(i + 48);
    if (treasuryDup !== treasury) continue;
    hits.push({ pos: i, treasury });
  }
  return hits;
}

function compare(label, aName, bName) {
  console.log(`\n${'='.repeat(72)}\n${label}\n${'='.repeat(72)}`);
  const a = fs.readFileSync(path.join(SAVES, aName));
  const b = fs.readFileSync(path.join(SAVES, bName));
  const aMaj = findMajorRecords(a);
  const bMaj = findMajorRecords(b);
  console.log(`Major records: ${aName}=${aMaj.length}, ${bName}=${bMaj.length}`);
  if (aMaj.length !== bMaj.length) {
    console.log("Record count mismatch - aborting compare");
    return;
  }
  for (let i = 0; i < aMaj.length; i++) {
    const A = aMaj[i], B = bMaj[i];
    const ra = A.regions, rb = B.regions;
    if (A.regionCount === B.regionCount && ra.every((r, k) => r === rb[k])) continue;
    console.log(`\nRecord ${i} (treasury ${A.treasury} → ${B.treasury}):`);
    console.log(`  regionCount ${A.regionCount} → ${B.regionCount}`);
    const setA = new Set(ra), setB = new Set(rb);
    const onlyA = [...setA].filter(x => !setB.has(x));
    const onlyB = [...setB].filter(x => !setA.has(x));
    if (onlyA.length) console.log(`  Only in ${aName}: ${onlyA.join(',')}`);
    if (onlyB.length) console.log(`  Only in ${bName}: ${onlyB.join(',')}`);
    // If lists are same items but different order, that's also informative
    if (onlyA.length === 0 && onlyB.length === 0 && A.regionCount === B.regionCount) {
      console.log(`  Same items, different order`);
    }
  }
}

// Pair 1: rome5 → rome7 (turn boundary in player's campaign)
compare("rome5 → rome7 (turn 5 → turn 6 boundary)", "save_rome5..sav", "save_rome7.sav");

// Pair 2: rome6 → rome7 (cleanest within-faction turn boundary)
compare("rome6 → rome7 (turn 5 within → turn 6 start)", "save_rome6.sav", "save_rome7.sav");

// Pair 3: rome5 vs rome10 (same in-game state, different sessions)
compare("rome5 vs rome10 (same state, diff session)", "save_rome5..sav", "save_rome10.sav");

// Pair 4: savestartsparta → save_1.1 (Sparta sieges Prasiai)
compare("savestartsparta → save_1.1 (Sparta declares siege)", "save_savestartsparta.sav", "save_1.1.sav");

// Pair 5: Saka turn 1 → Saka turn 2 — large turn-boundary check
compare("Saka turn 1 → Saka turn 2", "save_Autosave   Saka   Turn 1.sav", "save_Autosave   Saka   Turn 2.sav");

// Pair 6: Sparta turn 4 end vs turn 5 start
compare("Sparta T4 end → T5 start", "save_Autosave   Sparta   Turn 4 End.sav", "save_Autosave   Sparta   Turn 5 Start.sav");
