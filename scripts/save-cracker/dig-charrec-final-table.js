// dig-charrec-final-table.js
// Consolidated, validated effect-array slot table. Combines:
//  (1) absolute correlation (incl ancillaries) across Macedon+Seleucid t0
//  (2) single-effect clean-delta across t0..t7
// Prints the final +94..+298 map with the winning effect per slot, the absolute
// allMatch%, and whether single-effect-delta corroborates.
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
const SLOTS=[]; for(let p=94;p<=298;p+=4) SLOTS.push(p);

// ABSOLUTE
const absChars=[];
for(const f of ["save_macedon t0.sav","save_Seleucids t0.sav"]){ const buf=fs.readFileSync(SAVES+f); const v1=findCharacterRecords(buf,names,traitNames,null); for(const c of v1) absChars.push({buf,offset:c.offset,lb:c.lastName===null,exp:effOf(c)}); }
const allEff=new Set(); for(const ch of absChars) for(const k of ch.exp.keys()) allEff.add(k);
function absWinner(p){ let best=null; for(const eff of allEff){ let m=0,t=0,mAll=0,tAll=0; for(const ch of absChars){ const phys=ch.lb?ch.offset+p:ch.offset+p+4; if(phys+4>ch.buf.length) continue; const e=ch.exp.get(eff)||0; const val=ch.buf.readInt32LE(phys); tAll++; if(val===e)mAll++; if(e!==0){t++; if(val===e)m++;} } if(t<5) continue; if(!best||m>best.m) best={eff,m,t,mAll,tAll}; } return best; }

// CLEAN DELTA (single-effect)
const pairs=[["save_t0.sav","save_t1.sav"],["save_t1.sav","save_t2.sav"],["save_t2.sav","save_t3.sav"],["save_t3.sav","save_t4.sav"],["save_t4.sav","save_t5.sav"],["save_t5.sav","save_t6.sav"],["save_t6.sav","save_t7.sav"]];
const dmap=new Map(); // eff -> slot -> {match,total}
for(const [fa,fb] of pairs){ let bufA,bufB; try{bufA=fs.readFileSync(SAVES+fa);bufB=fs.readFileSync(SAVES+fb);}catch(e){continue;}
  const recA=findCharacterRecords(bufA,names,traitNames,null); const recB=findCharacterRecords(bufB,names,traitNames,null);
  const idxB=new Map(); for(const c of recB) if(c.primaryUuid&&c.primaryUuid!==0xffffffff) idxB.set(c.primaryUuid,c);
  for(const a of recA){ if(!a.primaryUuid||a.primaryUuid===0xffffffff) continue; const b=idxB.get(a.primaryUuid); if(!b) continue; if((a.lastName===null)!==(b.lastName===null)) continue;
    const eA=effOf(a),eB=effOf(b); const keys=new Set([...eA.keys(),...eB.keys()]); const ch=[]; for(const k of keys){const d=(eB.get(k)||0)-(eA.get(k)||0); if(d!==0) ch.push([k,d]);} if(ch.length!==1) continue;
    const [eff,d]=ch[0]; const lb=a.lastName===null;
    for(const p of SLOTS){ const pa=lb?a.offset+p:a.offset+p+4, pb=lb?b.offset+p:b.offset+p+4; if(pa+4>bufA.length||pb+4>bufB.length) continue; const od=bufB.readInt32LE(pb)-bufA.readInt32LE(pa);
      if(!dmap.has(eff))dmap.set(eff,new Map()); const m=dmap.get(eff); if(!m.has(p))m.set(p,{match:0,total:0}); const r=m.get(p); r.total++; if(od===d)r.match++; } } }
function deltaCorrob(p,eff){ const m=dmap.get(eff); if(!m||!m.has(p)) return null; const r=m.get(p); if(r.total<3) return null; return `${(r.match/r.total*100).toFixed(0)}%(${r.match}/${r.total})`; }

// known direct-attribute reads (from parseCharacter / cluster dump)
const DIRECT={94:"(const 50 — array header/scale)",98:"Command [direct attr]",102:"Influence [direct attr]",106:"Management [direct attr]",122:"Loyalty [direct attr]"};
console.log("offset  effect(absWinner)        absNZ%     absAll%   deltaCorrob   note");
for(const p of SLOTS){
  if(p===94){ console.log(`  +${String(p).padEnd(4)} ${"-".padEnd(22)} ${"".padEnd(9)} ${"".padEnd(8)} ${"".padEnd(12)} ${DIRECT[94]}`); continue; }
  const w=absWinner(p); if(!w){ console.log(`  +${String(p).padEnd(4)} ${"(always 0 / unused)".padEnd(22)}`); continue; }
  const dc=deltaCorrob(p,w.eff)||"";
  const note=DIRECT[p]||"";
  console.log(`  +${String(p).padEnd(4)} ${w.eff.padEnd(22)} ${(w.m/w.t*100).toFixed(0)+"%("+w.m+"/"+w.t+")"}`.padEnd(46)+` ${(w.mAll/w.tAll*100).toFixed(0)}%`.padEnd(9)+` ${dc.padEnd(13)} ${note}`);
}
