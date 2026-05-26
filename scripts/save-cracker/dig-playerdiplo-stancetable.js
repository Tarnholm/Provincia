// Definitive test for a per-faction stance table indexed by faction id.
// Scan the WHOLE save for any byte-window of length 239 (the faction count)
// where the values at the player's KNOWN war indices are equal to each other
// and DIFFERENT from the values at the player's KNOWN ally indices, AND from
// the neutral default. A real stance table must satisfy this. We require a
// clean separation (war-set value != ally-set value != most-common value).
const fs = require("fs");
const {
  parseFactionTreasuries, identifyPlayerFactionFromSave,
} = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const {
  parseDescrStratFactionRelationships, parseCampaignScriptDiplomacy, mergeFactionRelationships,
} = require("C:/dev/Provincia/src/parsers.js");
function loadOrder(p){const t=fs.readFileSync(p,"utf8");const o=[];let c=null;for(const l of t.split(/\r?\n/)){const fm=l.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);if(fm){c=fm[1];continue;}if(c){const cm=l.match(/^\s*"culture":\s*"([a-z_]+)"/);if(cm){o.push(c);c=null;}}}return o;}
const order = loadOrder("C:\\RIS\\RIS\\data\\descr_sm_factions.txt");
const DS="C:\\RIS\\RIS\\data\\world\\maps\\campaign\\imperial_campaign\\descr_strat.txt";
const SC="C:\\RIS\\RIS\\data\\world\\maps\\campaign\\imperial_campaign\\RIS_Campaign_Script.txt";
const merged = mergeFactionRelationships(parseDescrStratFactionRelationships(fs.readFileSync(DS,"utf8")),parseCampaignScriptDiplomacy(fs.readFileSync(SC,"utf8")));

const SAVES = {
  seleucid: "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_Seleucids t0.sav",
  antigonid: "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav",
};
const N = order.length; // 239

for (const [label, path] of Object.entries(SAVES)) {
  const buf = fs.readFileSync(path);
  const rel = merged[label] || [];
  const warIdx = rel.filter(r=>r.kind==="war").map(r=>order.indexOf(r.to)).filter(i=>i>=0&&i<N);
  const allyIdx = rel.filter(r=>r.kind==="ally"||r.kind==="protects"||r.kind==="protected_by").map(r=>order.indexOf(r.to)).filter(i=>i>=0&&i<N);
  console.log(`\n===== ${label} =====`);
  console.log(`war indices: ${warIdx.join(",")}  ally/protect indices: ${allyIdx.join(",")}`);

  // Try strides 1 (u8), 2 (u16), 4 (u32).
  for (const stride of [1, 2, 4]) {
    const reader = stride===1 ? (o)=>buf[o] : stride===2 ? (o)=>buf.readUInt16LE(o) : (o)=>buf.readUInt32LE(o);
    const tableBytes = N * stride;
    const candidates = [];
    for (let base = 0; base + tableBytes <= buf.length; base++) {
      // war values
      let warVals = warIdx.map(i=>reader(base + i*stride));
      let allyVals = allyIdx.map(i=>reader(base + i*stride));
      // all wars equal, all allies equal, war!=ally
      const w0 = warVals[0], a0 = allyVals[0];
      if (!warVals.every(v=>v===w0)) continue;
      if (!allyVals.every(v=>v===a0)) continue;
      if (w0 === a0) continue;
      // both must be small (stance enums)
      if (w0 > 16 || a0 > 16) continue;
      // require the table not be all-same (compute the most common value)
      const counts = {};
      for (let i=0;i<N;i++){const v=reader(base+i*stride); counts[v]=(counts[v]||0)+1;}
      const mode = Math.max(...Object.values(counts));
      if (mode > N - 3) continue; // table is essentially constant -> noise
      candidates.push({ base, w0, a0, modeFrac:(mode/N).toFixed(2) });
      if (candidates.length > 40) break;
    }
    console.log(`  stride=${stride}: ${candidates.length} candidate stance tables (war-val=ally-val separation). first 8: ${candidates.slice(0,8).map(c=>`0x${c.base.toString(16)}(w=${c.w0},a=${c.a0},mode=${c.modeFrac})`).join(" ")}`);
  }
}
