// Dump the player's diplomacy zone raw entries. Check whether:
//  - entries are ordered by faction index (entry[k] = faction k?)
//  - relationUuid correlates with faction index
//  - class values match ground truth at the right positions
const fs = require("fs");
const {
  parseFactionTreasuries,
  identifyPlayerFactionFromSave,
} = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const {
  parseDescrStratFactionRelationships,
  parseCampaignScriptDiplomacy,
  mergeFactionRelationships,
} = require("C:/dev/Provincia/src/parsers.js");

const SAVES = {
  seleucid: "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_Seleucids t0.sav",
  antigonid: "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav",
};
const SM_FACTIONS = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
const DESCR_STRAT = "C:\\RIS\\RIS\\data\\world\\maps\\campaign\\imperial_campaign\\descr_strat.txt";
const SCRIPT = "C:\\RIS\\RIS\\data\\world\\maps\\campaign\\imperial_campaign\\RIS_Campaign_Script.txt";

function loadFactionOrder(path) {
  const txt = fs.readFileSync(path, "utf8");
  const order = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) { const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/); if (cm) { order.push(cur); cur = null; } }
  }
  return order;
}
const order = loadFactionOrder(SM_FACTIONS);
const merged = mergeFactionRelationships(
  parseDescrStratFactionRelationships(fs.readFileSync(DESCR_STRAT, "utf8")),
  parseCampaignScriptDiplomacy(fs.readFileSync(SCRIPT, "utf8"))
);
const MARKER = 0x39240005;

for (const [label, path] of Object.entries(SAVES)) {
  const buf = fs.readFileSync(path);
  const recs = parseFactionTreasuries(buf);
  const player = identifyPlayerFactionFromSave(buf, recs);
  const firstMajor = recs[0].offset;
  // find player's zone marker before firstMajor
  let markerOff = -1;
  for (let i = 0; i + 8 < firstMajor; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const cnt = buf.readUInt32LE(i + 4);
    if (cnt > 0 && cnt <= 250) { markerOff = i; break; }
  }
  const count = buf.readUInt32LE(markerOff + 4);
  console.log(`\n===== ${label} (${player}) markerOff=0x${markerOff.toString(16)} count=${count} =====`);

  // ground truth as index->kind map
  const rel = merged[player] || [];
  const gt = {};
  for (const r of rel) gt[order.indexOf(r.to)] = r.kind;

  // dump entries
  const entries = [];
  for (let k = 0; k < count; k++) {
    const o = markerOff + 8 + k * 16;
    entries.push({
      k,
      uuid: buf.readUInt32LE(o),
      cls: buf.readUInt32LE(o + 4),
      att: buf.readUInt32LE(o + 8),
      tag: buf.readUInt32LE(o + 12),
    });
  }
  // class distribution
  const clsDist = {};
  for (const e of entries) clsDist[e.cls] = (clsDist[e.cls] || 0) + 1;
  console.log(`class distribution: ${JSON.stringify(clsDist)}`);
  console.log(`uuid range: min=${Math.min(...entries.map(e=>e.uuid))} max=${Math.max(...entries.map(e=>e.uuid))}`);

  // Hypothesis A: entry[k].uuid == faction index k (ordered)? print first 20
  console.log(`first 24 entries (k | uuid | cls | att | tag):`);
  for (const e of entries.slice(0, 24)) {
    const fname = e.uuid < order.length ? order[e.uuid] : "?";
    console.log(`  k=${String(e.k).padStart(3)} uuid=${String(e.uuid).padStart(6)} cls=${e.cls} att=${e.att} tag=0x${e.tag.toString(16)}  uuid->${fname}`);
  }

  // Hypothesis B: uuid IS the faction index. Resolve each entry's uuid->faction and compare class vs ground truth
  console.log(`\nHypothesis: uuid = faction index. Non-default-class entries:`);
  let matchWar = 0, matchAlly = 0, total = 0;
  for (const e of entries) {
    if (e.uuid >= order.length) continue;
    const gtkind = gt[e.uuid];
    if (gtkind || e.cls === 0 || e.cls === 2 || e.cls === 4 || e.cls === 1) {
      console.log(`  uuid=${e.uuid}(${order[e.uuid]}) cls=${e.cls} att=${e.att}  GT=${gtkind||"neutral"}`);
    }
  }
}
