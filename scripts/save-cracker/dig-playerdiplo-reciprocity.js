// Reciprocity test: collect EVERY faction's diplo zone (all ~221 of them via
// the markerOff-53 owner heuristic), index each relation uuid by which faction
// zone(s) it appears in. If a uuid appears in EXACTLY two zones, those two
// factions are the partners. That would crack named diplomacy directly.
const fs = require("fs");
const {
  parseFactionTreasuries, identifyPlayerFactionFromSave,
} = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const {
  parseDescrStratFactionRelationships, parseCampaignScriptDiplomacy, mergeFactionRelationships,
} = require("C:/dev/Provincia/src/parsers.js");

const SAVES = {
  seleucid: "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_Seleucids t0.sav",
  antigonid: "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav",
};
const SM="C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
const DS="C:\\RIS\\RIS\\data\\world\\maps\\campaign\\imperial_campaign\\descr_strat.txt";
const SC="C:\\RIS\\RIS\\data\\world\\maps\\campaign\\imperial_campaign\\RIS_Campaign_Script.txt";
function loadOrder(p){const t=fs.readFileSync(p,"utf8");const o=[];let c=null;for(const l of t.split(/\r?\n/)){const fm=l.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);if(fm){c=fm[1];continue;}if(c){const cm=l.match(/^\s*"culture":\s*"([a-z_]+)"/);if(cm){o.push(c);c=null;}}}return o;}
const order = loadOrder(SM);
const merged = mergeFactionRelationships(parseDescrStratFactionRelationships(fs.readFileSync(DS,"utf8")),parseCampaignScriptDiplomacy(fs.readFileSync(SC,"utf8")));
const MARKER=0x39240005;

for (const [label, path] of Object.entries(SAVES)) {
  const buf = fs.readFileSync(path);
  const player = label;
  console.log(`\n===== ${label} =====`);
  // Collect ALL zones via markerOff-53 owner byte.
  const zones = []; // {fid, name, off, count, entries:[{uuid,cls}]}
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count === 0 || count > 250) continue;
    const fid = buf[i - 53];
    if (fid >= order.length) continue;
    // validate entries fit
    let ok = true; const ents = [];
    for (let k = 0; k < count; k++) {
      const o = i + 8 + k*16; if (o+16 > buf.length){ok=false;break;}
      ents.push({ uuid: buf.readUInt32LE(o), cls: buf.readUInt32LE(o+4) });
    }
    if (!ok) continue;
    zones.push({ fid, name: order[fid], off: i, count, ents });
  }
  console.log(`zones found: ${zones.length}`);

  // Index uuid -> list of {fid, cls}
  const uuidMap = new Map();
  for (const z of zones) {
    for (const e of z.ents) {
      if (!uuidMap.has(e.uuid)) uuidMap.set(e.uuid, []);
      uuidMap.get(e.uuid).push({ fid: z.fid, name: z.name, cls: e.cls });
    }
  }
  // Distribution of how many zones each uuid appears in
  const dist = {};
  for (const [u, arr] of uuidMap) dist[arr.length] = (dist[arr.length]||0)+1;
  console.log(`uuid appearance-count distribution (how many zones each uuid is in): ${JSON.stringify(dist)}`);

  // uuids appearing in exactly 2 zones = potential partner pairs
  const pairs = [...uuidMap.entries()].filter(([u,a])=>a.length===2);
  console.log(`uuids in exactly 2 zones: ${pairs.length}`);
  for (const [u, a] of pairs.slice(0, 20)) {
    console.log(`  uuid ${u}: ${a[0].name}(cls${a[0].cls}) <-> ${a[1].name}(cls${a[1].cls})`);
  }
}
