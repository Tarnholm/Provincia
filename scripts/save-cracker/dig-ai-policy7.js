// dig-ai-policy7.js — examine the per-record structures in Macedon's trailing
// Records end at trail+258, +717, +1200... separated by ~400-500 bytes
// What's in each record?

const fs = require('fs');
const A = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_Autosave   Macedon   Turn 97.sav');
const posA = 0x63a38, regsA = 25;
const trailStartA = posA + 52 + 4*regsA;

// Find all 0xff sentinels
const sentinels = [];
for(let off=0;off<176483-8;off++){
  if(A.readUInt32LE(trailStartA+off) === 0xffffffff && A.readUInt32LE(trailStartA+off+4) === 0xffffffff){
    sentinels.push(off);
  }
}

// Take records 0..5 (between sentinels)
// Record 0 = trail[0..258 + 8]; Record 1 = trail[258+8..717+8]; etc.
function dump(start, len){
  console.log('record bytes (first 80):');
  let hex = '', txt = '';
  for(let i=0;i<Math.min(len,80);i++){
    const b = A[trailStartA+start+i];
    hex += b.toString(16).padStart(2,'0')+' ';
    txt += (b>=32 && b<127) ? String.fromCharCode(b) : '.';
  }
  console.log('  '+hex);
  console.log('  '+txt);
  // u32 fields
  console.log('  u32 fields (nonzero):');
  for(let i=0;i<len-4;i+=4){
    const v = A.readUInt32LE(trailStartA+start+i);
    if(v !== 0 && v !== 0xffffffff) console.log('    +'+i+': '+v+' (0x'+v.toString(16)+')');
  }
}

let prev = 0;
for(let k=0;k<6;k++){
  const cur = sentinels[k] + 8;  // include sentinel
  const recStart = prev;
  const recLen = cur - prev;
  console.log('\nRecord '+k+': trail['+recStart+'..'+cur+'] (size '+recLen+')');
  dump(recStart, recLen);
  prev = cur;
}

// Maybe these records are NOT characters but per-faction (5 majors)?
// Sentinels are at +258, +717, +1200, +1703, +2198, +2643 = 6 records before delta jumps
// 6 records of ~450 bytes? Maybe one per major + 1 minor = 6 (but I found 0 minors).
// Or 6 records of "per-faction relationship info" — one for each of Macedon's foes.

// Actually let's check: 0xff sentinels in player trailing aren't per-faction
// Let's just look at the FIRST record carefully
console.log('\n\n=== FIRST RECORD DEEP DIVE ===');
console.log('Bytes 0..258 (record 1):');
for(let i=0;i<266;i+=16){
  let h = (i.toString().padStart(4)) + '  ';
  let t = '  ';
  for(let j=0;j<16;j++){
    const b = A[trailStartA+i+j];
    h += b.toString(16).padStart(2,'0')+' ';
    t += (b>=32 && b<127) ? String.fromCharCode(b) : '.';
  }
  console.log(h+' '+t);
}
