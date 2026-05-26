// dig-met-01-survey.js
// Survey: for a set of saves, print campaign name + player faction + matrix
// meta + per-faction diplomacy-zone summary (which zone is tag==0 = player).
// Goal: pick a clean T0-vs-later pair per campaign, and see whether the player
// zone's entry count tracks the "met" set.
"use strict";
const fs = require("fs");
const path = require("path");
const X = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const RIS_FACTIONS = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";

function loadFactionOrder(p) {
  const txt = fs.readFileSync(p, "utf8"); const order = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) { const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/); if (cm) { order.push(cur); cur = null; } }
  }
  return order;
}
const order = loadFactionOrder(RIS_FACTIONS);

const saves = process.argv.slice(2);
if (saves.length === 0) {
  console.log("usage: node dig-met-01-survey.js <save1> [save2 ...]");
  process.exit(1);
}

// Enumerate every 0x39240005 zone with its tag-of-first-entry, count, and the
// factionId byte at marker-53 (per parseAllFactionDiplomacy's crack).
function enumerateZones(buf) {
  const MARKER = 0x39240005;
  const zones = [];
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count > 250) continue;
    const fid = buf[i - 53];
    let firstTag = null, firstCls = null, firstAtt = null;
    if (count > 0 && i + 8 + 16 <= buf.length) {
      firstCls = buf.readUInt32LE(i + 12);
      firstAtt = buf.readUInt32LE(i + 16);
      firstTag = buf.readUInt32LE(i + 20);
    }
    zones.push({ off: i, count, fid, firstTag, firstCls, firstAtt });
  }
  return zones;
}

for (const s of saves) {
  const buf = fs.readFileSync(SAVES_DIR + s);
  const hdr = X.parseHeader(buf);
  const recs = X.parseFactionTreasuries(buf);
  const owners = X.identifyFactionRecordOwners(buf, recs, order);
  const player = X.identifyPlayerFactionFromSave(buf, recs);
  const m = X.parseDiplomacyMatrix(buf, order);
  console.log(`\n############### ${s}`);
  console.log(`campaign="${hdr ? hdr.campaignName : "?"}" typeFlag=0x${hdr ? hdr.campaignTypeFlag.toString(16) : "?"} size=${buf.length}`);
  console.log(`player(banner)=${player}  majorRecords=${recs.length}`);
  console.log(`matrix meta:`, m ? m._meta : "NOT FOUND");

  const zones = enumerateZones(buf);
  // group: which zones have firstTag==0 (player-style padding zone)?
  const tag0 = zones.filter(z => z.firstTag === 0);
  const tagNorm = zones.filter(z => z.firstTag === 0x00010101);
  const tagOther = zones.filter(z => z.firstTag !== 0 && z.firstTag !== 0x00010101);
  console.log(`zones total=${zones.length}  tag0(player-style)=${tag0.length}  tag010101(npc)=${tagNorm.length}  other=${tagOther.length}`);
  console.log(`tag0 zones (off,count,fid->name):`);
  for (const z of tag0.slice(0, 12)) {
    const nm = z.fid < order.length ? order[z.fid] : `#${z.fid}`;
    console.log(`   @0x${z.off.toString(16)} count=${z.count} fid=${z.fid}(${nm}) firstCls=${z.firstCls} firstAtt=${z.firstAtt}`);
  }
}
