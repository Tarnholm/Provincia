// dig-ai-cache-ris1.js — session 19: Locate the AI policy cache start offset
// in RIS imperial saves. Session 18 noted "similar 12-byte pattern at 0x3c78 in
// rome10". Schema in Alexander saves: 12-byte records (u32 hash, u32 key, u32 turn).
// Constraint: turn < 200, key.low_byte ∈ {0x01..0x20}, hash != 0.

const fs = require('fs');
const ROME_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const ALEX_DIR = 'C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z/';

const rome10 = fs.readFileSync(ROME_DIR + 'save_rome10.sav');
const romet1 = fs.readFileSync(ROME_DIR + 'save_Autosave   Republic of Rome   Turn 1.sav');
const alexT13E = fs.readFileSync(ALEX_DIR + '0357_save_Autosave   Macedon   Turn 13 End.sav');

// First confirm Alexander signature (known: starts at 0x1024, ~466 records)
function tryParse(buf, start, maxLen = 20000){
  const recs = [];
  for(let off=start; off<Math.min(buf.length-12, start+maxLen); off+=12){
    const a = buf.readUInt32LE(off);
    const b = buf.readUInt32LE(off+4);
    const c = buf.readUInt32LE(off+8);
    if(c === 0 || c >= 300) return recs;
    if(a === 0) return recs;
    recs.push({a,b,c,off});
  }
  return recs;
}

// Validate Alexander baseline
const alexRecs = tryParse(alexT13E, 0x1024);
console.log('Alexander T13E baseline at 0x1024:', alexRecs.length, 'records');

// Scan rome10 and romet1 for similar pattern
// Strategy: find runs of >= 50 consecutive 12-byte slots where:
//   - turn (u32 at +8) is in [1, 200)
//   - low byte of key (byte at +5? or +8?) increments slowly
//   - hash (u32 at +0) is non-zero, in a sane range
// Try sliding window candidate start offsets.

function scoreRun(buf, start, want=100){
  let count = 0;
  const turns = new Set();
  for(let off=start; off<buf.length-12; off+=12){
    const a = buf.readUInt32LE(off);
    const b = buf.readUInt32LE(off+4);
    const c = buf.readUInt32LE(off+8);
    if(c === 0 || c >= 300 || a === 0) break;
    // hash must look like a hash (>0x10000)
    if(a < 0x10000) break;
    turns.add(c);
    count++;
    if(count >= want) break;
  }
  return {count, turnCount: turns.size};
}

console.log('\nScanning rome10 (length=' + rome10.length + ') for AI cache pattern...');
let candidates = [];
// Scan in 4-byte alignment up to 0x10000
for(let s=0; s<0x10000; s+=4){
  const r = scoreRun(rome10, s, 100);
  if(r.count >= 30) candidates.push({start: s, ...r});
}
candidates.sort((a,b)=>b.count-a.count);
console.log('Top 20 candidates in rome10 (length-sorted):');
for(const c of candidates.slice(0, 20)){
  console.log('  0x'+c.start.toString(16).padStart(6,'0')+': '+c.count+' records, '+c.turnCount+' distinct turns');
}

// Also check session 18's specific note: 0x3c78
console.log('\nDirect check at 0x3c78 in rome10:');
const ris3c78 = tryParse(rome10, 0x3c78);
console.log('  Records:', ris3c78.length);
if(ris3c78.length > 0){
  console.log('  First 5:');
  for(let i=0;i<Math.min(5, ris3c78.length); i++){
    const r = ris3c78[i];
    console.log('    ['+i+'] hash=0x'+r.a.toString(16).padStart(8,'0')+' key=0x'+r.b.toString(16).padStart(8,'0')+' turn='+r.c);
  }
}

console.log('\nSame in romet1:');
const romet1_3c78 = tryParse(romet1, 0x3c78);
console.log('  Records at 0x3c78:', romet1_3c78.length);
candidates = [];
for(let s=0; s<0x10000; s+=4){
  const r = scoreRun(romet1, s, 100);
  if(r.count >= 30) candidates.push({start: s, ...r});
}
candidates.sort((a,b)=>b.count-a.count);
console.log('Top 10 candidates in romet1:');
for(const c of candidates.slice(0, 10)){
  console.log('  0x'+c.start.toString(16).padStart(6,'0')+': '+c.count+' records, '+c.turnCount+' distinct turns');
}
