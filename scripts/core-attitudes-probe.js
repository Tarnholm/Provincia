// Probe: does core_attitudes {-10,200,600} live inside the diplomacy cell?
// Align the matrix with the proven faction_relationships STATE crib (turn-stable),
// then sweep every byte offset 0..STRIDE within the cell and score it against the
// core_attitudes crib (raw value match, transpose orientation). Report top offsets.
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

const REL_MAP = { 199: 0, 200: 200, 201: 600 };
function roughAnchor(buf){
  const lc=(o)=>o>=0&&o+20<=buf.length&&buf.readUInt32LE(o+8)===200&&buf.readUInt32LE(o+16)===2&&buf.readUInt32LE(o)===0;
  for(let p=0x4000;p<Math.min(buf.length-STRIDE*4,0x800000);p++){ if(!lc(p))continue;
    let s=p; while(lc(s-STRIDE))s-=STRIDE; return s; }
  return null;
}
function stateMatch(buf, base){ let m=0,tot=0;
  for(let r=0;r<N;r++)for(let c=0;c<N;c++){ if(r===c)continue; const rv=rel[names[c]]&&rel[names[c]][names[r]]; if(rv==null)continue;
    const o=base+(r*N+c)*STRIDE+12; if(o<0||o+4>buf.length)continue; tot++; if(buf.readInt32LE(o)===REL_MAP[rv])m++; }
  return tot?m/tot:0; }

function analyze(path){
  const buf=fs.readFileSync(path);
  const rough=roughAnchor(buf);
  if(rough==null){ console.log(`${path}: NO MATRIX`); return; }
  let best={frac:-1,base:rough,k:0};
  for(let k=-80;k<=80;k++){ const base=rough+k*STRIDE; const f=stateMatch(buf,base); if(f>best.frac)best={frac:f,base,k}; }
  const base=best.base;
  console.log(`\n=== ${path.split(/[\\/]/).pop()}  base=0x${base.toString(16)} k=${best.k} stateAlign=${(best.frac*100).toFixed(1)}% ===`);

  // count how many directed core_attitudes entries are non-default (!=200), and how many are -10
  let coreEntries=0, coreNeg=0;
  for(const a in core) for(const b in core[a]){ coreEntries++; if(core[a][b]===-10) coreNeg++; }

  // sweep every byte offset; for each, score raw match against core crib (transpose)
  const results=[];
  for(let fo=0; fo<=STRIDE-4; fo++){
    let m=0,tot=0,negM=0,negTot=0;
    for(let r=0;r<N;r++)for(let c=0;c<N;c++){ if(r===c)continue;
      const cv=core[names[c]]&&core[names[c]][names[r]]; if(cv==null)continue;
      const o=base+(r*N+c)*STRIDE+fo; if(o<0||o+4>buf.length)continue;
      const v=buf.readInt32LE(o); tot++; if(v===cv)m++;
      if(cv===-10){negTot++; if(v===-10)negM++;}
    }
    if(tot) results.push({fo, frac:m/tot, m, tot, negFrac: negTot?negM/negTot:0, negM, negTot});
  }
  results.sort((a,b)=>b.frac-a.frac);
  console.log(`core crib: ${coreEntries} directed entries, ${coreNeg} are -10`);
  console.log("top 8 offsets by raw core-match:");
  for(const r of results.slice(0,8))
    console.log(`  +${r.fo}: ${(r.frac*100).toFixed(1)}% (${r.m}/${r.tot})  -10-match ${(r.negFrac*100).toFixed(1)}% (${r.negM}/${r.negTot})`);
}

const args=process.argv.slice(2);
if(!args.length){ console.log("usage: node core-attitudes-probe.js <save.sav> [...]"); process.exit(1); }
for(const a of args) analyze(a);
