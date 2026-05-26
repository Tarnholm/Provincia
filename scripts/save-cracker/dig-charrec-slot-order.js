// dig-charrec-slot-order.js
// For EACH byte slot, find the effect whose expected total best matches that
// slot's value across all chars (absolute, incl ancillaries). This derives the
// slot->effect order empirically (one winner per slot), independent of any
// assumed enum. Uses both Macedon and Seleucid t0 saves combined.
const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
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
const { findCharacterRecords } = require("../../src/characterParser.js");
const SLOTS=[]; for(let p=94;p<=298;p+=4) SLOTS.push(p);
const files=["save_macedon t0.sav","save_Seleucids t0.sav"];

// per char expected effect map
const chars=[];
for(const f of files){ const buf=fs.readFileSync(SAVES+f); const v1=findCharacterRecords(buf,names,traitNames,null);
  for(const c of v1){ const exp=new Map();
    for(const t of (c.traits||[])){const def=traitDef.get(t.name);if(!def||!def.length)continue;for(const e of def[activeLevelIdx(def,t.points)].effects)exp.set(e.name,(exp.get(e.name)||0)+e.val);}
    for(const a of (c.ancillaries||[])){const an=ancNames[a.id];if(!an)continue;for(const e of (ancDef.get(an)||[]))exp.set(e.name,(exp.get(e.name)||0)+e.val);}
    chars.push({buf,offset:c.offset,lb:c.lastName===null,exp});
  }
}
// all effect names seen
const allEff=new Set(); for(const ch of chars) for(const k of ch.exp.keys()) allEff.add(k);

// for each slot, evaluate every effect: count chars where slotval==expected AND expected!=0
console.log(`chars=${chars.length}  effects=${allEff.size}`);
console.log("\n=== per-slot winner (effect with most NZ matches, rate shown) ===");
for(const p of SLOTS){
  let best=null, bestRate=null;
  for(const eff of allEff){ let m=0,t=0,mAll=0,tAll=0;
    for(const ch of chars){ const phys=ch.lb?ch.offset+p:ch.offset+p+4; if(phys+4>ch.buf.length) continue; const val=ch.buf.readInt32LE(phys); const e=ch.exp.get(eff)||0; tAll++; if(val===e)mAll++; if(e!==0){t++; if(val===e)m++;} }
    if(t<5) continue; const rate=m/t;
    if(!best||m>best.m||(m===best.m&&rate>best.rate)) best={eff,m,t,rate,mAll,tAll};
  }
  // also compute, for the best, how many chars have slot==0 AND expected==0 (consistency)
  if(best){ const flag=best.rate>=0.9?"***":best.rate>=0.75?" **":best.rate>=0.6?"  *":""; console.log(`  +${String(p).padEnd(4)} ${best.eff.padEnd(20)} NZmatch=${best.m}/${best.t} (${(best.rate*100).toFixed(0)}%) allMatch=${(best.mAll/best.tAll*100).toFixed(0)}% ${flag}`); }
  else console.log(`  +${String(p).padEnd(4)} <no effect with >=5 NZ samples>`);
}
