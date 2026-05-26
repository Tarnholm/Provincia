// dig-warhunt-uuid-define.js
// For a chosen faction's diplo zone, take its relationUuids and find where
// each is DEFINED (a record whose key == uuid). We look for the uuid as a u32
// and classify the surrounding context. Goal: find the relationship-object
// pool that names the partner faction.
//
// We use antigonid in seleucid save (war uuids known) and look at ALL of its
// 34 relationUuids' occurrence counts, to find ones that occur exactly twice
// (zone + definition) — those point us at the relationship object pool.
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
const diploOff = r.offset + 244 + 4 * r.regionCount;
const count = buf.readUInt32LE(diploOff + 4);
const zoneStart = diploOff + 8, zoneEnd = diploOff + 8 + count * 16;

// Build occurrence count for each u32 value in the whole file (sampled by
// scanning every byte offset is too slow; instead, for each uuid, indexOf).
function countOcc(u, cap = 30) {
  const tgt = Buffer.alloc(4); tgt.writeUInt32LE(u >>> 0);
  const offs = []; let p = 0;
  while ((p = buf.indexOf(tgt, p)) !== -1) { offs.push(p); p += 1; if (offs.length > cap) break; }
  return offs;
}

console.log(`${save} ${target}: zone @0x${zoneStart.toString(16)}..0x${zoneEnd.toString(16)} count=${count}`);
console.log("uuid    att cls | totalOcc | non-zone occurrence offsets");
for (let k = 0; k < count; k++) {
  const o = zoneStart + k * 16;
  const uuid = buf.readUInt32LE(o);
  const att = buf.readUInt32LE(o + 8);
  const cls = buf.readUInt32LE(o + 4);
  const offs = countOcc(uuid, 30);
  // exclude the in-zone occurrence
  const nonZone = offs.filter(x => x < zoneStart || x >= zoneEnd);
  const tag = att === 4 ? "WARMOOD" : "";
  console.log(`${String(uuid).padStart(5)}   ${att}   ${cls} | ${String(offs.length).padStart(2)}${offs.length > 30 ? "+" : ""} | ${nonZone.slice(0, 6).map(x => "0x" + x.toString(16)).join(" ")} ${tag}`);
}
