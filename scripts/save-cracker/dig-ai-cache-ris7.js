// dig-ai-cache-ris7.js — even more relaxed scan
const fs = require('fs');
const ROME_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const rome10 = fs.readFileSync(ROME_DIR + 'save_rome10.sav');

// Strict in only one thing: u32@off+8 (Y) in [0, 240) AND u32@off+8 != 0
// Find max runs.
function isYValid(c){ return c >= 1 && c < 240; }

console.log('Quick scan: longest runs of valid Y values (12-byte stride):');
const runs = [];
for(let off0=0; off0<12; off0++){
  let curStart = -1, curLen = 0;
  for(let off=0x1000+off0; off<rome10.length-12; off+=12){
    const c = rome10.readUInt32LE(off+8);
    if(isYValid(c)){
      if(curStart === -1) curStart = off;
      curLen++;
    } else {
      if(curLen >= 50) runs.push({off0, start: curStart, len: curLen});
      curStart = -1;
      curLen = 0;
    }
  }
  if(curLen >= 50) runs.push({off0, start: curStart, len: curLen});
}
runs.sort((a,b)=>b.len-a.len);
console.log('Top 20 runs:');
for(const r of runs.slice(0, 20)){
  console.log('  align='+r.off0+' start=0x'+r.start.toString(16).padStart(7,'0')+' len='+r.len);
}

// Strongest: take top runs and dump details
for(const r of runs.slice(0, 5)){
  console.log('\n=== Run at 0x'+r.start.toString(16)+' (len='+r.len+', align='+r.off0+') ===');
  for(let i=0;i<Math.min(20, r.len); i++){
    const off = r.start + i*12;
    const a = rome10.readUInt32LE(off);
    const b = rome10.readUInt32LE(off+4);
    const c = rome10.readUInt32LE(off+8);
    console.log('  ['+i+']@0x'+off.toString(16)+' hash=0x'+a.toString(16).padStart(8,'0')+' key=0x'+b.toString(16).padStart(8,'0')+' y='+c);
  }
}
