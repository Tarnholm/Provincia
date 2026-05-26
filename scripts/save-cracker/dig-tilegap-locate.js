const fs = require('fs');
const SAVES = [
  'save_t0.sav',
  'save_macedon t0.sav',
  'save_17-05-2026   Spain   Turn 1.sav',
];
const DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const MAGIC = Buffer.from([0x05,0,0,0, 0,0,0,0, 0,0,0,0, 0x0a,0,0,0, 0xc8,0,0,0]);
for (const s of SAVES){
  const buf = fs.readFileSync(DIR+s);
  // find ALL occurrences of magic
  let occ=[]; let p=buf.indexOf(MAGIC);
  while(p!==-1 && occ.length<10){ occ.push(p); p=buf.indexOf(MAGIC,p+1); }
  console.log(`\n=== ${s}  (${buf.length} bytes) ===`);
  console.log(`  magic occurrences (first 10): ${occ.map(o=>'0x'+o.toString(16)).join(', ')}`);
  if(occ.length){
    const off=occ[0];
    // does 267-stride next record match magic again?
    const STRIDE=267;
    let consecutive=0;
    for(let i=0;i<5;i++){
      const b=off+i*STRIDE;
      if(buf.readUInt32LE(b)===5 && buf.readUInt32LE(b+12)===10 && buf.readUInt32LE(b+16)===200) consecutive++;
      else break;
    }
    console.log(`  consecutive 267-stride records matching template from first magic: ${consecutive}`);
  }
}
