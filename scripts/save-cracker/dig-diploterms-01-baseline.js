// dig-diploterms-01-baseline.js
// Parse diplomacy zones for all the Spain controlled saves and confirm player.
"use strict";
const fs = require("fs");
const path = require("path");
const X = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

// Vanilla descr_sm_factions declaration order (0-indexed)
const VANILLA_ORDER = [
  "romans_julii", "romans_brutii", "romans_scipii", "romans_senate",
  "macedon", "egypt", "seleucid", "carthage", "parthia", "pontus",
  "gauls", "germans", "britons", "armenia", "dacia",
  "greek_cities", "numidia", "scythia", "spain", "thrace", "slave",
];

const MARKER = 0x39240005;

// Find every diplomacy zone in the buffer; owner = buf[markerOff-53].
function findZones(buf, order) {
  const zones = [];
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count > 250) continue;
    const fid = buf[i - 53];
    // gather entries even if fid invalid; we want raw
    const entries = [];
    let ok = true;
    for (let k = 0; k < count; k++) {
      const o = i + 8 + k * 16;
      if (o + 16 > buf.length) { ok = false; break; }
      entries.push({
        idx: k,
        uuid: buf.readUInt32LE(o),
        class_: buf.readUInt32LE(o + 4),
        attitude: buf.readUInt32LE(o + 8),
        tag: buf.readUInt32LE(o + 12),
      });
    }
    if (!ok) continue;
    zones.push({
      markerOff: i,
      ownerFid: fid,
      ownerName: order && fid < order.length ? order[fid] : `#${fid}`,
      count,
      entries,
    });
  }
  return zones;
}

const files = {
  T1base: "save_17-05-2026   Spain   Turn 1.sav",
  T1move: "save_17-05-2026   Spain   Turn 1move diplomat and army.sav",
  T2trade: "save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav",
  T3spy: "save_Autosave   Spain   Turn 3 inflitrated city with spy..sav",
  T3end: "save_Autosave   Spain   Turn 3 End.sav",
  T4start: "save_Autosave   Spain   Turn 4 Start.sav",
  T4war: "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav",
  T4: "save_Autosave   Spain   Turn 4.sav",
};

for (const [label, fname] of Object.entries(files)) {
  const fp = path.join(SAVE_DIR, fname);
  if (!fs.existsSync(fp)) { console.log(`${label}: MISSING ${fname}`); continue; }
  const buf = fs.readFileSync(fp);
  const recs = X.parseFactionTreasuries(buf);
  const player = X.identifyPlayerFactionFromSave(buf, recs);
  const zones = findZones(buf, VANILLA_ORDER);
  // dedup by owner keeping highest count
  const byOwner = new Map();
  for (const z of zones) {
    if (!byOwner.has(z.ownerFid) || byOwner.get(z.ownerFid).count < z.count) byOwner.set(z.ownerFid, z);
  }
  console.log(`\n===== ${label}  (${fname}) size=${buf.length} =====`);
  console.log(`  player(identify)=${player}   #zones=${zones.length}  #uniqueOwners=${byOwner.size}`);
  // Show class/attitude distribution overall
  const clsDist = {}, attDist = {};
  for (const z of zones) for (const e of z.entries) {
    clsDist[e.class_] = (clsDist[e.class_] || 0) + 1;
    attDist[e.attitude] = (attDist[e.attitude] || 0) + 1;
  }
  console.log(`  class dist: ${JSON.stringify(clsDist)}`);
  console.log(`  attitude dist: ${JSON.stringify(attDist)}`);
}
