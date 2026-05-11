// dig-ai-cache-semantics1.js — session 19: dive into AI cache record structure.
// First record at 0x1024 has hash=0, turn=2, key=0x004c0200. This looks like:
//   key bytes (LE): [00 02 4c 00] → byte0=00 (low), byte1=02, byte2=0x4c, byte3=00
// So key is read u32 LE → 0x004c0200, but layout in memory is: [byte0=0x00, byte1=0x02, byte2=0x4c, byte3=0x00]
//
// Record [1] @0x1030: hash=0xd2fd4c9d, key=0x005c2001, turn=12
//   key bytes: [01, 20, 5c, 00]
//
// Pattern: key low byte = 0x01 for "valid agent" records, 0x00 or other for special?

const fs = require('fs');
const ALEX_DIR = 'C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z/';
const alexT13E = fs.readFileSync(ALEX_DIR + '0357_save_Autosave   Macedon   Turn 13 End.sav');

// Walk the full Alexander cache
function walk(buf, start = 0x1024){
  const recs = [];
  for(let off=start; off<buf.length-12; off+=12){
    const a = buf.readUInt32LE(off);
    const b = buf.readUInt32LE(off+4);
    const c = buf.readUInt32LE(off+8);
    if((a===0 && b===0 && c===0) || c >= 300){
      return {recs, end: off};
    }
    recs.push({a,b,c,off});
  }
  return {recs, end: buf.length};
}

const {recs, end} = walk(alexT13E);
console.log('Cache has', recs.length, 'records, ends at 0x' + end.toString(16));

// Histogram of key low byte
const lowB = {}, b1 = {}, b2 = {}, b3 = {};
for(const r of recs){
  const b0v = r.b & 0xff;
  const b1v = (r.b >>> 8) & 0xff;
  const b2v = (r.b >>> 16) & 0xff;
  const b3v = (r.b >>> 24) & 0xff;
  lowB[b0v] = (lowB[b0v]||0)+1;
  b1[b1v] = (b1[b1v]||0)+1;
  b2[b2v] = (b2[b2v]||0)+1;
  b3[b3v] = (b3[b3v]||0)+1;
}
console.log('Key byte0 (low) histogram:', JSON.stringify(lowB));
console.log('Key byte1 histogram:', JSON.stringify(b1));
console.log('Key byte2 histogram (top 20):');
const b2sorted = Object.entries(b2).sort((a,b)=>b[1]-a[1]).slice(0,20);
for(const [k,v] of b2sorted) console.log('  0x'+(+k).toString(16).padStart(2,'0')+': '+v);
console.log('Key byte3 histogram:', JSON.stringify(b3));

// What records have hash=0?
const hashZeroRecs = recs.filter(r => r.a === 0);
console.log('\nHash=0 records:', hashZeroRecs.length, '/', recs.length);
console.log('First 10 hash=0:');
for(let i=0;i<Math.min(10, hashZeroRecs.length); i++){
  const r = hashZeroRecs[i];
  console.log('  @0x'+r.off.toString(16)+' key=0x'+r.b.toString(16).padStart(8,'0')+' turn='+r.c);
}

// Group by hash → see distribution
const byHash = new Map();
for(const r of recs){
  if(!byHash.has(r.a)) byHash.set(r.a, []);
  byHash.get(r.a).push(r);
}
console.log('\nDistinct hashes:', byHash.size);
const sortedHashes = [...byHash.entries()].sort((a,b)=>b[1].length-a[1].length);
console.log('Top 20 hashes by frequency:');
for(let i=0;i<Math.min(20, sortedHashes.length); i++){
  const [h, hrecs] = sortedHashes[i];
  const turns = hrecs.map(r=>r.c);
  const turnRange = Math.min(...turns)+'..'+Math.max(...turns);
  const distinctKeys = new Set(hrecs.map(r=>r.b)).size;
  console.log('  hash=0x'+h.toString(16).padStart(8,'0')+' count='+hrecs.length+' turn-range='+turnRange+' distinct-keys='+distinctKeys);
}

// For hash=0xd2fd4c9d (top), show all records
console.log('\nAll records for hash=0xd2fd4c9d:');
const h1 = byHash.get(0xd2fd4c9d) || [];
for(const r of h1){
  console.log('  @0x'+r.off.toString(16)+' key=0x'+r.b.toString(16).padStart(8,'0')+' turn='+r.c);
}
