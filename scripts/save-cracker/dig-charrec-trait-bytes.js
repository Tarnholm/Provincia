// dig-charrec-trait-bytes.js
// Decode the 8-byte trait record fields: +0 u32 id, +4 u16 points, +6 u16 ???.
// Test whether +6 is "points to next level" (threshold[nextLevel]-points) by
// comparing against the traits-file thresholds. Also derive displayed level
// from points via threshold lookup and report match stats.
const fs = require("fs");
const path = require("path");
const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";
const modPath = "C:/RIS/RIS";
const names = fs.readFileSync(path.join(modPath, "data/descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitsTxt = fs.readFileSync(path.join(modPath, "data/export_descr_character_traits.txt"), "utf8");
const traitNames=[]; const traitLevels=new Map(); // name -> [{levelName, threshold}]
{ let ct=null,cl=null,curLevels=null;
  for(let raw of traitsTxt.split(/\r?\n/)){const l=raw.trim();let m;
    if((m=l.match(/^Trait\s+([A-Za-z0-9_]+)/))){ct=m[1];traitNames.push(ct);curLevels=[];traitLevels.set(ct,curLevels);cl=null;}
    else if(ct&&(m=l.match(/^Level\s+([A-Za-z0-9_]+)/))){cl={levelName:m[1],threshold:null};curLevels.push(cl);}
    else if(cl&&(m=l.match(/^Threshold\s+(\d+)/)))cl.threshold=parseInt(m[1],10);
  }
}
const { findCharacterRecords } = require("../../src/characterParser.js");
const buf = fs.readFileSync(SAVE);
const v1=findCharacterRecords(buf,names,traitNames,null);
console.log(`SAVE=${path.basename(SAVE)} v1=${v1.length}`);

// Re-read raw 8-byte trait records to get the +6 field (parser drops it)
function rawTraits(c){
  const lb=c.lastName===null; const tcOff = c.offset + (lb?298:302); const tsOff = c.offset + (lb?304:308);
  const tc = buf.readUInt16LE(tcOff); const out=[];
  for(let i=0;i<tc-1;i++){ const o=tsOff+i*8; if(o+8>buf.length) break; const id=buf.readUInt32LE(o); const pts=buf.readUInt16LE(o+4); const f6=buf.readUInt16LE(o+6); if(id>=traitNames.length) break; out.push({name:traitNames[id],id,pts,f6}); }
  return out;
}
// hypothesis test for +6:
//  H1: f6 == threshold(nextLevel) - pts (points needed to advance)
//  H2: f6 == 0 always (terminator-style)
//  H3: f6 == displayed level
let h1=0,h2=0,h3=0,tot=0; const f6vals=new Map();
const examples=[];
for(const c of v1.slice(0,400)){
  for(const t of rawTraits(c)){
    tot++; f6vals.set(t.f6,(f6vals.get(t.f6)||0)+1);
    const levels=traitLevels.get(t.name)||[];
    // current level idx by threshold
    let idx=0; for(let i=0;i<levels.length;i++){const th=levels[i].threshold==null?(i===0?0:1):levels[i].threshold; if(t.pts>=th) idx=i; else break;}
    const nextTh = idx+1<levels.length ? (levels[idx+1].threshold||0) : null;
    const need = nextTh!=null ? nextTh - t.pts : null;
    if(need!=null && t.f6===need) h1++;
    if(t.f6===0) h2++;
    if(t.f6===(idx+1)) h3++;
    if(examples.length<25 && t.f6!==0) examples.push(`${t.name} pts=${t.pts} f6=${t.f6} curLvl=${idx+1} nextTh=${nextTh} need=${need}`);
  }
}
console.log(`\ntrait records sampled: ${tot}`);
console.log(`H1 (f6 == threshold(next)-points): ${h1} (${(h1/tot*100).toFixed(1)}%)`);
console.log(`H2 (f6 == 0): ${h2} (${(h2/tot*100).toFixed(1)}%)`);
console.log(`H3 (f6 == displayed level): ${h3} (${(h3/tot*100).toFixed(1)}%)`);
console.log("\nf6 value distribution (top):");
[...f6vals.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12).forEach(([v,n])=>console.log(`  f6=${v}: ${n}`));
console.log("\nExamples (nonzero f6):");
examples.forEach(e=>console.log("  "+e));
