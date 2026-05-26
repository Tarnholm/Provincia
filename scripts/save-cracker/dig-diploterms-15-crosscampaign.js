// dig-diploterms-15-crosscampaign.js
// Compare the SAME faction's zone across different player campaigns at ~T1.
// If zones are GLOBAL world state, carthage's zone should look the same whether
// player is Spain, Carthage, or Rome. If player-relative, the player's own zone
// will be the tag=0 one and differ.
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

const campaigns = [
  ["SPAIN-player T1", "save_17-05-2026   Spain   Turn 1.sav", 18],
  ["CARTHAGE-player T1end", "save_Autosave   Carthage   Turn 1 End.sav", 7],
  ["ROME(julii)-player T2", "save_Autosave   Republic of Rome   Turn 2.sav", 0],
  ["SELEUCID-player T1", "save_Autosave   Seleucid Empire   Turn 1.sav", 6],
  ["ANTIGONID/MACEDON-player T1", "save_Autosave   Antigonid Kingdom   Turn 1.sav", 4],
];

// For each campaign, show which zone is tag=0 (player) and dump carthage(7) + each player's own.
for (const [label, f, playerFid] of campaigns) {
  if (!fs.existsSync(path.join(SAVE_DIR, f))) { console.log(`\n${label}: MISSING ${f}`); continue; }
  const buf = fs.readFileSync(path.join(SAVE_DIR, f));
  const zones = findZones(buf);
  // which zones have tag=0 entries?
  const tag0 = [];
  for (const z of zones.values()) {
    if (z.entries.some(e => e.tag === 0)) tag0.push(z.fid);
  }
  console.log(`\n===== ${label} (${f}) =====`);
  console.log(`  zones=${zones.size}  tag0-zones(player?)=[${tag0.map(x=>`${x}:${VANILLA_ORDER[x]}`).join(", ")}]  declaredPlayerFid=${playerFid}(${VANILLA_ORDER[playerFid]})`);
  // dump carthage zone
  const ca = zones.get(7);
  if (ca) console.log(`  CARTHAGE(7) cnt=${ca.count}: ${ca.entries.map(e=>`${e.uuid}[c${e.class_}a${e.attitude}t${e.tag.toString(16)}]`).join(" ")}`);
  // dump player's own zone
  const pz = zones.get(playerFid);
  if (pz) console.log(`  PLAYER(${playerFid}) cnt=${pz.count}: ${pz.entries.map(e=>`${e.uuid}[c${e.class_}a${e.attitude}t${e.tag.toString(16)}]`).join(" ")}`);
}
