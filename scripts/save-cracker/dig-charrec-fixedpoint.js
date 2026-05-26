// dig-charrec-fixedpoint.js
// BREAKTHROUGH: the attribute array is 16.16 fixed-point. AntigonosB +96=458752
// =7.0 (cmd), +100=393216=6.0 (inf), +104=327680=5.0 (mgmt). Read the array as
// s32 16.16 fixed-point starting at +96, step 4. Print integer .frac form.
// Compare slot integer values to expected trait+ancillary effect totals.
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
const want = process.argv.slice(3);
const picks = want.length ? v1.filter(c=>want.includes(c.firstName)) : v1.filter(c=>(c.traits||[]).length>=10).slice(0,4);
const fp=(v)=>v/65536;
for(const c of picks){
  const adj = c.lastName===null?0:4;
  const exp = effOf(c);
  console.log(`\n${"=".repeat(72)}`);
  console.log(`${c.firstName}${c.lastName?" "+c.lastName:""}  L=${c.lastName===null?"B":"A"} cmd=${c.command} inf=${c.influence} mgmt=${c.management} loy=${c.loyalty}`);
  console.log(`  traits(${(c.traits||[]).length}): ${(c.traits||[]).map(t=>t.name+":"+t.points).join(", ")}`);
  console.log(`  anc(${(c.ancillaries||[]).length}): ${(c.ancillaries||[]).map(a=>ancNames[a.id]||"#"+a.id).join(", ")}`);
  console.log(`  expected effects: ${[...exp].filter(([k,v])=>v!==0).map(([k,v])=>k+"="+v).join(" ")}`);
  console.log(`  --- 16.16 fixed-point array (idx: offset = fpvalue) ---`);
  let line=[];
  let idx=0;
  for(let p=96;p<=296;p+=4){
    const o=c.offset+p+adj; if(o+4>buf.length) break;
    const raw=buf.readInt32LE(o); const v=fp(raw);
    line.push(`[${idx}]+${p}=${v}`);
    if(line.length===6){console.log("    "+line.join("  "));line=[];}
    idx++;
  }
  if(line.length) console.log("    "+line.join("  "));
}
