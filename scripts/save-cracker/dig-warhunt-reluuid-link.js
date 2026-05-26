// dig-warhunt-reluuid-link.js
// Hypothesis: the attitude-record array IS the global relationship-object pool.
// Each record (key=13, base=200, attitude=DS, flag, counter, relationUuid@+0x18)
// represents one directed relationship. The relationUuid@+0x18 links to the
// owner faction's diplo-zone entry (same uuid).
//
// Test in the Spain declareWAR save: collect all attitude records' relationUuids,
// and check whether the spain(18) and carthage(7) zones' WAR-ish entries' uuids
// match the att=600 records' uuids.
"use strict";
const fs = require("fs");
const STEAM_FACTIONS = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Total War ROME REMASTERED\\Contents\\Resources\\Data\\data\\descr_sm_factions.txt";
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
function loadFactionOrder(path) {
  const txt = fs.readFileSync(path, "utf8"); const order = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) { const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/); if (cm) { order.push(cur); cur = null; } }
  }
  return order;
}
const order = loadFactionOrder(STEAM_FACTIONS);
const buf = fs.readFileSync(SAVES_DIR + "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav");

// All attitude records (base=200 head + key=13 at -4), capture attitude + relUuid@+0x18.
const recs = [];
for (let o = 0x8000; o + 0x1c <= 0x3f000; o++) {
  if (buf.readUInt32LE(o) !== 200) continue;
  const att = buf.readUInt32LE(o + 4);
  if (![0,100,200,400,600,850,1000].includes(att)) continue;
  if (buf.readUInt32LE(o - 4) !== 13) continue; // key=13
  const relUuid = buf.readUInt32LE(o + 0x18);
  recs.push({ base: o, att, relUuid });
}
const byAtt = {};
for (const r of recs) byAtt[r.att] = (byAtt[r.att] || 0) + 1;
console.log(`attitude records (key=13): ${recs.length}  byAtt: ${JSON.stringify(byAtt)}`);
const war600 = recs.filter(r => r.att === 600);
console.log(`att=600 relUuids: ${war600.map(r => r.relUuid).sort((a,b)=>a-b).join(",")}`);

// Spain(18) and Carthage(7) diplo zones
const MARKER = 0x39240005;
function zone(fid) {
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count === 0 || count > 200) continue;
    if (buf[i - 53] !== fid) continue;
    const e = [];
    for (let k = 0; k < count; k++) { const o = i + 8 + k * 16; e.push({ uuid: buf.readUInt32LE(o), cls: buf.readUInt32LE(o+4), att: buf.readUInt32LE(o+8) }); }
    return e;
  }
  return null;
}
const spZone = zone(18), caZone = zone(7);
console.log(`\nSpain(18) zone uuids: ${spZone ? spZone.map(e=>`${e.uuid}(cls${e.cls},att${e.att})`).join(" ") : "none"}`);
console.log(`Carthage(7) zone uuids: ${caZone ? caZone.map(e=>`${e.uuid}(cls${e.cls},att${e.att})`).join(" ") : "none"}`);

// Which att=600 record uuids appear in spain or carthage zones?
const spUuids = new Set((spZone||[]).map(e=>e.uuid));
const caUuids = new Set((caZone||[]).map(e=>e.uuid));
for (const r of war600) {
  const inSp = spUuids.has(r.relUuid), inCa = caUuids.has(r.relUuid);
  if (inSp || inCa) console.log(`  600-record relUuid ${r.relUuid} @0x${r.base.toString(16)} -> in ${inSp?"SPAIN":""}${inCa?"CARTHAGE":""} zone`);
}
