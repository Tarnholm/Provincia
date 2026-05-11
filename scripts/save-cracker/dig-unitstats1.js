// dig-unitstats1.js — Reconnaissance: find units that survived a battle to look for XP/armor/weapon upgrades.
//
// Save pair: notdamagedturn1 (before battle) vs damagedturn1 (after battle, same turn).
// Survivors should have new XP (chevrons jump 0→1+) and possibly soldier-count drops.

const fs = require("fs");
const path = require("path");
const { findUnitRecords } = require("../../src/unitParser.js");

const ARCHIVE = "C:/dev/Provincia/calibration/archive/2026-04-21T22-49-17-100Z";

const beforeBuf = fs.readFileSync(path.join(ARCHIVE, "0006_save_notdamagedturn1.sav"));
const afterBuf = fs.readFileSync(path.join(ARCHIVE, "0004_save_damagedturn1.sav"));

console.log(`before size: ${beforeBuf.length}`);
console.log(`after  size: ${afterBuf.length}`);
console.log(`size delta: ${afterBuf.length - beforeBuf.length}`);

const before = findUnitRecords(beforeBuf);
const after = findUnitRecords(afterBuf);

console.log(`\nbefore units: ${before.length}, after units: ${after.length}`);

// Key by (name, region, commanderUuid)
function key(u) { return `${u.name}|${u.region}|${u.commanderUuid || 0}`; }
const bMap = new Map(); for (const u of before) bMap.set(key(u), u);
const aMap = new Map(); for (const u of after) aMap.set(key(u), u);

// Find units present in BOTH with soldier count change (= took damage / battle)
const battleSurvivors = [];
const fullStrength = [];
for (const [k, a] of aMap) {
  const b = bMap.get(k);
  if (!b) continue;
  if (b.soldiers !== a.soldiers || b.maxSoldiers !== a.maxSoldiers) {
    battleSurvivors.push({ key: k, before: b, after: a });
  } else {
    fullStrength.push({ key: k, before: b, after: a });
  }
}

console.log(`\nBattle survivors (soldier count changed): ${battleSurvivors.length}`);
for (const s of battleSurvivors.slice(0, 20)) {
  console.log(`  ${s.key}`);
  console.log(`    before: ${s.before.soldiers}/${s.before.maxSoldiers}  offset=0x${s.before.offset.toString(16)}`);
  console.log(`    after:  ${s.after.soldiers}/${s.after.maxSoldiers}   offset=0x${s.after.offset.toString(16)}`);
}

console.log(`\nFull-strength matched: ${fullStrength.length}`);

// Check size of the "after-region/uuid/max/current" record area
// Save total diff regions
const minLen = Math.min(beforeBuf.length, afterBuf.length);
let totalDiff = 0;
for (let i = 0; i < minLen; i++) if (beforeBuf[i] !== afterBuf[i]) totalDiff++;
console.log(`\ntotal byte diff: ${totalDiff}`);
