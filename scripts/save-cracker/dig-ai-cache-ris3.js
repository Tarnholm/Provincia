// dig-ai-cache-ris3.js — Pin RIS imperial AI cache start offset.
// Session 18 noted "similar 12-byte pattern at 0x3c78 in rome10 with ~60+ records".
// Now we know the schema: u32 hash, u32 key (low byte = 01 usually, byte2 = tile-X 0..240),
// u32 turn-field (tile-Y, 0..238).
//
// In RIS, map is 240×238 (so X up to ~239, Y up to ~237).
// In Alexander, map is 130×69 (X up to ~129, Y up to ~68).

const fs = require('fs');
const ROME_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const rome10 = fs.readFileSync(ROME_DIR + 'save_rome10.sav');
const romet1 = fs.readFileSync(ROME_DIR + 'save_Autosave   Republic of Rome   Turn 1.sav');

// Walk an AI cache, but with RIS bounds (Y up to ~238)
function walkAt(buf, start, maxY=240){
  const recs = [];
  for(let off=start; off<buf.length-12; off+=12){
    const a = buf.readUInt32LE(off);
    const b = buf.readUInt32LE(off+4);
    const c = buf.readUInt32LE(off+8);
    if(a===0 && b===0 && c===0) return recs;
    if(c >= maxY) return recs;
    if((b & 0xff000000) !== 0) return recs; // key high byte should be 0
    recs.push({a,b,c, x: (b>>>16)&0xff, y: c});
  }
  return recs;
}

// Score: a valid AI cache is at least ~50 records long, with X in 0..239 and Y in 0..237
function scoreCandidate(buf, start, maxY){
  const recs = walkAt(buf, start, maxY);
  if(recs.length < 30) return 0;
  // Count valid records (low byte of key = 01 typically OR 00 02 04)
  let validKey = 0;
  for(const r of recs){
    const lb = r.b & 0xff;
    if(lb === 0 || lb === 1 || lb === 2 || lb === 4 || lb === 0x80) validKey++;
  }
  return validKey >= recs.length*0.9 ? recs.length : 0;
}

// Scan rome10
console.log('Scanning rome10 (length=' + rome10.length + ') for AI cache pattern (RIS bounds)...');
const cands = [];
for(let s=0x1000; s<0x20000; s+=4){
  const sc = scoreCandidate(rome10, s, 240);
  if(sc > 50) cands.push({start: s, recs: sc});
}
cands.sort((a,b)=>b.recs-a.recs);
console.log('Top 20 candidates in rome10:');
for(const c of cands.slice(0,20)){
  console.log('  0x'+c.start.toString(16).padStart(6,'0')+': '+c.recs+' records');
}

// Also direct check at 0x3c78
console.log('\nDirect check at 0x3c78 in rome10 (RIS bounds):');
const ris = walkAt(rome10, 0x3c78, 240);
console.log('  Records:', ris.length);
if(ris.length > 0){
  console.log('  First 15:');
  for(let i=0;i<Math.min(15, ris.length); i++){
    const r = ris[i];
    console.log('    ['+i+'] hash=0x'+r.a.toString(16).padStart(8,'0')+' key=0x'+r.b.toString(16).padStart(8,'0')+' x='+r.x+' y='+r.y);
  }
  console.log('  Last 5:');
  for(let i=Math.max(0, ris.length-5); i<ris.length; i++){
    const r = ris[i];
    console.log('    ['+i+'] hash=0x'+r.a.toString(16).padStart(8,'0')+' key=0x'+r.b.toString(16).padStart(8,'0')+' x='+r.x+' y='+r.y);
  }
}

// Search alternative starts in rome10 — also try 0x3c00..0x4000 byte-by-byte
console.log('\n\nFine-scan rome10 from 0x3c00..0x4500 in 1-byte steps:');
const fineCands = [];
for(let s=0x3c00; s<0x4500; s++){
  const sc = scoreCandidate(rome10, s, 240);
  if(sc > 30) fineCands.push({start: s, recs: sc});
}
fineCands.sort((a,b)=>b.recs-a.recs);
for(const c of fineCands.slice(0,10)){
  console.log('  0x'+c.start.toString(16).padStart(6,'0')+': '+c.recs+' records');
}

// Try romet1
console.log('\n\nromet1 length:', romet1.length);
console.log('Scanning romet1 (start 0x1000..0x20000)...');
const cands2 = [];
for(let s=0x1000; s<0x20000; s+=4){
  const sc = scoreCandidate(romet1, s, 240);
  if(sc > 30) cands2.push({start: s, recs: sc});
}
cands2.sort((a,b)=>b.recs-a.recs);
console.log('Top 20 candidates in romet1:');
for(const c of cands2.slice(0,20)){
  console.log('  0x'+c.start.toString(16).padStart(6,'0')+': '+c.recs+' records');
}

// Show whats at 0x3c78 in romet1
console.log('\nDirect check at 0x3c78 in romet1:');
const ris2 = walkAt(romet1, 0x3c78, 240);
console.log('  Records:', ris2.length);
if(ris2.length > 0){
  console.log('  First 5:');
  for(let i=0;i<Math.min(5, ris2.length); i++){
    const r = ris2[i];
    console.log('    ['+i+'] hash=0x'+r.a.toString(16).padStart(8,'0')+' key=0x'+r.b.toString(16).padStart(8,'0')+' x='+r.x+' y='+r.y);
  }
}
