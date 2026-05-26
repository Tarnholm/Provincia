// dig-tilegap-seacheck.js — verify sea detection on the TGAs; histogram colors
const fs = require('fs');
const {readTGA} = require('./dig-tilegap-tga.js');
const MAP = 'C:/RIS/RIS/data/world/maps/base/';

for(const f of ['map_regions.tga','map_ground_types.tga']){
  const t=readTGA(MAP+f);
  const hist={};
  let n=0;
  for(let y=0;y<t.h;y+=3) for(let x=0;x<t.w;x+=3){
    const c=t.get(x,y); const k=`${c.r},${c.g},${c.b}`; hist[k]=(hist[k]||0)+1; n++;
  }
  const top=Object.entries(hist).sort((a,b)=>b[1]-a[1]).slice(0,12);
  console.log(`\n=== ${f} (${t.w}x${t.h}) top colors (r,g,b : count, % of sampled) ===`);
  for(const [k,c] of top) console.log(`  ${k.padEnd(14)} : ${c}  (${(100*c/n).toFixed(1)}%)`);
}
