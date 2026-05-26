// dig-charrec-effect-enum.js
// Definitive index->effect mapping for the 16.16 fixed-point attribute/effect
// array (starts at +96 LAYOUT_B, +100 LAYOUT_A; 51 slots, step 4).
// Two independent methods, reported side by side per slot:
//   (A) ABSOLUTE: across Macedon+Seleucid t0, for each slot find the effect
//       whose expected trait+anc total best equals round(slot/65536). Only
//       count chars where expected!=0 (avoids all-zero baseline inflation),
//       AND separately report the all-match% as a sanity check.
//   (B) DELTA: across t0..t7 consecutive pairs, single-effect-change chars;
//       which slot moved by the expected delta.
// Index 0=Command,1=Influence,2=Management,6=Loyalty are the DIRECT attributes
// (final value, not trait sum) -- flagged separately.
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
const NSLOT=51;
const fpRound=(raw)=>Math.round(raw/65536);
function slotVal(buf,c,idx){ const adj=c.lastName===null?0:4; const o=c.offset+96+adj+idx*4; if(o+4>buf.length) return null; return fpRound(buf.readInt32LE(o)); }

// (A) ABSOLUTE
const absChars=[];
for(const f of ["save_macedon t0.sav","save_Seleucids t0.sav"]){ const buf=fs.readFileSync(SAVES+f); for(const c of findCharacterRecords(buf,names,traitNames,null)) absChars.push({buf,c,exp:effOf(c)}); }
const allEff=new Set(); for(const ch of absChars) for(const k of ch.exp.keys()) allEff.add(k);
function absBest(idx){ let best=null;
  for(const eff of allEff){ let m=0,t=0,mAll=0,tAll=0;
    for(const ch of absChars){ const v=slotVal(ch.buf,ch.c,idx); if(v===null) continue; const e=ch.exp.get(eff)||0; tAll++; if(v===e)mAll++; if(e!==0){t++; if(v===e)m++;} }
    if(t<5) continue; if(!best||m>best.m||(m===best.m&&m/t>best.m/best.t)) best={eff,m,t,mAll,tAll};
  } return best; }

// (B) DELTA
const pairs=[["save_t0.sav","save_t1.sav"],["save_t1.sav","save_t2.sav"],["save_t2.sav","save_t3.sav"],["save_t3.sav","save_t4.sav"],["save_t4.sav","save_t5.sav"],["save_t5.sav","save_t6.sav"],["save_t6.sav","save_t7.sav"]];
const dmap=new Map(); // idx -> Map(eff -> {match,total})
for(const [fa,fb] of pairs){ let bufA,bufB; try{bufA=fs.readFileSync(SAVES+fa);bufB=fs.readFileSync(SAVES+fb);}catch(e){continue;}
  const recA=findCharacterRecords(bufA,names,traitNames,null), recB=findCharacterRecords(bufB,names,traitNames,null);
  const idxB=new Map(); for(const c of recB) if(c.primaryUuid&&c.primaryUuid!==0xffffffff) idxB.set(c.primaryUuid,c);
  for(const a of recA){ if(!a.primaryUuid||a.primaryUuid===0xffffffff) continue; const b=idxB.get(a.primaryUuid); if(!b) continue; if((a.lastName===null)!==(b.lastName===null)) continue;
    const eA=effOf(a),eB=effOf(b); const keys=new Set([...eA.keys(),...eB.keys()]); const ch=[]; for(const k of keys){const d=(eB.get(k)||0)-(eA.get(k)||0); if(d!==0) ch.push([k,d]);} if(ch.length!==1) continue;
    const [eff,d]=ch[0];
    for(let idx=0;idx<NSLOT;idx++){ const va=slotVal(bufA,a,idx), vb=slotVal(bufB,b,idx); if(va===null||vb===null) continue; const od=vb-va;
      if(!dmap.has(idx))dmap.set(idx,new Map()); const m=dmap.get(idx); if(!m.has(eff))m.set(eff,{match:0,total:0}); const r=m.get(eff); r.total++; if(od===d)r.match++; } }
}
function deltaBest(idx){ const m=dmap.get(idx); if(!m) return null; let best=null; for(const [eff,r] of m){ if(r.total<3) continue; if(!best||r.match/r.total>best.rate) best={eff,rate:r.match/r.total,...r}; } return best; }

const DIRECT={0:"Command(final)",1:"Influence(final)",2:"Management(final)",6:"Loyalty(final)"};
console.log("idx  off  ABSOLUTE(eff NZmatch / allMatch)            DELTA(eff rate)            direct");
for(let idx=0;idx<NSLOT;idx++){
  const off=96+idx*4;
  const a=absBest(idx); const d=deltaBest(idx);
  const aStr=a?`${a.eff} ${a.m}/${a.t}(${(a.m/a.t*100).toFixed(0)}%) all=${(a.mAll/a.tAll*100).toFixed(0)}%`:"(none)";
  const dStr=d?`${d.eff} ${d.match}/${d.total}(${(d.rate*100).toFixed(0)}%)`:"";
  const dir=DIRECT[idx]||"";
  console.log(`[${String(idx).padStart(2)}] +${String(off).padEnd(3)} ${aStr.padEnd(42)} ${dStr.padEnd(26)} ${dir}`);
}
