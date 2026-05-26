// Look for a parallel array with count == diploCount (115 seleucid / 34 antigonid)
// whose entries are faction-ids (0..238). This would be the partner list aligned
// to the diplo zone entries.
const fs = require("fs");
const {
  parseFactionTreasuries,
  identifyPlayerFactionFromSave,
} = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const {
  parseDescrStratFactionRelationships, parseCampaignScriptDiplomacy, mergeFactionRelationships,
} = require("C:/dev/Provincia/src/parsers.js");

const SAVES = {
  seleucid: ["C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_Seleucids t0.sav", 7],
  antigonid: ["C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav", 5],
};
const SM = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
const DS = "C:\\RIS\\RIS\\data\\world\\maps\\campaign\\imperial_campaign\\descr_strat.txt";
const SC = "C:\\RIS\\RIS\\data\\world\\maps\\campaign\\imperial_campaign\\RIS_Campaign_Script.txt";
function loadOrder(p){const t=fs.readFileSync(p,"utf8");const o=[];let c=null;for(const l of t.split(/\r?\n/)){const fm=l.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);if(fm){c=fm[1];continue;}if(c){const cm=l.match(/^\s*"culture":\s*"([a-z_]+)"/);if(cm){o.push(c);c=null;}}}return o;}
const order = loadOrder(SM);
const merged = mergeFactionRelationships(parseDescrStratFactionRelationships(fs.readFileSync(DS,"utf8")),parseCampaignScriptDiplomacy(fs.readFileSync(SC,"utf8")));
const MARKER = 0x39240005;

for (const [label, [path, pidx]] of Object.entries(SAVES)) {
  const buf = fs.readFileSync(path);
  const recs = parseFactionTreasuries(buf);
  const player = identifyPlayerFactionFromSave(buf, recs);
  const firstMajor = recs[0].offset;
  let markerOff = -1;
  for (let i = 0; i + 8 < firstMajor; i++) { if (buf.readUInt32LE(i)!==MARKER) continue; const cnt=buf.readUInt32LE(i+4); if(cnt>0&&cnt<=250){markerOff=i;break;} }
  const count = buf.readUInt32LE(markerOff + 4);
  const zoneEnd = markerOff + 8 + count * 16;
  console.log(`\n===== ${label} (${player}, idx=${pidx}) count=${count} =====`);

  // Search a wide window around the player record for a run of `count` u32 (or u16/u8)
  // where every value is a plausible faction id (0..238) and the set has many distinct.
  function scanForFactionArray(stride, reader, name) {
    const lo = Math.max(0, markerOff - 1500000), hi = firstMajor;
    const hits = [];
    for (let base = lo; base + count * stride <= hi; base++) {
      let ok = true, distinct = new Set();
      for (let k = 0; k < count; k++) {
        const v = reader(base + k * stride);
        if (v < 0 || v > 238) { ok = false; break; }
        distinct.add(v);
      }
      if (!ok) continue;
      if (distinct.size < count * 0.7) continue; // mostly-distinct
      hits.push({ base, distinct: distinct.size });
    }
    if (hits.length) console.log(`  [${name} stride=${stride}] ${hits.length} candidate arrays. first: ${hits.slice(0,5).map(h=>`0x${h.base.toString(16)}(d=${h.distinct})`).join(" ")}`);
    else console.log(`  [${name} stride=${stride}] none`);
    return hits;
  }
  scanForFactionArray(1, (o)=>buf[o], "u8");
  scanForFactionArray(2, (o)=>buf.readUInt16LE(o), "u16");
  scanForFactionArray(4, (o)=>buf.readUInt32LE(o), "u32");
}
