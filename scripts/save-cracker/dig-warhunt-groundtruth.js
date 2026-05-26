// dig-warhunt-groundtruth.js
// Establish ground truth: faction-id mapping (RIS order) + the exact wars we
// must locate in the two turn-0 saves. Then dump faction records (treasuries),
// the player record location, and the diplo-zone summary so we have all anchors.
"use strict";
const fs = require("fs");
const {
  parseHeader,
  parseFactionTreasuries,
  identifyFactionRecordOwners,
  identifyPlayerFactionFromSave,
} = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const RIS_FACTIONS = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
const REL = "C:/dev/Provincia/public/faction_relationships_large.json";

function loadFactionOrder(path) {
  const txt = fs.readFileSync(path, "utf8");
  const order = [];
  let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) {
      const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/);
      if (cm) { order.push(cur); cur = null; }
    }
  }
  return order;
}

const order = loadFactionOrder(RIS_FACTIONS);
const idOf = {};
order.forEach((f, i) => { idOf[f] = i; });
console.log(`RIS faction order: ${order.length} factions`);
console.log(order.map((f, i) => `${i}:${f}`).join("  "));

const rels = JSON.parse(fs.readFileSync(REL, "utf8"));
function warsOf(fac) {
  const out = [];
  for (const r of (rels[fac] || [])) if (r.kind === "war") out.push(r.to);
  return out;
}

console.log("\n=== GROUND-TRUTH WARS (from mod files) ===");
for (const fac of ["seleucid", "antigonid"]) {
  const w = warsOf(fac);
  console.log(`${fac}(id ${idOf[fac]}) at war with: ${w.map(t => `${t}(id ${idOf[t]})`).join(", ")}`);
}

const SAVES = {
  seleucid: SAVES_DIR + "save_Seleucids t0.sav",
  macedon: SAVES_DIR + "save_macedon t0.sav",
};

for (const [tag, path] of Object.entries(SAVES)) {
  console.log(`\n\n===================== ${tag} (${path.split("\\").pop()}) =====================`);
  const buf = fs.readFileSync(path);
  console.log(`size = ${buf.length}`);
  const recs = parseFactionTreasuries(buf);
  const owners = identifyFactionRecordOwners(buf, recs, order);
  const player = identifyPlayerFactionFromSave(buf, recs);
  console.log(`player faction (banner heuristic): ${player} (id ${idOf[player]})`);
  console.log(`major faction records: ${recs.length}, first at 0x${recs[0].offset.toString(16)}`);
  console.log("rec  offset      factionId  name                 regions  diploMarker@");
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    const name = owners[i].factionName;
    const diploOff = r.offset + 244 + 4 * r.regionCount;
    console.log(`${String(i).padStart(2)}   0x${r.offset.toString(16).padStart(8, "0")}  ${String(r.factionId).padStart(3)}        ${(name||"?").padEnd(20)} ${String(r.regionCount).padStart(3)}     0x${diploOff.toString(16)}`);
  }
}
