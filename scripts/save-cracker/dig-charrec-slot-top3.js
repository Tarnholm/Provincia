// dig-charrec-slot-top3.js
// For each array slot, list the TOP 3 candidate effects by (allMatch rate where
// expected!=0 contributes) so ambiguous slots can be disambiguated. Uses
// absolute reconstruction incl ancillaries across Macedon+Seleucid t0.
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
const chars=[];
for(const f of ["save_macedon t0.sav","save_Seleucids t0.sav"]){ const buf=fs.readFileSync(SAVES+f); const v1=findCharacterRecords(buf,names,traitNames,null);
  for(const c of v1){ const exp=new Map();
    for(const t of (c.traits||[])){const def=traitDef.get(t.name);if(!def||!def.length)continue;for(const e of def[activeLevelIdx(def,t.points)].effects)exp.set(e.name,(exp.get(e.name)||0)+e.val);}
    for(const a of (c.ancillaries||[])){const an=ancNames[a.id];if(!an)continue;for(const e of (ancDef.get(an)||[]))exp.set(e.name,(exp.get(e.name)||0)+e.val);}
    chars.push({buf,offset:c.offset,lb:c.lastName===null,exp});}}
const allEff=new Set(); for(const ch of chars) for(const k of ch.exp.keys()) allEff.add(k);
const SLOTS=[]; for(let p=98;p<=294;p+=4) SLOTS.push(p);
console.log(`chars=${chars.length}`);
for(const p of SLOTS){
  const cands=[];
  for(const eff of allEff){ let m=0,t=0; for(const ch of chars){ const phys=ch.lb?ch.offset+p:ch.offset+p+4; if(phys+4>ch.buf.length) continue; const e=ch.exp.get(eff)||0; if(e===0) continue; t++; const val=ch.buf.readInt32LE(phys); if(val===e)m++; } if(t>=5) cands.push({eff,m,t,rate:m/t}); }
  cands.sort((a,b)=>b.m-a.m||b.rate-a.rate);
  const top=cands.slice(0,3).map(x=>`${x.eff}(${x.m}/${x.t}=${(x.rate*100).toFixed(0)}%)`).join("  ");
  console.log(`  +${String(p).padEnd(4)} ${top||"<none>"}`);
}
