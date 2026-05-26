// dig-tilegap-blockcount.js — how many magic-blocks exist? how do they relate to settlements?
const fs = require('fs');
const DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const MAGIC = Buffer.from([0x05,0,0,0, 0,0,0,0, 0,0,0,0, 0x0a,0,0,0, 0xc8,0,0,0]);

function scan(s){
  const buf = fs.readFileSync(DIR+s);
  console.log(`\n=== ${s} (${buf.length} bytes) ===`);
  // count all magic occurrences
  let occ=[]; let p=buf.indexOf(MAGIC);
  while(p!==-1){ occ.push(p); p=buf.indexOf(MAGIC,p+1); }
  console.log(`  total magic (template) occurrences: ${occ.length}`);

  // walk: from each occurrence, if previous occ is exactly stride away, it's contiguous
  // group into runs of contiguous same-stride records
  // We expect ONE giant run (the big block) + the inner records that re-trigger magic at 115/267
  // The big block: find the largest contiguous run
  // Determine stride between consecutive occurrences
  const gaps = {};
  for(let i=1;i<occ.length;i++){ const g=occ[i]-occ[i-1]; gaps[g]=(gaps[g]||0)+1; }
  const top = Object.entries(gaps).sort((a,b)=>b[1]-a[1]).slice(0,8);
  console.log('  most common gaps between consecutive magic occurrences:');
  for(const [g,c] of top) console.log(`    gap ${g} bytes: ${c} times`);

  // count marker strings
  const markers = ['default_set','hinterland_region','core_building','defenses','farms','port_buildings'];
  for(const m of markers){
    const mb=Buffer.from(m,'ascii');
    let c=0,q=buf.indexOf(mb);
    while(q!==-1){ c++; q=buf.indexOf(mb,q+1); }
    console.log(`  string "${m}": ${c} occurrences`);
  }
}
scan('save_t0.sav');
scan('save_17-05-2026   Spain   Turn 1.sav');
