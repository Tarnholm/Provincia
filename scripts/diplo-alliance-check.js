// Validate: matrix bond(+20) ∈ {54,55} <=> descr_strat faction_relationships 199 (alliance)?
// Alliances rarely change turn-to-turn, so this is robust even if the strat
// was edited slightly after the save.
"use strict";
const fs = require("fs");
const STRAT = "C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt";
const SMF   = "C:/RIS/RIS/data/descr_sm_factions.txt";
const SAVE  = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Julii turn1.sav";
const STRIDE = 267, N = 239;

function parseSection(text, kw) {
  const re = new RegExp("^\\s*" + kw + "\\s+([a-z0-9_]+),?\\s+(-?\\d+)\\s+([a-z0-9_]+)", "i");
  const g = {};
  for (const raw of text.split(/\r?\n/)) { const m = raw.match(re); if (!m) continue; (g[m[1].toLowerCase()] ||= {})[m[3].toLowerCase()] = parseInt(m[2],10); }
  return g;
}
const rel = parseSection(fs.readFileSync(STRAT,"utf8"), "faction_relationships");
const names = [];
for (const line of fs.readFileSync(SMF,"utf8").split(/\r?\n/)) { const m = line.match(/^\t"([a-z_0-9]+)":/); if (m) names.push(m[1].toLowerCase()); }
const buf = fs.readFileSync(SAVE);

// locate (longest stride-267 run)
function locate() {
  const looksCell = (o) => o>=0 && o+20<=buf.length && buf.readUInt32LE(o+8)===200 && buf.readUInt32LE(o+16)===2 && buf.readUInt32LE(o)===0;
  let best=null;
  for (let p=0x4000; p<Math.min(buf.length-STRIDE*4,0x800000); p++){ if(!looksCell(p))continue; let g=0; while(looksCell(p+g*STRIDE))g++; if(!best||g>best.run)best={cell0:p,run:g}; p+=g*STRIDE; }
  return best;
}
const {cell0,run} = locate();
const bond = (r,c) => buf.readInt32LE(cell0 + (r*N+c)*STRIDE + 20);
console.log(`save=${SAVE.split(/[\\/]/).pop()} matrix@0x${cell0.toString(16)} run=${run}\n`);

// crosstab: for each declared rel value, count bond states (test both orientations)
for (const [label, orient] of [["cell(r,c)=rel[r][c]", false], ["cell(r,c)=rel[c][r] (transpose)", true]]) {
  const tab = {}; // relVal -> {bondVal: count}
  for (let r=0;r<N;r++) for (let c=0;c<N;c++){ if(r===c)continue;
    const from = orient? names[c]:names[r], to = orient? names[r]:names[c];
    const rv = rel[from] && rel[from][to]; if (rv==null) continue;
    const b = bond(r,c);
    (tab[rv] ||= {})[b] = ((tab[rv]||{})[b]||0)+1;
  }
  console.log(`── ${label} ──`);
  for (const rv of Object.keys(tab).sort()) {
    const dist = Object.entries(tab[rv]).sort((a,b)=>b[1]-a[1]).map(([b,c])=>`bond${b}×${c}`).join("  ");
    const tag = rv==='199'?'(ally)':rv==='200'?'(neutral)':rv==='201'?'(war)':'';
    console.log(`  rel=${rv} ${tag.padEnd(10)} -> ${dist}`);
  }
  console.log();
}
