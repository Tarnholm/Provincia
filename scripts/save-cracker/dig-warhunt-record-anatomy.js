// dig-warhunt-record-anatomy.js
// Full anatomy of one faction record: from record start through the diplo zone
// and into the trailer. Looking for a per-faction "known factions" table that
// maps relationUuid -> partner faction-id (which would let us name the war
// partner). The diplo entry's relationUuid is a local handle; the lookup table
// must be nearby.
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
const target = process.argv[3] || "antigonid";
const buf = fs.readFileSync(SAVES_DIR + save);
const recs = parseFactionTreasuries(buf);
const owners = identifyFactionRecordOwners(buf, recs, order);
const idx = owners.findIndex(o => o.factionName === target);
const r = recs[idx];
console.log(`${save} record ${idx} = ${target} offset=0x${r.offset.toString(16)} regions=${r.regionCount} fid=${r.factionId}`);

const diploOff = r.offset + 244 + 4 * r.regionCount;
const count = buf.readUInt32LE(diploOff + 4);
const zoneEnd = diploOff + 8 + count * 16;
console.log(`diplo zone @0x${diploOff.toString(16)} count=${count} ends @0x${zoneEnd.toString(16)}`);

// Dump record header region 0..244+4N (before diplo) in 16-byte rows, with
// the region-id array region noted.
function hexrow(o) {
  const slice = buf.slice(o, Math.min(o + 16, buf.length));
  const hex = Array.from(slice).map(b => b.toString(16).padStart(2, "0")).join(" ");
  const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : ".").join("");
  return `0x${o.toString(16).padStart(8, "0")}  ${hex.padEnd(48)}  ${asc}`;
}

console.log("\n=== record header region [offset .. diploOff] ===");
for (let o = r.offset; o < diploOff; o += 16) console.log("  " + hexrow(o));

console.log("\n=== first 8 diplo entries (16 bytes each) ===");
for (let k = 0; k < Math.min(8, count); k++) {
  const o = diploOff + 8 + k * 16;
  console.log(`  [${k}] @0x${o.toString(16)} uuid=${buf.readUInt32LE(o)} cls=${buf.readUInt32LE(o+4)} att=${buf.readUInt32LE(o+8)} tag=0x${buf.readUInt32LE(o+12).toString(16)}`);
}
