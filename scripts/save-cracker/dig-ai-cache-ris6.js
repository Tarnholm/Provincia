// dig-ai-cache-ris6.js — RIS imperial AI cache search v6. Look broader in the file.
// rome10 vs romet1 differ heavily in 0x1f80000+ region — could be where AI/army state
// lives in RIS. Search there for AI cache signature.

const fs = require('fs');
const ROME_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const rome10 = fs.readFileSync(ROME_DIR + 'save_rome10.sav');

function walkAi(buf, start, maxY=240){
  const recs = [];
  for(let off=start; off<buf.length-12; off+=12){
    const a = buf.readUInt32LE(off);
    const b = buf.readUInt32LE(off+4);
    const c = buf.readUInt32LE(off+8);
    if(a===0 && b===0 && c===0) return recs;
    if(c >= maxY) return recs;
    if((b & 0xff000000) !== 0) return recs;
    const lb = b & 0xff;
    if(lb !== 0 && lb !== 1 && lb !== 2 && lb !== 4 && lb !== 0x80) return recs;
    recs.push({a,b,c, x: (b>>>16)&0xff, y: c});
  }
  return recs;
}

// Look for the cache signature anywhere in rome10.
// In Alex: 466 records, 46 distinct hashes, hash=0 fraction ~12%.
console.log('Full-file scan of rome10 for AI cache (4-byte aligned, slow)...');
const cands = [];
const t0 = Date.now();
let lastReport = t0;
for(let s=0x1000; s<rome10.length - 12*100; s+=4){
  const now = Date.now();
  if(now - lastReport > 5000){
    console.log('  ... scanning at 0x'+s.toString(16)+' ('+((s/rome10.length)*100).toFixed(1)+'%), '+cands.length+' candidates so far');
    lastReport = now;
  }
  const recs = walkAi(rome10, s, 240);
  if(recs.length < 100) continue;
  const hashes = new Set(recs.map(r=>r.a));
  if(hashes.size < 10) continue;
  const zh = recs.filter(r=>r.a===0).length;
  if(zh < 5 || zh > recs.length*0.3) continue;
  cands.push({start: s, len: recs.length, h: hashes.size, zh});
}
console.log('Total candidates:', cands.length, 'time:', Date.now()-t0, 'ms');
cands.sort((a,b)=>b.len-a.len);
console.log('Top 30 results:');
for(const c of cands.slice(0,30)){
  console.log('  0x'+c.start.toString(16).padStart(7,'0')+': '+c.len+' rec, '+c.h+' hashes, '+c.zh+' zero-hash');
}
