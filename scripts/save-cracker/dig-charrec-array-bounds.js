// dig-charrec-array-bounds.js
// Determine the exact bounds and length of the effect-accumulator array.
// Check the region +86..+126 to see where the array header/start really is,
// and +290..+302 to confirm where it ends relative to traitCount(+298 LB).
// Also: count how many of the ~50 slots are EVER nonzero across all chars
// (gives the "used slot" count vs the engine's fixed array size).
const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
const modPath = "C:/RIS/RIS";
const names = fs.readFileSync(path.join(modPath, "data/descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames=[]; for(const m of fs.readFileSync(path.join(modPath,"data/export_descr_character_traits.txt"),"utf8").matchAll(/^Trait\s+([A-Za-z0-9_]+)/gm)) traitNames.push(m[1]);
const { findCharacterRecords } = require("../../src/characterParser.js");

const files=["save_macedon t0.sav","save_Seleucids t0.sav"];
// nonzero-ever per raw LAYOUT_B slot from +86 to +302
const lo=86, hi=302;
const everNZ=new Map(); const distinct=new Map();
let n=0;
for(const f of files){ const buf=fs.readFileSync(SAVES+f); const v1=findCharacterRecords(buf,names,traitNames,null);
  for(const c of v1){ n++; const adj=c.lastName===null?0:4;
    for(let p=lo;p<=hi;p+=4){ const o=c.offset+p+adj; if(o+4>buf.length) continue; const v=buf.readInt32LE(o);
      if(v!==0) everNZ.set(p,(everNZ.get(p)||0)+1);
      if(!distinct.has(p)) distinct.set(p,new Set()); distinct.get(p).add(v);
    }
  }
}
console.log(`chars=${n}`);
console.log("\nslot(rawLB)  nzCount  distinctVals  sample-range");
for(let p=lo;p<=hi;p+=4){ const nz=everNZ.get(p)||0; const ds=distinct.get(p)||new Set(); const vals=[...ds].sort((a,b)=>a-b); const range=vals.length?`[${vals[0]}..${vals[vals.length-1]}]`:""; const mark = (p>=98&&p<=294)?"":"  <-- outside array?"; console.log(`  +${String(p).padEnd(4)} ${String(nz).padStart(5)}    ${String(ds.size).padStart(4)}        ${range}${mark}`);}
