// With alignment LOCKED (transpose=true, C=-1, +24=faction_agression@100%),
// crosstab +12 and +20 against the cribs to decode their exact value mappings.
"use strict";
const fs = require("fs");
const STRAT = "C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt";
const SMF   = "C:/RIS/RIS/data/descr_sm_factions.txt";
const SAVE  = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_julii1.sav";
const STRIDE = 267, N = 239, C = -1; // transpose=true: cell(r,c) holds crib[names[c]][names[r]]

function parseSection(text, kw){ const re=new RegExp("^\\s*"+kw+"\\s+([a-z0-9_]+),?\\s+(-?\\d+)\\s+([a-z0-9_]+)","i"); const g={};
  for(const raw of text.split(/\r?\n/)){const m=raw.match(re); if(!m)continue; (g[m[1].toLowerCase()]||={})[m[3].toLowerCase()]=parseInt(m[2],10);} return g; }
const t=fs.readFileSync(STRAT,"utf8");
const core=parseSection(t,"core_attitudes"), rel=parseSection(t,"faction_relationships"), agg=parseSection(t,"faction_agression");
const names=[]; for(const line of fs.readFileSync(SMF,"utf8").split(/\r?\n/)){const m=line.match(/^\t"([a-z_0-9]+)":/); if(m)names.push(m[1].toLowerCase());}
const buf=fs.readFileSync(SAVE);
function locate(){ const lc=(o)=>o>=0&&o+20<=buf.length&&buf.readUInt32LE(o+8)===200&&buf.readUInt32LE(o+16)===2&&buf.readUInt32LE(o)===0;
  let best=null; for(let p=0x4000;p<Math.min(buf.length-STRIDE*4,0x800000);p++){if(!lc(p))continue;let g=0;while(lc(p+g*STRIDE))g++;if(!best||g>best.run)best={cell0:p,run:g};p+=g*STRIDE;} return best; }
const {cell0}=locate();
const val=(r,c,fo)=>buf.readInt32LE(cell0+(r*N+c+C)*STRIDE+fo);
console.log(`save=${SAVE.split(/[\\/]/).pop()} matrix@0x${cell0.toString(16)}\n`);

// crosstab field value × crib value (crib indexed [col][row] due to transpose)
function crosstab(fo, crib, label){
  const tab={};
  for(let r=0;r<N;r++)for(let c=0;c<N;c++){ if(r===c)continue;
    const cv = crib[names[c]] && crib[names[c]][names[r]]; if(cv==null)continue;
    const fv = val(r,c,fo);
    ((tab[cv]||={})[fv]) = (((tab[cv]||{})[fv])||0)+1; }
  console.log(`── +${fo} field value  ×  ${label} crib value ──`);
  for(const cv of Object.keys(tab).sort((a,b)=>a-b)){
    const dist=Object.entries(tab[cv]).sort((a,b)=>b[1]-a[1]).map(([f,n])=>`${f}×${n}`).join("  ");
    console.log(`  crib=${String(cv).padStart(4)} -> save: ${dist}`);
  }
  console.log();
}
crosstab(12, core, "core_attitudes");
crosstab(12, rel,  "faction_relationships");
crosstab(20, rel,  "faction_relationships");
crosstab(20, core, "core_attitudes");
crosstab(24, agg,  "faction_agression");
