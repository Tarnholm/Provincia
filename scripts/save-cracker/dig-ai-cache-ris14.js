// dig-ai-cache-ris14.js — Pin the exact RIS cache START offset. Walk backwards from
// 0x51b5 to find where the cache actually begins.

const fs = require('fs');
const ROME_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const rome10 = fs.readFileSync(ROME_DIR + 'save_rome10.sav');
const romet1 = fs.readFileSync(ROME_DIR + 'save_Autosave   Republic of Rome   Turn 1.sav');

function checkRec(b, c){
  const lb = b & 0xff;
  const b1 = (b >>> 8) & 0xff;
  const X = (b >>> 16) & 0xffff;
  const validLB = [0,1,2,4,0x80].includes(lb);
  const validB1 = [0,2,3,0x20,0x22].includes(b1);
  const validX = X <= 1020;
  const validY = c <= 700;
  return validLB && validB1 && validX && validY;
}

// Walk backwards from 0x51b5 to find earliest valid record (going 12 bytes at a time)
console.log('Walking BACKWARD from 0x51b5:');
let s = 0x51b5;
while(s >= 12) {
  const prev = s - 12;
  const a = rome10.readUInt32LE(prev);
  const b = rome10.readUInt32LE(prev+4);
  const c = rome10.readUInt32LE(prev+8);
  if(a===0 && b===0 && c===0) break;
  if(!checkRec(b, c)) break;
  s = prev;
}
console.log('Earliest valid record start: 0x'+s.toString(16));
// What's at this offset and just before?
console.log('Bytes 0x'+(s-16).toString(16)+'..0x'+(s+16).toString(16)+':');
for(let off=s-16; off<s+32; off+=16){
  console.log('  @0x'+off.toString(16)+': '+Array.from(rome10.slice(off, off+16)).map(b=>b.toString(16).padStart(2,'0')).join(' '));
}

// Now do full re-walk from earliest start
function walkFromStart(buf, start, max=50000){
  const recs = [];
  for(let off=start; off<buf.length-12 && recs.length<max; off+=12){
    const a = buf.readUInt32LE(off);
    const b = buf.readUInt32LE(off+4);
    const c = buf.readUInt32LE(off+8);
    if(a===0 && b===0 && c===0) return recs;
    if(!checkRec(b, c)) return recs;
    recs.push({a,b,c,off});
  }
  return recs;
}

const fromS = walkFromStart(rome10, s);
console.log('\nFrom 0x'+s.toString(16)+' valid records:', fromS.length);
console.log('Ends at 0x'+(s + fromS.length*12).toString(16));

// Also do romet1
const fromS2 = walkFromStart(romet1, s);
console.log('romet1 from 0x'+s.toString(16)+' valid records:', fromS2.length);

// Now: rome10 has different first records than romet1?
console.log('\nFirst 10 records from rome10:');
for(let i=0;i<10;i++){
  const r = fromS[i];
  const x = (r.b >>> 16) & 0xffff;
  const lb = r.b & 0xff;
  const b1 = (r.b >>> 8) & 0xff;
  console.log('  ['+i+']@0x'+r.off.toString(16)+' hash=0x'+r.a.toString(16).padStart(8,'0')+' type=0x'+lb.toString(16)+' b1=0x'+b1.toString(16)+' X='+x+' Y='+r.c);
}
console.log('First 10 records from romet1:');
for(let i=0;i<10;i++){
  const r = fromS2[i];
  const x = (r.b >>> 16) & 0xffff;
  const lb = r.b & 0xff;
  const b1 = (r.b >>> 8) & 0xff;
  console.log('  ['+i+']@0x'+r.off.toString(16)+' hash=0x'+r.a.toString(16).padStart(8,'0')+' type=0x'+lb.toString(16)+' b1=0x'+b1.toString(16)+' X='+x+' Y='+r.c);
}

// Cross-turn diff (rome10 vs romet1) on cache region
let diffsInCache = 0;
const minLen = Math.min(fromS.length, fromS2.length);
for(let i=0;i<minLen;i++){
  if(fromS[i].a !== fromS2[i].a || fromS[i].b !== fromS2[i].b || fromS[i].c !== fromS2[i].c) diffsInCache++;
}
console.log('\nrome10 vs romet1 cache diffs:', diffsInCache, '/', minLen);

// Decode/visualize: are these path-trails? Group by hash and check coordinates form linear/connected paths
const byHash = new Map();
for(const r of fromS){
  if(r.a === 0) continue;
  if(!byHash.has(r.a)) byHash.set(r.a, []);
  byHash.get(r.a).push({x:(r.b>>>16)&0xffff, y:r.c});
}
const sortH = [...byHash.entries()].sort((a,b)=>b[1].length-a[1].length).slice(0,5);
console.log('\nTop 5 hashes - sample coordinates:');
for(const [h, hrecs] of sortH){
  console.log('hash=0x'+h.toString(16).padStart(8,'0')+' n='+hrecs.length);
  for(let i=0;i<Math.min(15, hrecs.length); i++){
    console.log('  ('+hrecs[i].x+','+hrecs[i].y+')');
  }
}
