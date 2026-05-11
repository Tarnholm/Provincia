// dig-ai-cache-ris5.js — Compare rome10 vs romet1 to find within-turn-stable regions.
// Apply Session 18's methodology: AI cache is stable within turn but changes across turns.
// rome10 might be turn 10 and romet1 is turn 1 — across-turn diff should reveal AI cache region.

const fs = require('fs');
const ROME_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const rome10 = fs.readFileSync(ROME_DIR + 'save_rome10.sav');
const romet1 = fs.readFileSync(ROME_DIR + 'save_Autosave   Republic of Rome   Turn 1.sav');

console.log('rome10 size:', rome10.length);
console.log('romet1 size:', romet1.length);

// First just diff the two
let totalDiffs = 0;
const minLen = Math.min(rome10.length, romet1.length);
const diffOffsets = [];
for(let i=0;i<minLen;i++){
  if(rome10[i] !== romet1[i]) {
    totalDiffs++;
    if(diffOffsets.length < 100) diffOffsets.push(i);
  }
}
console.log('Total byte diffs:', totalDiffs);
console.log('First 30 diff offsets:', diffOffsets.slice(0, 30).map(o=>'0x'+o.toString(16)).join(', '));

// Where do diffs concentrate? Histogram by 0x1000-byte bucket
const bucket = new Map();
for(let i=0;i<minLen;i++){
  if(rome10[i] !== romet1[i]){
    const b = (i >>> 12);
    bucket.set(b, (bucket.get(b)||0)+1);
  }
}
console.log('\nDiff bytes per 4KB bucket (top 30 buckets):');
const sortB = [...bucket.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 30);
for(const [b, n] of sortB){
  console.log('  0x'+(b<<12).toString(16).padStart(6,'0')+'..0x'+(((b+1)<<12)-1).toString(16).padStart(6,'0')+': '+n+' diff bytes');
}

// Now look at what's in early file. Maybe the AI cache exists in RIS at a totally
// different offset. Look at offsets where both files have many small u32 values
// (turn=Y between 0 and 240).
console.log('\nDensity scan: regions where lots of consecutive u32s are in 1..238...');
function isYRange(v) { return v >= 1 && v < 240; }
let bestRun = 0, bestStart = 0;
let currStart = -1, currLen = 0;
const allRuns = [];
for(let off=0x1000; off<Math.min(rome10.length, 0x200000) - 4; off+=12){
  const c = rome10.readUInt32LE(off+8);
  if(isYRange(c)) {
    if(currStart === -1) currStart = off;
    currLen++;
  } else {
    if(currLen > bestRun) { bestRun = currLen; bestStart = currStart; }
    if(currLen >= 30) allRuns.push({start: currStart, len: currLen});
    currStart = -1;
    currLen = 0;
  }
}
allRuns.sort((a,b)=>b.len-a.len);
console.log('Top 20 runs of consecutive valid-Y u32 values (every 12 bytes) in rome10:');
for(const r of allRuns.slice(0, 20)){
  console.log('  0x'+r.start.toString(16).padStart(6,'0')+': '+r.len+' consecutive');
}

// Now relax and just look at consecutive 12-byte slots where:
//   u32@off+8 (Y) in [1..238] and u32@off+4 (key) has high byte 0
function scoreLoose(buf, start, maxY=240, maxLen=2000){
  let len = 0;
  const records = [];
  for(let off=start; off<buf.length-12 && len<maxLen; off+=12){
    const a = buf.readUInt32LE(off);
    const b = buf.readUInt32LE(off+4);
    const c = buf.readUInt32LE(off+8);
    if(c === 0 || c >= maxY) break;
    if((b & 0xff000000) !== 0) break;
    records.push({a,b,c, x: (b>>>16)&0xff, y: c});
    len++;
  }
  if(records.length < 30) return {len: 0, recs:[]};
  // Count distinct hashes
  const hashes = new Set(records.map(r=>r.a));
  if(hashes.size < 3) return {len: 0, recs:[]};
  return {len: records.length, recs: records, distinctHashes: hashes.size};
}

console.log('\nLoose-signature scan rome10 0x1000..0x200000 in 4-byte steps...');
const looseCands = [];
for(let s=0x1000; s<Math.min(rome10.length, 0x200000); s+=4){
  const r = scoreLoose(rome10, s, 240);
  if(r.len >= 60 && r.distinctHashes >= 8) looseCands.push({start: s, len: r.len, h: r.distinctHashes});
}
looseCands.sort((a,b)=>b.len-a.len);
console.log('Top 20 loose candidates:');
for(const c of looseCands.slice(0, 20)){
  console.log('  0x'+c.start.toString(16).padStart(6,'0')+': '+c.len+' records, '+c.h+' distinct hashes');
}
