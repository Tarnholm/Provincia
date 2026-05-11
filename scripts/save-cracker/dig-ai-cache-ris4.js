// dig-ai-cache-ris4.js — Search RIS for the AI cache by signature, not start offset.
// Signature requirements (from Alexander analysis):
//  - 100+ consecutive 12-byte records where:
//    * key high byte = 0 (b3==0)
//    * key low byte ∈ {0x00, 0x01, 0x02, 0x04, 0x80}
//    * key byte1 ∈ {0x00, 0x02, 0x03, 0x20, 0x22} (in Alex; might differ for RIS)
//    * turn-field (= Y) < 240 (RIS map height)
//    * NOT-all-zero records
//    * Hash distribution: multiple distinct hashes (not all 1s)
//
// Plus: small fraction of records have hash==0 (zero-hash records exist)

const fs = require('fs');
const ROME_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const rome10 = fs.readFileSync(ROME_DIR + 'save_rome10.sav');
const romet1 = fs.readFileSync(ROME_DIR + 'save_Autosave   Republic of Rome   Turn 1.sav');

function walkAi(buf, start, maxY=240){
  const recs = [];
  for(let off=start; off<buf.length-12; off+=12){
    const a = buf.readUInt32LE(off);
    const b = buf.readUInt32LE(off+4);
    const c = buf.readUInt32LE(off+8);
    if(a===0 && b===0 && c===0) return recs;
    if(c >= maxY) return recs;
    if((b & 0xff000000) !== 0) return recs;
    // key low byte
    const lb = b & 0xff;
    if(lb !== 0 && lb !== 1 && lb !== 2 && lb !== 4 && lb !== 0x80) return recs;
    recs.push({a,b,c, x: (b>>>16)&0xff, y: c, off});
  }
  return recs;
}

function scoreCacheLike(recs){
  if(recs.length < 50) return 0;
  const hashes = new Set();
  for(const r of recs) hashes.add(r.a);
  // Want many distinct hashes
  if(hashes.size < 5) return 0;
  // Want fraction of hash=0 records to be 1-15%
  const zh = recs.filter(r=>r.a===0).length;
  const zf = zh/recs.length;
  if(zf > 0.5) return 0;
  // Want Y values to span a range
  const ys = recs.map(r=>r.y);
  const yRange = Math.max(...ys) - Math.min(...ys);
  if(yRange < 5) return 0;
  return recs.length * (hashes.size / recs.length) * (1 - Math.abs(zf - 0.1));
}

console.log('=== Searching rome10 for AI cache with strict signature ===');
let bestCands = [];
for(let s=0x1000; s<0x50000; s+=4){
  const recs = walkAi(rome10, s, 240);
  const sc = scoreCacheLike(recs);
  if(sc > 30) bestCands.push({start: s, len: recs.length, score: sc});
}
bestCands.sort((a,b)=>b.score-a.score);
console.log('Top 30 strict candidates in rome10:');
for(const c of bestCands.slice(0,30)){
  console.log('  0x'+c.start.toString(16).padStart(6,'0')+': '+c.len+' rec, score='+c.score.toFixed(1));
}

// Show details for top candidate
if(bestCands.length > 0){
  const top = bestCands[0];
  console.log('\nDetails of top candidate @0x'+top.start.toString(16)+':');
  const recs = walkAi(rome10, top.start, 240);
  // Distinct hashes
  const byHash = new Map();
  for(const r of recs){
    if(!byHash.has(r.a)) byHash.set(r.a, []);
    byHash.get(r.a).push(r);
  }
  console.log('  Distinct hashes:', byHash.size);
  console.log('  Hash=0 count:', (byHash.get(0)||[]).length);
  // Top 10 hashes
  const sortH = [...byHash.entries()].sort((a,b)=>b[1].length-a[1].length).slice(0,10);
  console.log('  Top 10 hashes (count, centroidX, centroidY):');
  for(const [h, hrecs] of sortH){
    const xs = hrecs.map(r=>r.x);
    const ys = hrecs.map(r=>r.y);
    const cx = xs.reduce((a,b)=>a+b,0)/xs.length;
    const cy = ys.reduce((a,b)=>a+b,0)/ys.length;
    console.log('    0x'+h.toString(16).padStart(8,'0')+' count='+hrecs.length+' centroid=('+cx.toFixed(1)+', '+cy.toFixed(1)+')');
  }
  // First 10 records
  console.log('  First 10 records:');
  for(let i=0;i<Math.min(10, recs.length); i++){
    const r = recs[i];
    console.log('    ['+i+']@0x'+r.off.toString(16)+' hash=0x'+r.a.toString(16).padStart(8,'0')+' key=0x'+r.b.toString(16).padStart(8,'0')+' x='+r.x+' y='+r.y);
  }
}

console.log('\n=== Searching romet1 ===');
bestCands = [];
for(let s=0x1000; s<0x50000; s+=4){
  const recs = walkAi(romet1, s, 240);
  const sc = scoreCacheLike(recs);
  if(sc > 30) bestCands.push({start: s, len: recs.length, score: sc});
}
bestCands.sort((a,b)=>b.score-a.score);
console.log('Top 30 strict candidates in romet1:');
for(const c of bestCands.slice(0,30)){
  console.log('  0x'+c.start.toString(16).padStart(6,'0')+': '+c.len+' rec, score='+c.score.toFixed(1));
}

// Now check if there's structural similarity at the same relative offset.
// In Alex saves, the AI cache is at 0x1024. Maybe in RIS it starts at "0x1024 + some
// header-size-difference". Let me see what's at +0x1024 + various header padding
// values.
console.log('\n=== Alexander cache analogous offsets in rome10 ===');
for(const dx of [0, 0x1000, 0x2000, 0x3000, 0x5000, 0x10000, 0x20000]){
  const start = 0x1024 + dx;
  const recs = walkAi(rome10, start, 240);
  const sc = scoreCacheLike(recs);
  console.log('  0x'+start.toString(16)+': len='+recs.length+' score='+sc.toFixed(1));
}
