// Relaxed stance-table test for SELEUCID (the strongly-constrained case):
// Look for ANY array (strides 1/2/4, lengths 23..239) where the values at
// the war indices AND ally indices both DIFFER from the array's dominant
// (neutral) value. War and ally need NOT be equal to each other (a 3-value
// enum: war/neutral/ally). This is the most permissive plausible encoding.
const fs = require("fs");
const {
  parseDescrStratFactionRelationships, parseCampaignScriptDiplomacy, mergeFactionRelationships,
} = require("C:/dev/Provincia/src/parsers.js");
function loadOrder(p){const t=fs.readFileSync(p,"utf8");const o=[];let c=null;for(const l of t.split(/\r?\n/)){const fm=l.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);if(fm){c=fm[1];continue;}if(c){const cm=l.match(/^\s*"culture":\s*"([a-z_]+)"/);if(cm){o.push(c);c=null;}}}return o;}
const order = loadOrder("C:\\RIS\\RIS\\data\\descr_sm_factions.txt");
const DS="C:\\RIS\\RIS\\data\\world\\maps\\campaign\\imperial_campaign\\descr_strat.txt";
const SC="C:\\RIS\\RIS\\data\\world\\maps\\campaign\\imperial_campaign\\RIS_Campaign_Script.txt";
const merged = mergeFactionRelationships(parseDescrStratFactionRelationships(fs.readFileSync(DS,"utf8")),parseCampaignScriptDiplomacy(fs.readFileSync(SC,"utf8")));

const path = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_Seleucids t0.sav";
const buf = fs.readFileSync(path);
const rel = merged.seleucid;
const warIdx = rel.filter(r=>r.kind==="war").map(r=>order.indexOf(r.to)).filter(i=>i>=0);
const allyIdx = rel.filter(r=>r.kind==="ally"||r.kind==="protects").map(r=>order.indexOf(r.to)).filter(i=>i>=0);
console.log(`seleucid wars=${warIdx} allies=${allyIdx}`);

// For a 239-length table at each base, check: at war indices the value is
// non-default, at ally indices non-default, and war-default != ally-default.
const N = order.length;
for (const stride of [1,2,4]) {
  const reader = stride===1?(o)=>buf[o]:stride===2?(o)=>buf.readUInt16LE(o):(o)=>buf.readUInt32LE(o);
  let hits = 0; const examples=[];
  for (let base=0; base + N*stride <= buf.length; base++) {
    // dominant value
    // (cheap pre-filter: war index 46 value must be small)
    const vWars = warIdx.map(i=>reader(base+i*stride));
    const vAllies = allyIdx.map(i=>reader(base+i*stride));
    if (vWars.some(v=>v>16) || vAllies.some(v=>v>16)) continue;
    // compute mode over full table
    const counts={}; for(let i=0;i<N;i++){const v=reader(base+i*stride);counts[v]=(counts[v]||0)+1;}
    let mode=0,modeVal=-1; for(const [v,c] of Object.entries(counts)){if(c>mode){mode=c;modeVal=+v;}}
    if (mode > N-3 || mode < N*0.4) continue; // need a clear neutral majority but not constant
    // war & ally values must differ from neutral(modeVal)
    if (vWars.some(v=>v===modeVal)) continue;
    if (vAllies.some(v=>v===modeVal)) continue;
    // all wars same, all allies same
    if (!vWars.every(v=>v===vWars[0])) continue;
    if (!vAllies.every(v=>v===vAllies[0])) continue;
    hits++;
    if (examples.length<10) examples.push(`0x${base.toString(16)}(neutral=${modeVal},war=${vWars[0]},ally=${vAllies[0]})`);
  }
  console.log(`stride=${stride}: ${hits} hits. ${examples.join(" ")}`);
}
