// Robust per-save validation: locate matrix, then SELF-ALIGN via the
// faction_agression crib (known to match 100% at true alignment), then report
// state(+12)/bond(+20)/agg(+24) decode accuracy. Works across saves regardless
// of internal breaks that confuse contiguous-run anchoring.
"use strict";
const fs = require("fs");
const STRAT = "C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt";
const SMF   = "C:/RIS/RIS/data/descr_sm_factions.txt";
const STRIDE = 267, N = 239;

function parseSection(text, kw){ const re=new RegExp("^\\s*"+kw+"\\s+([a-z0-9_]+),?\\s+(-?\\d+)\\s+([a-z0-9_]+)","i"); const g={};
  for(const raw of text.split(/\r?\n/)){const m=raw.match(re); if(!m)continue;(g[m[1].toLowerCase()]||={})[m[3].toLowerCase()]=parseInt(m[2],10);} return g; }
const t=fs.readFileSync(STRAT,"utf8");
const core=parseSection(t,"core_attitudes"), rel=parseSection(t,"faction_relationships"), agg=parseSection(t,"faction_agression");
const names=[]; for(const line of fs.readFileSync(SMF,"utf8").split(/\r?\n/)){const m=line.match(/^\t"([a-z_0-9]+)":/); if(m)names.push(m[1].toLowerCase());}

function roughAnchor(buf){
  const lc=(o)=>o>=0&&o+20<=buf.length&&buf.readUInt32LE(o+8)===200&&buf.readUInt32LE(o+16)===2&&buf.readUInt32LE(o)===0;
  // first signature hit, walk back over contiguous invariant cells
  for(let p=0x4000;p<Math.min(buf.length-STRIDE*4,0x800000);p++){ if(!lc(p))continue;
    let s=p; while(lc(s-STRIDE))s-=STRIDE; return s; }
  return null;
}
// state-match for a given byte base — the STABLE alignment crib (+12 vs
// faction_relationships: 199->0 ally, 200->200 neutral, 201->600 war).
// transpose=true: cell(r,c) holds the value for from=names[c] toward names[r].
const REL_MAP = { 199: 0, 200: 200, 201: 600 };
function stateMatch(buf, base){ let m=0,tot=0;
  for(let r=0;r<N;r++)for(let c=0;c<N;c++){ if(r===c)continue; const rv=rel[names[c]]&&rel[names[c]][names[r]]; if(rv==null)continue;
    const o=base+(r*N+c)*STRIDE+12; if(o<0||o+4>buf.length)continue; tot++; if(buf.readInt32LE(o)===REL_MAP[rv])m++; }
  return tot?m/tot:0; }

function analyze(path){
  const buf=fs.readFileSync(path);
  const rough=roughAnchor(buf);
  if(rough==null){ console.log(`${path}: NO MATRIX`); return; }
  // self-align: sweep cell offset to maximize STATE-match (turn-stable crib)
  let best={frac:-1,base:rough};
  for(let k=-80;k<=80;k++){ const base=rough+k*STRIDE; const f=stateMatch(buf,base); if(f>best.frac)best={frac:f,base,k}; }
  const base=best.base;
  const val=(r,c,fo)=>{const o=base+(r*N+c)*STRIDE+fo; return (o>=0&&o+4<=buf.length)?buf.readInt32LE(o):null;};
  // decode accuracy for state(+12 vs rel: 199->0,200->200,201->600) and agg(+24)
  const relMap={199:0,200:200,201:600};
  let sM=0,sT=0,gM=0,gT=0;
  for(let r=0;r<N;r++)for(let c=0;c<N;c++){ if(r===c)continue;
    const rv=rel[names[c]]&&rel[names[c]][names[r]];
    if(rv!=null){ sT++; if(val(r,c,12)===relMap[rv])sM++; }
    const av=agg[names[c]]&&agg[names[c]][names[r]];
    if(av!=null){ gT++; if(val(r,c,24)===av)gM++; }
  }
  // count current live states from matrix +12
  let wars=0,allies=0;
  for(let r=0;r<N;r++)for(let c=0;c<N;c++){ if(r>=c)continue; const v=val(r,c,12); if(v===600)wars++; else if(v===0)allies++; }
  console.log(`${path.split(/[\\/]/).pop()}`);
  console.log(`  matrix base=0x${base.toString(16)} (rough 0x${rough.toString(16)}, k=${best.k}) stateSelfAlign=${(best.frac*100).toFixed(1)}%`);
  console.log(`  +12 vs faction_relationships state: ${(sM/sT*100).toFixed(1)}% (${sM}/${sT})`);
  console.log(`  +24 vs faction_agression:          ${(gM/gT*100).toFixed(1)}% (${gM}/${gT})`);
  console.log(`  LIVE matrix states: ${wars} war-pairs, ${allies} alliance-pairs (att=600 / att=0)`);
}

for(const p of process.argv.slice(2)) analyze(p);
