// dig-ai-cache-ris12.js — Full walk of RIS AI cache. Determine TRUE size.
const fs = require('fs');
const ROME_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const rome10 = fs.readFileSync(ROME_DIR + 'save_rome10.sav');
const romet1 = fs.readFileSync(ROME_DIR + 'save_Autosave   Republic of Rome   Turn 1.sav');

function walkFull(buf, start, max=50000){
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

function isValidRec(r){
  const x = (r.b >>> 16) & 0xffff;
  const lb = r.b & 0xff;
  return [0,1,2,4,0x80].includes(lb) && x <= 1020 && r.c <= 700 && (r.b & 0x0000ff00) === 0;
}

console.log('=== rome10 from 0x51b5 (full walk) ===');
const t0 = Date.now();
const recs = walkFull(rome10, 0x51b5, 100000);
console.log('Walked', recs.length, 'records in', Date.now()-t0, 'ms');
// Find the END: first invalid record
let validUntil = -1;
for(let i=0;i<recs.length;i++){
  if(!isValidRec(recs[i])) { validUntil = i; break; }
}
console.log('First invalid at index:', validUntil);
const cacheLen = validUntil < 0 ? recs.length : validUntil;
console.log('Valid cache length:', cacheLen, 'records');
console.log('Cache spans 0x51b5..0x'+(0x51b5 + cacheLen*12).toString(16));

// What's at the end?
if(validUntil >= 0){
  console.log('Invalid record:');
  const r = recs[validUntil];
  const x = (r.b >>> 16) & 0xffff;
  const lb = r.b & 0xff;
  console.log('  @0x'+r.off.toString(16)+' hash=0x'+r.a.toString(16).padStart(8,'0')+' type=0x'+lb.toString(16)+' x='+x+' y='+r.c);
  console.log('Next 5:');
  for(let i=validUntil; i<Math.min(validUntil+5, recs.length); i++){
    const r2 = recs[i];
    console.log('  @0x'+r2.off.toString(16)+' raw='+Array.from(rome10.slice(r2.off, r2.off+12)).map(b=>b.toString(16).padStart(2,'0')).join(' '));
  }
}

// Distinct hashes
const hashes = new Set();
for(let i=0;i<cacheLen;i++) hashes.add(recs[i].a);
console.log('Total records:', cacheLen, 'distinct hashes:', hashes.size, '(incl 0)');

// X / Y range
let minX=1e9, maxX=0, minY=1e9, maxY=0;
for(let i=0;i<cacheLen;i++){
  const r = recs[i];
  const x = (r.b >>> 16) & 0xffff;
  if(x < minX) minX = x;
  if(x > maxX) maxX = x;
  if(r.c < minY) minY = r.c;
  if(r.c > maxY) maxY = r.c;
}
console.log('X range:', minX+'..'+maxX, 'Y range:', minY+'..'+maxY);

// Now do same for romet1
console.log('\n=== romet1 from 0x51b5 (full walk) ===');
const r2 = walkFull(romet1, 0x51b5, 100000);
console.log('Walked', r2.length, 'records');
let r2Valid = -1;
for(let i=0;i<r2.length;i++){
  if(!isValidRec(r2[i])) { r2Valid = i; break; }
}
const cl2 = r2Valid < 0 ? r2.length : r2Valid;
console.log('Valid cache length:', cl2);
console.log('Cache ends at 0x'+(0x51b5 + cl2*12).toString(16));

// What if RIS cache starts a bit earlier? Look at bytes before 0x51b5
console.log('\nBytes 0x5180..0x51c0 in rome10:');
for(let off=0x5180; off<0x51d0; off+=16){
  console.log('  0x'+off.toString(16)+': '+Array.from(rome10.slice(off, off+16)).map(b=>b.toString(16).padStart(2,'0')).join(' '));
}

// Is there a 4-byte header just before the cache? At 0x51b1 there's "00 3c 36 00" which is 0x36 3c 00 = 0x363c00 = 3554304? Or 0x363c = 13884? Or "size" word?
// At 0x51a8 there's "00 a0 40 00" = 0x4040 = 16448? Maybe length prefix?
// Let me read u32 LE at various offsets prior to 0x51b5:
console.log('\nu32 LE before cache:');
for(let off=0x51a0; off<0x51b8; off+=4){
  console.log('  @0x'+off.toString(16)+': 0x'+rome10.readUInt32LE(off).toString(16).padStart(8,'0')+' = '+rome10.readUInt32LE(off));
}

// Check if any of these match cacheLen
console.log('cacheLen rome10 =', cacheLen, '(decimal)');
console.log('cacheLen romet1 =', cl2, '(decimal)');

// Look for cache length prefix - scan bytes BEFORE the cache for the count
// Cache bytes total = cacheLen * 12
console.log('Cache total bytes:', cacheLen * 12, '= 0x'+(cacheLen*12).toString(16));
