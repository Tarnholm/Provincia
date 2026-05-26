// dig-warhunt-attitude-test.js
// Test whether NPC-zone class==2 or attitude==4 entry COUNT matches the
// ground-truth war count for the cross-validating records.
// seleucid wars: bithynia, seleucid_rebels, seleucid_rebels2 = 3 wars (but
//   rebels may not have records / may be separate). Also seleucid is ally with
//   many. NOTE: at t0 the live game state likely == mod-file state.
// antigonid wars: epirus, galatians = 2.
"use strict";
const fs = require("fs");
const {
  parseFactionTreasuries,
  identifyFactionRecordOwners,
} = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const RIS_FACTIONS = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
const REL = "C:/dev/Provincia/public/faction_relationships_large.json";

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
const rels = JSON.parse(fs.readFileSync(REL, "utf8"));
function relsOf(fac, kind) { return (rels[fac] || []).filter(r => r.kind === kind).map(r => r.to); }

const SAVES = ["save_macedon t0.sav", "save_Seleucids t0.sav"];

for (const save of SAVES) {
  const buf = fs.readFileSync(SAVES_DIR + save);
  const recs = parseFactionTreasuries(buf);
  const owners = identifyFactionRecordOwners(buf, recs, order);
  console.log(`\n===== ${save} =====`);
  console.log("name           cnt | byClass{0,1,2,4,oth} | byAtt{0,1,2,3,4} || GT wars/allies");
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    const name = owners[i].factionName || "?";
    const diploOff = r.offset + 244 + 4 * r.regionCount;
    if (buf.readUInt32LE(diploOff) !== 0x39240005) { console.log(`${name}: no marker`); continue; }
    const count = buf.readUInt32LE(diploOff + 4);
    if (count > 200) { console.log(`${name}: count ${count} too big`); continue; }
    const byClass = { 0: 0, 1: 0, 2: 0, 4: 0, oth: 0 };
    const byAtt = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, oth: 0 };
    for (let k = 0; k < count; k++) {
      const o = diploOff + 8 + k * 16;
      const cls = buf.readUInt32LE(o + 4);
      const att = buf.readUInt32LE(o + 8);
      if (byClass[cls] !== undefined) byClass[cls]++; else byClass.oth++;
      if (byAtt[att] !== undefined) byAtt[att]++; else byAtt.oth++;
    }
    const w = relsOf(name, "war"); const a = relsOf(name, "ally");
    console.log(`${name.padEnd(14)} ${String(count).padStart(3)} | {${byClass[0]},${byClass[1]},${byClass[2]},${byClass[4]},${byClass.oth}} | {${byAtt[0]},${byAtt[1]},${byAtt[2]},${byAtt[3]},${byAtt[4]}} || w=${w.length}[${w.join(",")}] a=${a.length}`);
  }
}
