// dig-diploterms-05-warwide.js
// The diplomacy zones didn't change on war declaration. Where IS war recorded?
// Strategy: compare zones across the full Spain turn sequence (T1..T4) and find
// ANY zone entry that flips to a clearly "war" state with carthage involved.
// Also dump the carthage MAJOR record diplomacy via parseFactionDiplomacy.
"use strict";
const fs = require("fs");
const path = require("path");
const X = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const VANILLA_ORDER = [
  "romans_julii", "romans_brutii", "romans_scipii", "romans_senate",
  "macedon", "egypt", "seleucid", "carthage", "parthia", "pontus",
  "gauls", "germans", "britons", "armenia", "dacia",
  "greek_cities", "numidia", "scythia", "spain", "thrace", "slave",
];
const MARKER = 0x39240005;

function findZones(buf) {
  const zones = new Map();
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
    if (!zones.has(fid) || zones.get(fid).count < count) zones.set(fid, { markerOff: i, count, entries });
  }
  return zones;
}

const seq = [
  ["T1", "save_17-05-2026   Spain   Turn 1.sav"],
  ["T2trade", "save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav"],
  ["T3spy", "save_Autosave   Spain   Turn 3 inflitrated city with spy..sav"],
  ["T3end", "save_Autosave   Spain   Turn 3 End.sav"],
  ["T4start", "save_Autosave   Spain   Turn 4 Start.sav"],
  ["T4war", "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav"],
  ["T4", "save_Autosave   Spain   Turn 4.sav"],
];

// Track Spain(18) and Carthage(7) entry tuples across the whole sequence.
console.log("=== SPAIN zone (fid 18) over sequence ===");
for (const [label, f] of seq) {
  const z = findZones(fs.readFileSync(path.join(SAVE_DIR, f))).get(18);
  const s = z.entries.map(e => `${e.uuid}[c${e.class_}a${e.attitude}t${e.tag.toString(16)}]`).join(" ");
  console.log(`  ${label.padEnd(8)} cnt=${z.count}  ${s}`);
}
console.log("\n=== CARTHAGE zone (fid 7) over sequence ===");
for (const [label, f] of seq) {
  const z = findZones(fs.readFileSync(path.join(SAVE_DIR, f))).get(7);
  const s = z.entries.map(e => `${e.uuid}[c${e.class_}a${e.attitude}t${e.tag.toString(16)}]`).join(" ");
  console.log(`  ${label.padEnd(8)} cnt=${z.count}  ${s}`);
}

// Now: parseFactionDiplomacy on the MAJOR class-100 records for the war saves.
console.log("\n=== MAJOR-record diplomacy (parseFactionDiplomacy) carthage ===");
for (const [label, f] of [["T4start","save_Autosave   Spain   Turn 4 Start.sav"],["T4war","save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav"],["T4","save_Autosave   Spain   Turn 4.sav"]]) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, f));
  const recs = X.parseFactionTreasuries(buf);
  const owners = X.identifyFactionRecordOwners(buf, recs, VANILLA_ORDER);
  const dip = X.parseFactionDiplomacy(buf, recs);
  const ci = owners.findIndex(o => o.factionName === "carthage");
  console.log(`  ${label}: #majorRecs=${recs.length} carthageRecIdx=${ci}`);
  if (ci >= 0) {
    const rels = dip[ci].relations;
    console.log(`    carthage rels(${rels.length}): ${rels.map(r=>`${r.uuid}[c${r.class_}a${r.attitude}]`).join(" ")}`);
  }
}
