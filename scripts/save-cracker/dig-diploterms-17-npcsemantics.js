// dig-diploterms-17-npcsemantics.js
// Decode NPC-zone (tag=0x10101) class/attitude semantics. In the Carthage-player
// save, Carthage's perspective is the tag=0 zone; the OTHER 219 zones are NPC
// perspectives (tag=0x10101). But we need ground truth.
//
// Cleaner: use the VANILLA Spain T1 save's NPC zones with descr_strat ground
// truth. The Roman houses are mutually ALLIED. Slave is at war with everyone.
// Map each faction's NPC-zone class/attitude distribution against known facts.
//
// Then test the hypothesis: class encodes STANCE, attitude encodes the 0-4 mood.
"use strict";
const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const VANILLA_ORDER = [
  "romans_julii","romans_brutii","romans_scipii","romans_senate","macedon","egypt",
  "seleucid","carthage","parthia","pontus","gauls","germans","britons","armenia",
  "dacia","greek_cities","numidia","scythia","spain","thrace","slave"];
const MARKER = 0x39240005;

function findZones(buf) {
  const seen = new Map();
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count > 250) continue;
    const fid = buf[i - 53];
    const entries = [];
    let ok = true;
    for (let k = 0; k < count; k++) {
      const o = i + 8 + k * 16;
      if (o + 16 > buf.length) { ok = false; break; }
      entries.push({ uuid: buf.readUInt32LE(o), class_: buf.readUInt32LE(o + 4), attitude: buf.readUInt32LE(o + 8), tag: buf.readUInt32LE(o + 12) });
    }
    if (!ok) continue;
    if (!seen.has(fid) || seen.get(fid).count < count) seen.set(fid, { fid, count, entries });
  }
  return seen;
}

const buf = fs.readFileSync(path.join(SAVE_DIR, "save_17-05-2026   Spain   Turn 1.sav"));
const zones = findZones(buf);

// Ground truth: number of relationships each faction has in descr_strat
// (faction_relationships + at-war-with-slave). Build expected adjacency.
// From descr_strat, the meaningful starting relations:
//  - Roman houses julii/brutii/scipii allied with each other + senate (allied bloc)
//  - Everyone at war with slave (so each faction has >=1 "war" relation w/ slave)
//  - Carthage core-hostile to julii/scipii (310), hostile to spain (spain->carthage 410)
// The "count" of each NPC zone = number of factions it has MET (has line-of-sight
// to / shares border). Let's just present the data with reasoning hooks.

console.log("Ground-truth anchors:");
console.log("  - julii/brutii/scipii/senate = ALLIED bloc (attitude very positive)");
console.log("  - ALL factions AT WAR with slave (attitude 600)");
console.log("  - spain core-hostile->carthage (410); carthage->spain 90 (suspicious)\n");

// For the slave zone: every entry should be a WAR relation (slave at war w/ all).
const slave = zones.get(20);
console.log(`SLAVE zone (everyone at war w/ slave) — ${slave.count} entries:`);
const slaveClsAtt = {};
for (const e of slave.entries) { const k=`c${e.class_}a${e.attitude}`; slaveClsAtt[k]=(slaveClsAtt[k]||0)+1; }
console.log(`  combos: ${JSON.stringify(slaveClsAtt)}`);
console.log(`  -> if class encodes WAR uniformly, all should share one class. They DON'T (mix of c0,c1,c2,c4).`);
console.log(`  -> So class is NOT pure stance. Likely class=relation-record-type, attitude=mood tier.\n`);

// Roman allied bloc: julii zone
const julii = zones.get(0);
console.log(`ROMANS_JULII zone (allied w/ brutii,scipii,senate) — ${julii.count} entries:`);
console.log(`  ${julii.entries.map(e=>`c${e.class_}a${e.attitude}`).join(" ")}`);
console.log(`  (only 2 entries though — so zone lists MET factions, not all allies)\n`);

// Print attitude tier hypothesis: attitude 0..4 maps to descr_strat tiers
// ALLIED(0) SUSPICIOUS(1) NEUTRAL(2) HOSTILE(3) AT_WAR(4)?
console.log("Hypothesis: attitude 0=ALLIED 1=friendly 2=neutral 3=cool 4=hostile/war");
console.log("Test: slave entries (all wars) attitudes:", slave.entries.map(e=>e.attitude).sort().join(","));
