// dig-tilemap7.js — find the ONE outlier record and identify it
const fs = require('fs');
const path = process.argv[2] || 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(path);
const GAP_START = 0x633bb3, GAP_END = 0xf88637;
const STRIDE = 267;
const FIRST_REC_OFF = GAP_START + 157;
const RECORD_BYTES = 97;

// Find record with +52 == 285 (Rome X coordinate)
for(let n=0;n<37000;n++){
  const base = FIRST_REC_OFF + n*STRIDE;
  const v52 = buf.readUInt32LE(base+52);
  if(v52 === 285){
    console.log('record',n,'at 0x'+base.toString(16),': +52=285, +56=', buf.readUInt32LE(base+56));
    // Dump full record
    for(let off=0;off<RECORD_BYTES;off++){
      const b = buf[base+off];
      if(b !== 0) console.log('  +'+off+': 0x'+b.toString(16));
    }
    // Read as u32
    console.log('  u32 fields:');
    for(let off=0;off<RECORD_BYTES-4;off+=4){
      const v = buf.readUInt32LE(base+off);
      if(v !== 0) console.log('    u32+'+String(off).padStart(2)+': '+v+' (0x'+v.toString(16)+')');
    }
    break;
  }
}

// Also: find records with very unusual +52 values
console.log('\nrecords with +52 != 0:');
let count = 0;
for(let n=0;n<37000 && count < 30;n++){
  const base = FIRST_REC_OFF + n*STRIDE;
  const v52 = buf.readUInt32LE(base+52);
  if(v52 !== 0){
    const v56 = buf.readUInt32LE(base+56);
    console.log('  rec',n,'+52=',v52,'+56=',v56);
    count++;
  }
}

// Also find +28 == 54 outliers (250 of them) — what's special about them?
console.log('\nrecords with +28 == 54 (first 10):');
count = 0;
for(let n=0;n<37000 && count<10;n++){
  const base = FIRST_REC_OFF + n*STRIDE;
  const v28 = buf.readUInt32LE(base+28);
  if(v28 === 54){
    console.log('  rec',n,'at 0x'+base.toString(16));
    for(let off=0;off<RECORD_BYTES;off+=4){
      const v = buf.readUInt32LE(base+off);
      if(v !== 0) console.log('    +'+off+': '+v);
    }
    count++;
  }
}

// What's at the "header" — bytes 0..156 of the gap (the prefix before record 0)?
console.log('\nGap prefix (first 157 bytes):');
for(let i=0;i<157;i++){
  const b = buf[GAP_START+i];
  if(b !== 0) console.log('  gap+'+i+': 0x'+b.toString(16));
}
// And the trailer
console.log('\nGap trailer (last 200 bytes):');
const TRAILER_START = FIRST_REC_OFF + 36583*STRIDE;
console.log('  trailer starts at 0x'+TRAILER_START.toString(16));
console.log('  trailer length:',GAP_END-TRAILER_START);
for(let i=TRAILER_START;i<GAP_END;i++){
  const b = buf[i];
  if(b !== 0) console.log('  gap+'+(i-GAP_START)+' (=trailer+'+(i-TRAILER_START)+'): 0x'+b.toString(16));
}
