// dig-charrec-effect-delta.js
// DELTA-based effect->slot mapping. For each character present in BOTH saves
// (matched by primaryUuid), compute:
//   - the EXPECTED change in each named Effect (from trait point deltas, using
//     the traits file level thresholds), and
//   - the OBSERVED change in each byte slot (u32 LE s32, raw record offset).
// Then accumulate, per (effect, slot), how often observedDelta == expectedDelta
// over chars where expectedDelta != 0. The slot that tracks an effect's delta
// across many chars is that effect's storage slot. Delta avoids all
// absolute-level ambiguity (only the CHANGE must match).
const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
const modPath = "C:/RIS/RIS";
const names = fs.readFileSync(path.join(modPath, "data/descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitsTxt = fs.readFileSync(path.join(modPath, "data/export_descr_character_traits.txt"), "utf8");

const traitNames = [];
const traitDef = new Map();
{
  const lines = traitsTxt.split(/\r?\n/);
  let curTrait = null, curLevel = null;
  for (let raw of lines) {
    const line = raw.trim(); let m;
    if ((m = line.match(/^Trait\s+([A-Za-z0-9_]+)/))) { curTrait=m[1]; traitNames.push(curTrait); traitDef.set(curTrait,[]); curLevel=null; }
    else if (curTrait && (m = line.match(/^Level\s+([A-Za-z0-9_]+)/))) { curLevel={threshold:null,effects:[]}; traitDef.get(curTrait).push(curLevel); }
    else if (curLevel && (m = line.match(/^Threshold\s+(\d+)/))) curLevel.threshold=parseInt(m[1],10);
    else if (curLevel && (m = line.match(/^Effect\s+([A-Za-z0-9_]+)\s+(-?\d+)/))) curLevel.effects.push({name:m[1],val:parseInt(m[2],10)});
  }
}
function activeLevelIdx(def, points){ let idx=0; for(let i=0;i<def.length;i++){ const th=def[i].threshold==null?(i===0?0:1):def[i].threshold; if(points>=th) idx=i; else break;} return idx; }
function effMap(name, points){ const def=traitDef.get(name); const m=new Map(); if(!def||!def.length) return m; for(const e of def[activeLevelIdx(def,points)].effects) m.set(e.name,(m.get(e.name)||0)+e.val); return m; }

const { findCharacterRecords } = require("../../src/characterParser.js");
const pairs = [["save_t0.sav","save_t1.sav"],["save_t1.sav","save_t2.sav"],["save_t2.sav","save_t3.sav"],["save_t3.sav","save_t4.sav"],["save_t4.sav","save_t5.sav"]];

const SLOTS=[]; for(let p=94;p<=298;p+=4) SLOTS.push(p);
// accum[effect][slot] = {match, total}
const accum = new Map();
function bump(eff, slot, ok){ if(!accum.has(eff)) accum.set(eff,new Map()); const m=accum.get(eff); if(!m.has(slot)) m.set(slot,{match:0,total:0}); const r=m.get(slot); r.total++; if(ok) r.match++; }

let pairsUsed=0;
for (const [fa,fb] of pairs) {
  let bufA,bufB;
  try { bufA=fs.readFileSync(SAVES+fa); bufB=fs.readFileSync(SAVES+fb); } catch(e){ continue; }
  pairsUsed++;
  const recA=findCharacterRecords(bufA,names,traitNames,null);
  const recB=findCharacterRecords(bufB,names,traitNames,null);
  const idxB=new Map(); for(const c of recB) if(c.primaryUuid&&c.primaryUuid!==0xffffffff) idxB.set(c.primaryUuid,c);
  for (const a of recA) {
    if(!a.primaryUuid||a.primaryUuid===0xffffffff) continue;
    const b=idxB.get(a.primaryUuid); if(!b) continue;
    if((a.lastName===null)!==(b.lastName===null)) continue; // layout must match
    const lb=a.lastName===null;
    // expected effect deltas
    const eA=new Map(); for(const t of (a.traits||[])){ for(const [k,v] of effMap(t.name,t.points)) eA.set(k,(eA.get(k)||0)+v);}
    const eB=new Map(); for(const t of (b.traits||[])){ for(const [k,v] of effMap(t.name,t.points)) eB.set(k,(eB.get(k)||0)+v);}
    const effDelta=new Map();
    for(const [k,v] of eA) effDelta.set(k,(eB.get(k)||0)-v);
    for(const [k,v] of eB) if(!eA.has(k)) effDelta.set(k,v);
    // observed slot deltas
    const slotDelta=new Map();
    for(const p of SLOTS){ const physA=lb?a.offset+p:a.offset+p+4; const physB=lb?b.offset+p:b.offset+p+4;
      if(physA+4>bufA.length||physB+4>bufB.length) continue; slotDelta.set(p, bufB.readInt32LE(physB)-bufA.readInt32LE(physA)); }
    for(const [eff,d] of effDelta){ if(d===0) continue; for(const p of SLOTS){ const od=slotDelta.get(p); if(od===undefined) continue; bump(eff,p,od===d); } }
  }
}

console.log(`pairs used: ${pairsUsed}`);
console.log("\n=== effect -> best slot by DELTA match (>=8 nonzero-delta samples) ===");
const rows=[];
for(const [eff,m] of accum){ let best=null; for(const [slot,r] of m){ if(r.total<8) continue; const rate=r.match/r.total; if(!best||rate>best.rate||(rate===best.rate&&r.total>best.total)) best={slot,rate,...r}; } if(best) rows.push({eff,...best}); }
rows.sort((a,b)=>b.rate-a.rate||b.total-a.total);
for(const r of rows){ const flag=r.rate>=0.95?"***":r.rate>=0.85?" **":r.rate>=0.7?"  *":""; console.log(`  slot +${String(r.slot).padEnd(4)} <- ${r.eff.padEnd(22)} ${(r.rate*100).toFixed(0)}% (${r.match}/${r.total}) ${flag}`); }
