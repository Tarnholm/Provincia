// dig-charrec-clean-delta.js
// CLEANEST validation: across consecutive save pairs, for each char find cases
// where exactly ONE named effect's expected total changed (delta). Then check
// which slot moved by exactly that delta. This isolates slot<->effect with no
// cross-contamination. Reports a confusion-free slot map.
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
function effOf(c){ const exp=new Map();
  for(const t of (c.traits||[])){const def=traitDef.get(t.name);if(!def||!def.length)continue;for(const e of def[activeLevelIdx(def,t.points)].effects)exp.set(e.name,(exp.get(e.name)||0)+e.val);}
  for(const a of (c.ancillaries||[])){const an=ancNames[a.id];if(!an)continue;for(const e of (ancDef.get(an)||[]))exp.set(e.name,(exp.get(e.name)||0)+e.val);}
  return exp; }
const { findCharacterRecords } = require("../../src/characterParser.js");
const SLOTS=[]; for(let p=98;p<=294;p+=4) SLOTS.push(p);
const pairs=[["save_t0.sav","save_t1.sav"],["save_t1.sav","save_t2.sav"],["save_t2.sav","save_t3.sav"],["save_t3.sav","save_t4.sav"],["save_t4.sav","save_t5.sav"],["save_t5.sav","save_t6.sav"],["save_t6.sav","save_t7.sav"]];
// (effect)-> Map(slot-> {match,total}) for SINGLE-effect-change chars
const map=new Map();
function bump(eff,slot,ok){if(!map.has(eff))map.set(eff,new Map());const m=map.get(eff);if(!m.has(slot))m.set(slot,{match:0,total:0});const r=m.get(slot);r.total++;if(ok)r.match++;}
let usable=0;
for(const [fa,fb] of pairs){ let bufA,bufB; try{bufA=fs.readFileSync(SAVES+fa);bufB=fs.readFileSync(SAVES+fb);}catch(e){continue;}
  const recA=findCharacterRecords(bufA,names,traitNames,null); const recB=findCharacterRecords(bufB,names,traitNames,null);
  const idxB=new Map(); for(const c of recB) if(c.primaryUuid&&c.primaryUuid!==0xffffffff) idxB.set(c.primaryUuid,c);
  for(const a of recA){ if(!a.primaryUuid||a.primaryUuid===0xffffffff) continue; const b=idxB.get(a.primaryUuid); if(!b) continue; if((a.lastName===null)!==(b.lastName===null)) continue;
    const eA=effOf(a), eB=effOf(b); const keys=new Set([...eA.keys(),...eB.keys()]); const changed=[];
    for(const k of keys){ const d=(eB.get(k)||0)-(eA.get(k)||0); if(d!==0) changed.push([k,d]); }
    if(changed.length!==1) continue; // EXACTLY ONE effect changed
    usable++;
    const [eff,d]=changed[0]; const lb=a.lastName===null;
    for(const p of SLOTS){ const pa=lb?a.offset+p:a.offset+p+4, pb=lb?b.offset+p:b.offset+p+4; if(pa+4>bufA.length||pb+4>bufB.length) continue; const od=bufB.readInt32LE(pb)-bufA.readInt32LE(pa); bump(eff,p,od===d); }
  }
}
console.log(`single-effect-change samples: ${usable}`);
console.log("\n=== effect -> best slot (single-effect delta, >=3 samples) ===");
const rows=[];
for(const [eff,m] of map){ let best=null; for(const [slot,r] of m){ if(r.total<3) continue; const rate=r.match/r.total; if(!best||r.match>best.match||(r.match===best.match&&rate>best.rate)) best={slot,rate,...r}; } if(best&&best.rate>=0.5) rows.push({eff,...best}); }
rows.sort((a,b)=>a.slot-b.slot);
for(const r of rows){ const flag=r.rate>=0.95?"***":r.rate>=0.8?" **":""; console.log(`  +${String(r.slot).padEnd(4)} <- ${r.eff.padEnd(20)} ${(r.rate*100).toFixed(0)}% (${r.match}/${r.total}) ${flag}`); }
