// dig-econ-f13-endturn.js
// Hypothesis: f13 of history-block b = the faction's TREASURY at the END of game
// turn (b+1), i.e. an end-of-turn treasury snapshot timeline. Validate with the
// paired End/Start autosaves which bracket the turn-processing income event:
//   "... Turn N End"  vs  "... Turn N+1 Start"
// At "Turn N End" the live treasury (+0) should equal f13 of block N-1 in the
// "Turn N+1 Start" save (and the Start save's live treasury == that same value
// if no spend happened between end & start).
const fs = require("fs");
const path = require("path");
const { parseFactionTreasuries } = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";

function ordinal0(buf, core){for(let off=core-4;off>=core-40000;off-=4){if(off<0)break;if(buf.readUInt32LE(off)===off)return off;}return -1;}
function blocksFor(buf, core){const start=ordinal0(buf,core);const f=[];for(let o=start;o+4<=core;o+=4)f.push(buf.readInt32LE(o));const body=f.slice(2,f.length-1);const S=23;if(body.length%S)return null;const bl=[];for(let b=0;b<body.length/S;b++)bl.push(body.slice(b*S,(b+1)*S));return bl;}

// Identify the PLAYER record per save. We can't rely on a fixed factionId across
// campaigns, but the player record is the FIRST class-100 in file order (per
// memory: player record sits before all NPC majors). Use offset order.
function playerRecord(buf){
  const recs = parseFactionTreasuries(buf);
  if (!recs.length) return null;
  // Player record = lowest offset (memory: player record precedes NPC majors).
  return recs.sort((a,b)=>a.offset-b.offset)[0];
}

function load(name){const p=path.join(BASE,name);if(!fs.existsSync(p))return null;const buf=fs.readFileSync(p);const pr=playerRecord(buf);if(!pr)return {buf,pr:null,bl:null,nRecs:0};const bl=blocksFor(buf,pr.offset);return {buf,pr,bl,nRecs:parseFactionTreasuries(buf).length};}

function report(name){
  const d=load(name);
  if(!d){console.log(`MISSING: ${name}`);return null;}
  if(!d.pr){console.log(`  "${name}"\n     NO class-100 records (count=${d.nRecs})`);return d;}
  const f13=d.bl?d.bl.map(b=>b[13]):null;
  console.log(`  "${name}"`);
  console.log(`     player fid=${d.pr.factionId} treasury(+0)=${d.pr.treasury} blocks=${d.bl?d.bl.length:'?'} f13hist=[${f13?f13.join(","):'?'}]`);
  return d;
}

const pairs = [
  ["save_Autosave   Spain   Turn 3 End.sav", "save_Autosave   Spain   Turn 4 Start.sav"],
  ["save_Autosave   Carthage   Turn 1 End.sav", "save_Autosave   Carthage   Turn 2 Start.sav"],
  ["save_Autosave   Dummies   Turn 7 End.sav", "save_Autosave   Dummies   Turn 8 Start.sav"],
  ["save_Autosave   Republic of Rome   Turn 4 End.sav", "save_Autosave   Republic of Rome   Turn 5 Start.sav"],
];

for(const [endN, startN] of pairs){
  console.log(`\n=== ${endN}  ||  ${startN} ===`);
  const e=report(endN);
  const s=report(startN);
  if(e&&s&&e.bl&&s.bl){
    // The END save's live treasury should equal the LAST f13 (the just-finalized
    // turn). The START save adds one block; its block[lastEndBlock].f13 should
    // equal the END live treasury.
    const endLive=e.pr.treasury;
    const startBlocks=s.bl.length;
    // f13 of the block that represents the just-ended turn = second-to-last in start save
    const justEndedF13 = s.bl.length>=2 ? s.bl[s.bl.length-2][13] : null;
    console.log(`     -> END live treasury=${endLive}; START save's prior-turn f13=${justEndedF13}; MATCH=${endLive===justEndedF13}`);
    // Also: END save last f13 (its own most recent completed block)
    const endLastF13 = e.bl[e.bl.length-1][13] || (e.bl.length>=2?e.bl[e.bl.length-2][13]:null);
    console.log(`     -> END save f13hist last non-zero vs END live: lastBlk f13=${e.bl[e.bl.length-1][13]}`);
  }
}
