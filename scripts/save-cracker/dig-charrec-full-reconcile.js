// dig-charrec-full-reconcile.js
// Full per-character reconciliation: for chosen chars, list every NONZERO array
// slot and the expected effect value (sum of trait active-level effects +
// ancillary effects). If the slot->effect labels are right, the nonzero slot
// values should match the expected totals for the labeled effect.
const fs = require("fs");
const path = require("path");
const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";
const modPath = "C:/RIS/RIS";
const names = fs.readFileSync(path.join(modPath, "data/descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitsTxt = fs.readFileSync(path.join(modPath, "data/export_descr_character_traits.txt"), "utf8");
const ancTxt = fs.readFileSync(path.join(modPath, "data/export_descr_ancillaries.txt"), "utf8");
const traitNames=[]; const traitDef=new Map();
{ let ct=null,cl=null; for(let raw of traitsTxt.split(/\r?\n/)){const l=raw.trim();let m;
  if((m=l.match(/^Trait\s+([A-Za-z0-9_]+)/))){ct=m[1];traitNames.push(ct);traitDef.set(ct,[]);cl=null;}
  else if(ct&&(m=l.match(/^Level\s+([A-Za-z0-9_]+)/))){cl={threshold:null,effects:[]};traitDef.get(ct).push(cl);}
  else if(cl&&(m=l.match(/^Threshold\s+(\d+)/)))cl.threshold=parseInt(m[1],10);
  else if(cl&&(m=l.match(/^Effect\s+([A-Za-z0-9_]+)\s+(-?\d+)/)))cl.effects.push({name:m[1],val:parseInt(m[2],10)});}}
const ancNames=[]; const ancDef=new Map();
{ let c=null; for(let raw of ancTxt.split(/\r?\n/)){const l=raw.trim();let m;
  if((m=l.match(/^Ancillary\s+([A-Za-z0-9_]+)/))){c=m[1];ancNames.push(c);ancDef.set(c,[]);}
  else if(c&&(m=l.match(/^Effect\s+([A-Za-z0-9_]+)\s+(-?\d+)/)))ancDef.get(c).push({name:m[1],val:parseInt(m[2],10)});}}
function activeLevelIdx(def,points){let idx=0;for(let i=0;i<def.length;i++){const th=def[i].threshold==null?(i===0?0:1):def[i].threshold;if(points>=th)idx=i;else break;}return idx;}

// Derived slot->effect labels (from dig-charrec-slot-order.js, high+mid conf)
const SLOT_EFFECT = {
 98:"Command",102:"Influence",106:"Management",122:"Loyalty",
 126:"Attack",130:"Defence",134:"SiegeAttack",142:"Ambush",150:"SiegeEngineering",
 154:"NightBattle",158:"PersonalSecurity",162:"PublicSecurity",170:"BribeResistance",
 178:"LineOfSight",186:"TrainingAgents",190:"Construction",194:"Trading",198:"LocalPopularity",
 202:"BodyguardValour",210:"Farming",214:"Mining",218:"TaxCollection",222:"Fertility",
 226:"CavalryCommand",230:"InfantryCommand",242:"Health",246:"Squalor",250:"Unrest",
 254:"Law",262:"SenateStanding",266:"PopularStanding",270:"FootInTheDoor",274:"BodyguardValour?",
};

const { findCharacterRecords } = require("../../src/characterParser.js");
const buf = fs.readFileSync(SAVE);
const v1=findCharacterRecords(buf,names,traitNames,null);
const want = process.argv.slice(3);
let picks;
if(want.length) picks = v1.filter(c=>want.includes(c.firstName));
else picks = v1.filter(c=>(c.traits||[]).length>=8 && c.lastName===null).slice(0,4);

for(const c of picks){
  const exp=new Map();
  for(const t of (c.traits||[])){const def=traitDef.get(t.name);if(!def||!def.length)continue;for(const e of def[activeLevelIdx(def,t.points)].effects)exp.set(e.name,(exp.get(e.name)||0)+e.val);}
  for(const a of (c.ancillaries||[])){const an=ancNames[a.id];if(!an)continue;for(const e of (ancDef.get(an)||[]))exp.set(e.name,(exp.get(e.name)||0)+e.val);}
  const adj=c.lastName===null?0:4;
  console.log("\n"+"=".repeat(72));
  console.log(`${c.firstName}${c.lastName?(" "+c.lastName):""} traits=${c.traits.length} anc=${(c.ancillaries||[]).length}`);
  console.log(`  traits: ${c.traits.map(t=>t.name+":"+t.points).join(", ")}`);
  console.log(`  NONZERO slots vs labeled-effect expected:`);
  for(let p=98;p<=294;p+=4){ const o=c.offset+p+adj; if(o+4>buf.length) break; const v=buf.readInt32LE(o); if(v===0) continue;
    const lbl=SLOT_EFFECT[p]; const e = lbl?(exp.get(lbl.replace("?",""))||0):null;
    const ok = lbl && v===e ? "OK" : lbl ? "MISMATCH" : "?";
    console.log(`    +${String(p).padEnd(4)} val=${String(v).padStart(4)}  ${lbl?lbl.padEnd(18):"(unlabeled)".padEnd(18)} expected=${e===null?"-":e}  ${ok}`);
  }
}
