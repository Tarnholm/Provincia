// dig-ai-cache-ris8.js — Deep-dive run at 0x51b5 in rome10. This looks like
// an AI cache, just with key.lowbyte=04 (instead of 01 like Alex).

const fs = require('fs');
const ROME_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const rome10 = fs.readFileSync(ROME_DIR + 'save_rome10.sav');
const romet1 = fs.readFileSync(ROME_DIR + 'save_Autosave   Republic of Rome   Turn 1.sav');

// In Alex the cache started at 0x1024 (12-byte aligned to 4? 0x1024 mod 4=0).
// In rome10 the run was at 0x51b5 (mod 4 = 1 — odd alignment), len 763. That suggests
// the actual cache start is somewhere before, with header bytes.
// Check earlier offsets too.

// First widen the search: scan rome10 for a region with high cache-like signature.
// Look at 0x5000..0x10000 area for 4-byte aligned starts that have many consecutive
// AI-cache-shaped records.
function tryStart(buf, start, maxY=240, maxLen=2000){
  const recs = [];
  for(let off=start; off<buf.length-12 && recs.length<maxLen; off+=12){
    const a = buf.readUInt32LE(off);
    const b = buf.readUInt32LE(off+4);
    const c = buf.readUInt32LE(off+8);
    // Sentinel
    if(a===0 && b===0 && c===0) return recs;
    if(c >= maxY) return recs;
    if((b & 0xff000000) !== 0) return recs;
    recs.push({a,b,c, off});
  }
  return recs;
}

// Find aligned (4-byte) start in 0x4000..0x10000 with maximum cache-like length
console.log('Aligned 4-byte starts in 0x4000..0x10000:');
const aligned = [];
for(let s=0x4000; s<0x10000; s+=4){
  const recs = tryStart(rome10, s, 240);
  if(recs.length >= 50) aligned.push({s, len: recs.length});
}
aligned.sort((a,b)=>b.len-a.len);
for(const a of aligned.slice(0, 30)){
  console.log('  0x'+a.s.toString(16)+': '+a.len+' records');
}

// Now: the top run was at 0x51b5. The run length depends on Y termination.
// 12-byte aligned starts that include 0x51b5: 0x51b5 itself isn't aligned.
// Try 4-byte aligned starts at 0x51b4 (0x51b5-1), 0x51b8 (next aligned).
console.log('\nAt 0x51b4:');
const r0 = tryStart(rome10, 0x51b4, 240);
console.log('  Records: '+r0.length);
console.log('\nAt 0x51b0:');
const r1 = tryStart(rome10, 0x51b0, 240);
console.log('  Records: '+r1.length);

// Find the cache start by backing up from 0x51b5 to find where the pattern begins
console.log('\nBackup search: scan backwards from 0x51b5');
for(let s=0x51b5; s>=0x4000; s-=4){
  const recs = tryStart(rome10, s, 240);
  if(recs.length >= 200) {
    // The first valid record's hash?
    console.log('  0x'+s.toString(16)+': '+recs.length+' records, first hash=0x'+recs[0].a.toString(16).padStart(8,'0')+' key=0x'+recs[0].b.toString(16).padStart(8,'0')+' y='+recs[0].c);
  }
}

// And let's look at what's *around* 0x51b4 specifically
console.log('\nBytes around 0x5180..0x51e0:');
for(let off=0x5180; off<0x5200; off+=16){
  let line = '0x'+off.toString(16)+': ';
  for(let i=0;i<16;i++){
    line += rome10[off+i].toString(16).padStart(2,'0')+' ';
  }
  console.log(line);
}

// What if the cache actually starts on a different alignment? Check what's at
// 0x51b4 vs 0x51b8.
console.log('\n0x51b4 read as 12-byte records (force-align):');
for(let i=0;i<5;i++){
  const off = 0x51b4 + i*12;
  console.log('  ['+i+']@0x'+off.toString(16)+' hash=0x'+rome10.readUInt32LE(off).toString(16).padStart(8,'0')+' key=0x'+rome10.readUInt32LE(off+4).toString(16).padStart(8,'0')+' y='+rome10.readUInt32LE(off+8));
}
console.log('\n0x51b8 read as 12-byte records:');
for(let i=0;i<5;i++){
  const off = 0x51b8 + i*12;
  console.log('  ['+i+']@0x'+off.toString(16)+' hash=0x'+rome10.readUInt32LE(off).toString(16).padStart(8,'0')+' key=0x'+rome10.readUInt32LE(off+4).toString(16).padStart(8,'0')+' y='+rome10.readUInt32LE(off+8));
}

// Try the cache pattern from BEGINNING of file: find where len(0x???? region) is best
console.log('\nBroader (4-byte aligned) full scan 0x4000..0x20000:');
const cands = [];
for(let s=0x4000; s<0x20000; s+=4){
  const recs = tryStart(rome10, s, 240);
  if(recs.length >= 100) cands.push({s, len: recs.length});
}
cands.sort((a,b)=>b.len-a.len);
for(const c of cands.slice(0,30)){
  console.log('  0x'+c.s.toString(16)+': '+c.len+' records');
}
