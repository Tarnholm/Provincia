// dig-ai-cache-ris11.js — RIS uses different coords than Alex. Let's just take
// the data and see what bounds emerge.

const fs = require('fs');
const ROME_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const rome10 = fs.readFileSync(ROME_DIR + 'save_rome10.sav');

function walkAuto(buf, start, opts={}){
  const recs = [];
  let maxFlat = opts.max || 4000;
  for(let off=start; off<buf.length-12 && recs.length<maxFlat; off+=12){
    const a = buf.readUInt32LE(off);
    const b = buf.readUInt32LE(off+4);
    const c = buf.readUInt32LE(off+8);
    if(a===0 && b===0 && c===0) return recs;
    recs.push({a,b,c,off});
  }
  return recs;
}

// Walk many records from 0x51b5 unconditionally, then analyze
const allRecs = walkAuto(rome10, 0x51b5);
console.log('Walked', allRecs.length, 'records from 0x51b5');

// Field 0 = hash
// Field 1 = key (low byte = type, bytes [2..3] = X as u16)
// Field 2 = Y
// Plot X (key bytes[2..3] as u16) vs Y (field 2)
let maxX = 0, maxY = 0;
let typeHist = {};
const lows = [];
for(const r of allRecs){
  const x = (r.b >>> 16) & 0xffff;
  const lb = r.b & 0xff;
  const y = r.c;
  typeHist[lb] = (typeHist[lb]||0) + 1;
  if(x > maxX) maxX = x;
  if(y > maxY) maxY = y;
  lows.push({lb, x, y, hash: r.a});
}
console.log('Max X observed:', maxX);
console.log('Max Y observed:', maxY);
console.log('Type byte hist:', typeHist);

// Filter to records where lb is one of {1, 2, 4, 0x80}
const valid = lows.filter(r => [0,1,2,4,0x80].includes(r.lb));
console.log('Valid (type-byte) records:', valid.length, '/', allRecs.length);
let vMaxX = 0, vMaxY = 0;
for(const r of valid){
  if(r.x > vMaxX) vMaxX = r.x;
  if(r.y > vMaxY) vMaxY = r.y;
}
console.log('Valid max X:', vMaxX, 'max Y:', vMaxY);

// First non-zero-hash record
let firstNZ = -1;
for(let i=0;i<allRecs.length;i++){
  if(allRecs[i].a !== 0) { firstNZ = i; break; }
}
console.log('First non-zero-hash record at index:', firstNZ);
if(firstNZ >= 0){
  console.log('  @0x'+allRecs[firstNZ].off.toString(16)+' hash=0x'+allRecs[firstNZ].a.toString(16).padStart(8,'0')+' key=0x'+allRecs[firstNZ].b.toString(16).padStart(8,'0')+' Y='+allRecs[firstNZ].c);
}

// Count records with hash != 0
const nzRecs = allRecs.filter(r=>r.a!==0);
console.log('Non-zero-hash records:', nzRecs.length);
const distinctNZHashes = new Set(nzRecs.map(r=>r.a));
console.log('Distinct non-zero hashes:', distinctNZHashes.size);

// Show first 10 non-zero-hash records
console.log('\nFirst 10 non-zero-hash records:');
for(let i=0;i<Math.min(10, nzRecs.length); i++){
  const r = nzRecs[i];
  const x = (r.b >>> 16) & 0xffff;
  const lb = r.b & 0xff;
  console.log('  @0x'+r.off.toString(16)+' hash=0x'+r.a.toString(16).padStart(8,'0')+' type=0x'+lb.toString(16)+' x='+x+' y='+r.c);
}

// Look at the highest Y values — find cache boundary
// First find where Y exceeds 700 (any sensible map max). Or find where records
// stop being valid.
let firstInvalidAt = -1;
for(let i=0;i<allRecs.length;i++){
  const r = allRecs[i];
  const x = (r.b >>> 16) & 0xffff;
  const lb = r.b & 0xff;
  // Invalid if type is not in valid set, OR x > 1020, OR y > 700
  if(![0,1,2,4,0x80].includes(lb) || x > 1020 || r.c > 700){
    firstInvalidAt = i;
    break;
  }
}
console.log('\nFirst invalid record at index:', firstInvalidAt, 'offset 0x'+(0x51b5 + firstInvalidAt*12).toString(16));
if(firstInvalidAt >= 0 && firstInvalidAt < allRecs.length){
  const r = allRecs[firstInvalidAt];
  const x = (r.b >>> 16) & 0xffff;
  const lb = r.b & 0xff;
  console.log('  @0x'+r.off.toString(16)+' hash=0x'+r.a.toString(16).padStart(8,'0')+' type=0x'+lb.toString(16)+' x='+x+' y='+r.c);
  console.log('Cache size from 0x51b5 to first-invalid:', firstInvalidAt, 'records');
}

// Find the run length where records pass validity
let validRun = 0;
for(let i=0;i<allRecs.length;i++){
  const r = allRecs[i];
  const x = (r.b >>> 16) & 0xffff;
  const lb = r.b & 0xff;
  if(![0,1,2,4,0x80].includes(lb) || x > 1020 || r.c > 700) break;
  validRun++;
}
console.log('Valid contiguous run (X≤1020, Y≤700):', validRun);
