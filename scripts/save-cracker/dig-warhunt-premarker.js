// dig-warhunt-premarker.js
// Decode the structure between the region-id array and the diplo marker.
// In antigonid's record we saw `... 07 00 00 00 00 00 00 00 05 00 24 39`.
// Is the 64 bytes before the marker a header that names known/war factions?
"use strict";
const fs = require("fs");
const {
  parseFactionTreasuries,
  identifyFactionRecordOwners,
} = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const RIS_FACTIONS = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
function loadFactionOrder(path) {
  const txt = fs.readFileSync(path, "utf8"); const order = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) { const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/); if (cm) { order.push(cur); cur = null; } }
  }
  return order;
}
const order = loadFactionOrder(RIS_FACTIONS);

const save = process.argv[2] || "save_Seleucids t0.sav";
const buf = fs.readFileSync(SAVES_DIR + save);
const recs = parseFactionTreasuries(buf);
const owners = identifyFactionRecordOwners(buf, recs, order);

for (let idx = 0; idx < recs.length; idx++) {
  const r = recs[idx];
  const name = owners[idx].factionName;
  const diploOff = r.offset + 244 + 4 * r.regionCount;
  if (buf.readUInt32LE(diploOff) !== 0x39240005) continue;
  // The 24 bytes before marker as u32s
  const pre = [];
  for (let o = diploOff - 24; o < diploOff; o += 4) pre.push(buf.readUInt32LE(o));
  // Interpret last u32 before the two zero-words as a possible faction id
  console.log(`${name.padEnd(14)} fid=${String(r.factionId).padStart(3)} diplo@0x${diploOff.toString(16)}  pre-u32: [${pre.join(", ")}]`);
}
