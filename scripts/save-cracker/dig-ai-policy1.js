// dig-ai-policy1.js — find the AI policy cache inside major-faction records
// Strategy:
//   1. Locate major-faction records using the canonical signature (+8=100, +12=1, +24=pos+24, +40=pos+40, +44=6)
//   2. For each, walk trailing data after the region list (+52+4*regionCount)
//   3. Look for a 16-byte-stride array (per session 5/7 hint).
//   4. Diff turn-boundary saves to find which bytes change per turn (AI re-evaluation cadence)

const fs = require('fs');
const paths = [
  ['rome10', 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav'],
  ['rorT1', 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav'],
];

function findMajorFactions(buf){
  const recs = [];
  for(let i=0;i+200<buf.length;i++){
    if(buf.readUInt32LE(i+8) !== 100) continue;
    if(buf.readUInt32LE(i+12) !== 1) continue;
    if(buf.readUInt32LE(i+24) !== i+24) continue;
    if(buf.readUInt32LE(i+40) !== i+40) continue;
    if(buf.readUInt32LE(i+44) !== 6) continue;
    const regions = buf.readUInt32LE(i+48);
    if(regions > 200 || regions < 0) continue;
    recs.push({pos: i, regions, treasury: buf.readInt32LE(i)});
  }
  return recs;
}

const A = fs.readFileSync(paths[0][1]);
const B = fs.readFileSync(paths[1][1]);
const recsA = findMajorFactions(A);
const recsB = findMajorFactions(B);
console.log(paths[0][0]+': '+recsA.length+' major faction records');
console.log(paths[1][0]+': '+recsB.length+' major faction records');
for(const r of recsA.slice(0,15)) console.log('  rome10 @0x'+r.pos.toString(16)+': treasury='+r.treasury+', regions='+r.regions);
console.log();
for(const r of recsB.slice(0,15)) console.log('  rorT1 @0x'+r.pos.toString(16)+': treasury='+r.treasury+', regions='+r.regions);

// Pick the LARGEST record by trailing size — that's likely the player record
// Compute trailing data size as next_record_pos - current_record_pos - (52 + 4*regions)
function getRecord(buf, recs, i){
  const r = recs[i];
  const trailingStart = r.pos + 52 + 4*r.regions;
  const trailingEnd = (i+1 < recs.length) ? recs[i+1].pos : buf.length;
  return {...r, trailingStart, trailingSize: trailingEnd - trailingStart};
}
console.log('\nrome10 trailing data sizes:');
for(let i=0;i<recsA.length;i++){
  const r = getRecord(A, recsA, i);
  console.log('  idx '+i+' (treasury '+r.treasury+', '+r.regions+' regions): trailing='+r.trailingSize+' bytes');
}
console.log('\nrorT1 trailing data sizes:');
for(let i=0;i<recsB.length;i++){
  const r = getRecord(B, recsB, i);
  console.log('  idx '+i+' (treasury '+r.treasury+', '+r.regions+' regions): trailing='+r.trailingSize+' bytes');
}

// Player faction in rome10 is at idx 0 (per session 5/9 conventions); largest trailing should be player record
// Trailing starts at +52+4N — diff the FIRST 200 bytes of trailing to find AI policy cache

const idx = 0;  // player Romans Julii
const rA = getRecord(A, recsA, idx);
const rB = getRecord(B, recsB, idx);
console.log('\nPlayer faction (rome10): pos=0x'+rA.pos.toString(16)+', trailing starts at 0x'+rA.trailingStart.toString(16));
console.log('Player faction (rorT1): pos=0x'+rB.pos.toString(16)+', trailing starts at 0x'+rB.trailingStart.toString(16));

// Note: rome10 and rorT1 are the SAME campaign at different turns.
// Let me dump the first 400 bytes of trailing data in rome10's player record:
console.log('\nrome10 player trailing (first 400 bytes), nonzero u32:');
for(let off=0;off<400;off+=4){
  const v = A.readUInt32LE(rA.trailingStart + off);
  if(v !== 0) console.log('  +'+off.toString().padStart(3)+': '+v+' (0x'+v.toString(16)+')');
}
console.log('\nrorT1 player trailing (first 400 bytes), nonzero u32:');
for(let off=0;off<400;off+=4){
  const v = B.readUInt32LE(rB.trailingStart + off);
  if(v !== 0) console.log('  +'+off.toString().padStart(3)+': '+v+' (0x'+v.toString(16)+')');
}
