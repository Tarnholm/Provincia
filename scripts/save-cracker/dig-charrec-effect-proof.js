// dig-charrec-effect-proof.js
// PROVE (or disprove) that the +94..+298 array is the accumulated trait+ancillary
// stat-effect vector. For each high-trait char, compare the MULTISET of nonzero
// slot values against the MULTISET of nonzero expected effect totals. If the
// array is the effect accumulator, the two multisets should match exactly
// (every nonzero effect total appears as some nonzero slot value, same count).
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
const file = process.argv[2] || "save_macedon t0.sav";
const buf = fs.readFileSync(SAVES+file);
const v1 = findCharacterRecords(buf,names,traitNames,null);

// Aggregate: across ALL chars, how well does the nonzero-slot-VALUE multiset
// match the nonzero-effect-total multiset?
let exactSet=0, total=0, valueMultisetMatch=0;
const sizeDelta=[];
for(const c of v1){
  const exp=effOf(c);
  // expected nonzero effect totals (exclude command/inf/mgmt/loy direct attrs? keep all for now)
  const expVals=[]; for(const [k,v] of exp) if(v!==0) expVals.push(v);
  if(expVals.length<3) continue; // only meaningful for chars with several effects
  const adj=c.lastName===null?0:4;
  const slotVals=[];
  for(let p=98;p<=298;p+=4){ const o=c.offset+p+adj; if(o+4>buf.length) break; const v=buf.readInt32LE(o); if(v!==0) slotVals.push(v); }
  total++;
  // multiset compare of VALUES (ignore which slot)
  const ms=(arr)=>{const m=new Map();for(const x of arr)m.set(x,(m.get(x)||0)+1);return m;};
  const a=ms(expVals), b=ms(slotVals);
  let eq=a.size===b.size; if(eq){for(const [k,v] of a){ if(b.get(k)!==v){eq=false;break;} }}
  if(eq) valueMultisetMatch++;
  sizeDelta.push(slotVals.length-expVals.length);
}
console.log(`FILE=${file}  chars-with-3+-effects=${total}`);
console.log(`value-multiset EXACT match: ${valueMultisetMatch}/${total} (${(valueMultisetMatch/total*100).toFixed(1)}%)`);
const avg=sizeDelta.reduce((a,b)=>a+b,0)/sizeDelta.length;
const hist=new Map(); for(const d of sizeDelta) hist.set(d,(hist.get(d)||0)+1);
console.log(`nonzero-count delta (slots - effects) avg=${avg.toFixed(2)} hist=`+[...hist.entries()].sort((a,b)=>a[0]-b[0]).map(([k,v])=>`${k}:${v}`).join(" "));

// Show a few worst cases (size mismatch) to understand WHY
console.log("\n=== sample chars: nonzero slots vs nonzero effect totals ===");
let shown=0;
for(const c of v1){
  if(shown>=5) break;
  const exp=effOf(c); const expEntries=[...exp].filter(([k,v])=>v!==0);
  if(expEntries.length<5) continue;
  const adj=c.lastName===null?0:4;
  const slots=[];
  for(let p=98;p<=298;p+=4){ const o=c.offset+p+adj; if(o+4>buf.length) break; const v=buf.readInt32LE(o); if(v!==0) slots.push([p,v]); }
  console.log(`\n${(c.firstName+(c.lastName?" "+c.lastName:"")).padEnd(22)} traits=${(c.traits||[]).length} anc=${(c.ancillaries||[]).length}`);
  console.log(`  expected(${expEntries.length}): ${expEntries.map(([k,v])=>k+"="+v).join(" ")}`);
  console.log(`  slots(${slots.length}):    ${slots.map(([p,v])=>"+"+p+"="+v).join(" ")}`);
  shown++;
}
