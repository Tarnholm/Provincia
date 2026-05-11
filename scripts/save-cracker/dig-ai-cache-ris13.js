// dig-ai-cache-ris13.js — proper RIS cache walk with byte1 ∈ {0x00, 0x20} allowed.
const fs = require('fs');
const ROME_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const rome10 = fs.readFileSync(ROME_DIR + 'save_rome10.sav');
const romet1 = fs.readFileSync(ROME_DIR + 'save_Autosave   Republic of Rome   Turn 1.sav');

// In Alex, key bytes [low, byte1, X, 0]. byte1 was {0x00, 0x02, 0x03, 0x20, 0x22}, X
// was single byte (since Alex map is 130×69, X fits in 7 bits).
// In RIS, hypothesis: key bytes [low, byte1, X_low, X_high]. byte1 = 0x20 mostly.
// But wait — if X_high is set, that's part of X (u16). So byte3 is actually X_hi.

// Let's check: in RIS records, does byte3 of key always look like an X_hi (i.e., 0..3 since X<1020)?
function walk(buf, start, max=20000){
  const recs = [];
  for(let off=start; off<buf.length-12 && recs.length<max; off+=12){
    const a = buf.readUInt32LE(off);
    const b = buf.readUInt32LE(off+4);
    const c = buf.readUInt32LE(off+8);
    if(a===0 && b===0 && c===0) return recs;
    recs.push({a,b,c,off});
  }
  return recs;
}

function checkRec(r){
  const b = r.b;
  const lb = b & 0xff;
  const b1 = (b >>> 8) & 0xff;
  const b2 = (b >>> 16) & 0xff;
  const b3 = (b >>> 24) & 0xff;
  const y = r.c;
  // X could be u8 (Alex) or u16 (RIS). If RIS, X = b2 | (b3 << 8).
  // For Alex: lb in {0,1,2,4,0x80}, b1 in {0,2,3,0x20,0x22}, b3 == 0.
  // For RIS: lb in {0,1,2,4,0x80}, b1 in {0,2,3,0x20,0x22}, b3 could be 0..3 (X_hi).
  // Common: lb ∈ valid set, Y < 700, X = b2 | (b3<<8) ≤ 1020.
  const validLB = [0,1,2,4,0x80].includes(lb);
  const validB1 = [0,2,3,0x20,0x22].includes(b1);
  const X = b2 | (b3 << 8);
  const validX = X <= 1020;
  const validY = y >= 0 && y <= 700;
  return validLB && validB1 && validX && validY;
}

console.log('=== rome10 cache from 0x51b5 with extended schema ===');
const recs = walk(rome10, 0x51b5);
console.log('Walked', recs.length, 'records');
let validRun = 0;
for(const r of recs){
  if(!checkRec(r)) break;
  validRun++;
}
console.log('Valid run:', validRun);
console.log('Cache spans 0x51b5..0x'+(0x51b5 + validRun*12).toString(16));

// What's at end?
if(validRun < recs.length){
  console.log('First invalid:');
  const r = recs[validRun];
  console.log('  @0x'+r.off.toString(16)+' raw='+Array.from(rome10.slice(r.off, r.off+12)).map(b=>b.toString(16).padStart(2,'0')).join(' '));
}

// Histogram
const slice = recs.slice(0, validRun);
const hashes = new Set();
const lbH = {}, b1H = {};
for(const r of slice){
  hashes.add(r.a);
  const lb = r.b & 0xff;
  const b1 = (r.b >>> 8) & 0xff;
  lbH[lb] = (lbH[lb]||0) + 1;
  b1H[b1] = (b1H[b1]||0) + 1;
}
console.log('Distinct hashes:', hashes.size, '(incl 0)');
console.log('Low byte hist:', lbH);
console.log('Byte1 hist:', b1H);

// X range
let minX=1e9, maxX=0, minY=1e9, maxY=0;
for(const r of slice){
  const x = (r.b >>> 16) & 0xffff;
  if(x < minX) minX = x;
  if(x > maxX) maxX = x;
  if(r.c < minY) minY = r.c;
  if(r.c > maxY) maxY = r.c;
}
console.log('X range:', minX+'..'+maxX, 'Y range:', minY+'..'+maxY);

// Now compare rome10 vs romet1 — are they identical at the cache region?
console.log('\n=== rome10 vs romet1 cache comparison ===');
const recs2 = walk(romet1, 0x51b5);
let validRun2 = 0;
for(const r of recs2){
  if(!checkRec(r)) break;
  validRun2++;
}
console.log('rome10 valid run:', validRun, 'romet1 valid run:', validRun2);
let diffs = 0;
const minLen = Math.min(validRun, validRun2);
for(let i=0;i<minLen;i++){
  if(rome10.readBigUInt64LE(0x51b5 + i*12) !== romet1.readBigUInt64LE(0x51b5 + i*12) ||
     rome10.readUInt32LE(0x51b5 + i*12 + 8) !== romet1.readUInt32LE(0x51b5 + i*12 + 8)){
    diffs++;
  }
}
console.log('Cache record diffs:', diffs, '/', minLen);

// Same-record-count = strong indicator the cache structure is fixed-size, NOT growing
// Different count would be expected if the cache grows.

// Now: are these RIS records actually the same as Alex's AI cache schema? Let's
// also check hash distribution.
const hashCounts = new Map();
for(const r of slice){
  hashCounts.set(r.a, (hashCounts.get(r.a)||0)+1);
}
const sortH = [...hashCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15);
console.log('\nTop 15 hashes in rome10 cache:');
for(const [h, c] of sortH){
  const records = slice.filter(r=>r.a===h);
  const xs = records.map(r=>(r.b>>>16)&0xffff);
  const ys = records.map(r=>r.c);
  const cx = xs.reduce((a,b)=>a+b,0)/xs.length;
  const cy = ys.reduce((a,b)=>a+b,0)/ys.length;
  console.log('  0x'+h.toString(16).padStart(8,'0')+' count='+c+' centroid=('+cx.toFixed(0)+','+cy.toFixed(0)+')');
}
