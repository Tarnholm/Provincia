// dig-ai-cache-semantics2.js — investigate the "turn" field. Session 18 thought
// this was the game turn but T13E has turn-65 records, which is contradictory.

const fs = require('fs');
const ALEX_DIR = 'C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z/';

const FILES = {
  t1e: '0014_save_Autosave   Macedon   Turn 1 End.sav',
  t2s: '0021_save_Autosave   Macedon   Turn 2 Start.sav',
  t2e: '0028_save_Autosave   Macedon   Turn 2 End.sav',
  t3s: '0035_save_Autosave   Macedon   Turn 3 Start.sav',
  t3e: '0042_save_Autosave   Macedon   Turn 3 End.sav',
  t13s: '0351_save_Autosave   Macedon   Turn 13 Start.sav',
  t13e: '0357_save_Autosave   Macedon   Turn 13 End.sav',
  t14e: '0369_save_Autosave   Macedon   Turn 14 End.sav',
  t15e: '0381_save_Autosave   Macedon   Turn 15 End.sav',
};

function walk(buf, start=0x1024){
  const recs = [];
  for(let off=start; off<buf.length-12; off+=12){
    const a = buf.readUInt32LE(off);
    const b = buf.readUInt32LE(off+4);
    const c = buf.readUInt32LE(off+8);
    if(a===0 && b===0 && c===0) return recs;
    if(c >= 300) return recs;
    recs.push({a,b,c,off});
  }
  return recs;
}

console.log('Save | recs | turn-min | turn-max | distinct-turns | first10-turns');
for(const [k, f] of Object.entries(FILES)){
  const buf = fs.readFileSync(ALEX_DIR + f);
  const recs = walk(buf);
  if(recs.length === 0){
    console.log(k.padEnd(5)+'| (empty)');
    continue;
  }
  const turns = recs.map(r=>r.c);
  const tMin = Math.min(...turns);
  const tMax = Math.max(...turns);
  const distinctT = new Set(turns).size;
  console.log(k.padEnd(5)+'| '+recs.length.toString().padStart(4)+' | '+tMin.toString().padStart(8)+' | '+tMax.toString().padStart(8)+' | '+distinctT.toString().padStart(14)+' | '+recs.slice(0,10).map(r=>r.c).join(','));
}

// For T1E, dump first 30 records — they should reveal the structure on turn 1
const t1eBuf = fs.readFileSync(ALEX_DIR + FILES.t1e);
const t1eRecs = walk(t1eBuf);
console.log('\nT1E first 30 records:');
for(let i=0;i<Math.min(30, t1eRecs.length); i++){
  const r = t1eRecs[i];
  console.log('  ['+i+']@0x'+r.off.toString(16)+' hash=0x'+r.a.toString(16).padStart(8,'0')+' key=0x'+r.b.toString(16).padStart(8,'0')+' turn='+r.c);
}

// And T13E - the highest turn recs
const t13eBuf = fs.readFileSync(ALEX_DIR + FILES.t13e);
const t13eRecs = walk(t13eBuf);
console.log('\nT13E last 10 records (highest turn values):');
for(let i=Math.max(0, t13eRecs.length-10); i<t13eRecs.length; i++){
  const r = t13eRecs[i];
  console.log('  ['+i+']@0x'+r.off.toString(16)+' hash=0x'+r.a.toString(16).padStart(8,'0')+' key=0x'+r.b.toString(16).padStart(8,'0')+' turn='+r.c);
}

// Turn-histogram for T13E
console.log('\nT13E turn-value histogram:');
const histT = {};
for(const r of t13eRecs) histT[r.c] = (histT[r.c]||0)+1;
const keysT = Object.keys(histT).map(Number).sort((a,b)=>a-b);
for(const k of keysT){
  console.log('  turn='+k.toString().padStart(3)+' → '+histT[k]+' records');
}
