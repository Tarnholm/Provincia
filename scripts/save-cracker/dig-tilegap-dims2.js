// dig-tilegap-dims2.js — find the declared grid width/height near the GROUND_TILE block header
const fs = require('fs');
const DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const MAGIC = Buffer.from([0x05,0,0,0, 0,0,0,0, 0,0,0,0, 0x0a,0,0,0, 0xc8,0,0,0]);

function go(s){
  const buf = fs.readFileSync(DIR+s);
  const first = buf.indexOf(MAGIC);
  // count records
  let N=0,p=first; const STRIDE = (s.includes('Spain')?115:267);
  while(p+20<=buf.length && buf.readUInt32LE(p)===5 && buf.readUInt32LE(p+12)===10 && buf.readUInt32LE(p+16)===200){N++;p+=STRIDE;}
  console.log(`\n=== ${s} : block @0x${first.toString(16)}, N=${N}, stride=${STRIDE} ===`);
  // scan backwards up to 4KB for two u32 whose product == N (the width,height header)
  console.log('  searching 8KB before block for u32 pair with product==N or close:');
  for(let o=first-8192; o<first-4; o++){
    const a=buf.readUInt32LE(o), b=buf.readUInt32LE(o+4);
    if(a>1 && b>1 && a<2000 && b<2000 && a*b===N){
      console.log(`    @0x${o.toString(16)} (off -${first-o}): ${a} x ${b} = ${a*b}  EXACT`);
    }
  }
  // also search whole file for the dims pair
  // Spain: 22x20 or 20x22 ; t0: 240x238 or 238x240
  // Print STRATEGY_MAP / WORLD_MAP_PARAMETERS area: find "GROUND_TILE" string? it's in registry only.
  // Search for literal width/height tokens used by descr_terrain near start
}
go('save_17-05-2026   Spain   Turn 1.sav');
go('save_t0.sav');
