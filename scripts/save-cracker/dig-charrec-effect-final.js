// dig-charrec-effect-final.js
// Definitive absolute-correlation effect->slot map INCLUDING ancillary effects.
// Expected per char = sum over traits(active-level effects) + sum over
// ancillaries(effects). Compare to each byte slot. Report best slot per effect
// and the consolidated slot->effect table. Run across multiple saves to confirm.
const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
const modPath = "C:/RIS/RIS";
const names = fs.readFileSync(path.join(modPath, "data/descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitsTxt = fs.readFileSync(path.join(modPath, "data/export_descr_character_traits.txt"), "utf8");
const ancTxt = fs.readFileSync(path.join(modPath, "data/export_descr_ancillaries.txt"), "utf8");

const traitNames = [];
const traitDef = new Map();
{
  let curTrait=null,curLevel=null;
  for (let raw of traitsTxt.split(/\r?\n/)) { const line=raw.trim(); let m;
    if((m=line.match(/^Trait\s+([A-Za-z0-9_]+)/))){curTrait=m[1];traitNames.push(curTrait);traitDef.set(curTrait,[]);curLevel=null;}
    else if(curTrait&&(m=line.match(/^Level\s+([A-Za-z0-9_]+)/))){curLevel={threshold:null,effects:[]};traitDef.get(curTrait).push(curLevel);}
    else if(curLevel&&(m=line.match(/^Threshold\s+(\d+)/)))curLevel.threshold=parseInt(m[1],10);
    else if(curLevel&&(m=line.match(/^Effect\s+([A-Za-z0-9_]+)\s+(-?\d+)/)))curLevel.effects.push({name:m[1],val:parseInt(m[2],10)});
  }
}
// ancillary: index by declaration order (matches v1 ancillary id per project notes)
const ancNames=[]; const ancDef=new Map();
{
  let cur=null;
  for(let raw of ancTxt.split(/\r?\n/)){ const line=raw.trim(); let m;
    if((m=line.match(/^Ancillary\s+([A-Za-z0-9_]+)/))){cur=m[1];ancNames.push(cur);ancDef.set(cur,[]);}
    else if(cur&&(m=line.match(/^Effect\s+([A-Za-z0-9_]+)\s+(-?\d+)/)))ancDef.get(cur).push({name:m[1],val:parseInt(m[2],10)});
  }
}
function activeLevelIdx(def,points){let idx=0;for(let i=0;i<def.length;i++){const th=def[i].threshold==null?(i===0?0:1):def[i].threshold;if(points>=th)idx=i;else break;}return idx;}

const { findCharacterRecords } = require("../../src/characterParser.js");
const SLOTS=[]; for(let p=94;p<=298;p+=4) SLOTS.push(p);
const files = process.argv.slice(2).length? process.argv.slice(2):["save_macedon t0.sav","save_Seleucids t0.sav"];

// (effect,slot)->{match,total} accumulated across files
const accum=new Map();
function bump(eff,slot,ok){if(!accum.has(eff))accum.set(eff,new Map());const m=accum.get(eff);if(!m.has(slot))m.set(slot,{match:0,total:0});const r=m.get(slot);r.total++;if(ok)r.match++;}

for(const f of files){
  let buf; try{buf=fs.readFileSync(SAVES+f);}catch(e){console.log("skip "+f);continue;}
  const v1=findCharacterRecords(buf,names,traitNames,null);
  for(const c of v1){
    const exp=new Map();
    for(const t of (c.traits||[])){ const def=traitDef.get(t.name); if(!def||!def.length) continue; for(const e of def[activeLevelIdx(def,t.points)].effects) exp.set(e.name,(exp.get(e.name)||0)+e.val); }
    for(const a of (c.ancillaries||[])){ const an=ancNames[a.id]; if(!an) continue; const eff=ancDef.get(an)||[]; for(const e of eff) exp.set(e.name,(exp.get(e.name)||0)+e.val); }
    const lb=c.lastName===null;
    for(const p of SLOTS){ const phys=lb?c.offset+p:c.offset+p+4; if(phys+4>buf.length) continue; const val=buf.readInt32LE(phys);
      // accumulate per effect that the char has nonzero expected, plus a "zero" check for all effects observed in slot
      for(const [eff,e] of exp){ if(e===0) continue; bump(eff,p,val===e); }
    }
  }
}

console.log(`files: ${files.join(", ")}`);
console.log("\n=== effect -> best slot (absolute incl ancillaries, >=5 samples) ===");
const rows=[];
for(const [eff,m] of accum){ let best=null; for(const [slot,r] of m){ if(r.total<5) continue; const rate=r.match/r.total; if(!best||rate>best.rate||(rate===best.rate&&r.total>best.total)) best={slot,rate,...r}; } if(best) rows.push({eff,...best}); }
rows.sort((a,b)=>a.slot-b.slot);
let lastSlot=null;
for(const r of rows){ if(r.rate<0.5) continue; const flag=r.rate>=0.95?"***":r.rate>=0.85?" **":r.rate>=0.7?"  *":""; console.log(`  +${String(r.slot).padEnd(4)} <- ${r.eff.padEnd(22)} ${(r.rate*100).toFixed(0)}% (${r.match}/${r.total}) ${flag}`); }
console.log("\n=== Top by confidence ===");
rows.sort((a,b)=>b.rate-a.rate||b.total-a.total);
for(const r of rows.slice(0,30)){ const flag=r.rate>=0.95?"***":r.rate>=0.85?" **":r.rate>=0.7?"  *":""; console.log(`  +${String(r.slot).padEnd(4)} ${r.eff.padEnd(22)} ${(r.rate*100).toFixed(0)}% (${r.match}/${r.total}) ${flag}`); }
