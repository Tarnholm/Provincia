// dig-tilemap8.js — cross-check: is this same array in two saves of same campaign? Diff identifies what changes.
// Use Rome10 (T5) vs Republic of Rome Turn 1 (T1)
const fs = require('fs');
const buf1 = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav');
const buf2 = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav');

// gap range — assume same as rome10 since file sizes are similar
const GAP_START_1 = 0x633bb3, GAP_END_1 = 0xf88637;
const GAP_START_2 = GAP_START_1, GAP_END_2 = GAP_END_1;
const STRIDE = 267;
const FIRST_REC_OFF = GAP_START_1 + 157;
const RECORD_BYTES = 97;

// Check the gap is in the same position in both files
console.log('rome10 byte at first-rec-off:', '0x'+buf1[FIRST_REC_OFF].toString(16));
console.log('RoR T1 byte at first-rec-off:', '0x'+buf2[FIRST_REC_OFF].toString(16));

// Count records with NON-default content (anything other than canonical 200/200/2/6/200 in fields +16..+32)
function isCanonical(buf, n){
  const base = FIRST_REC_OFF + n*STRIDE;
  return buf.readUInt32LE(base+16) === 200 &&
         buf.readUInt32LE(base+20) === 200 &&
         buf.readUInt32LE(base+24) === 2 &&
         buf.readUInt32LE(base+28) === 6 &&
         buf.readUInt32LE(base+32) === 200;
}

let nonCanon1 = [];
let nonCanon2 = [];
for(let n=0;n<36582;n++){
  if(!isCanonical(buf1,n)) nonCanon1.push(n);
  if(!isCanonical(buf2,n)) nonCanon2.push(n);
}
console.log('non-canonical records in rome10:', nonCanon1.length);
console.log('non-canonical records in RoR-T1:', nonCanon2.length);

// Records that DIFFER between rome10 and RoR-T1
let diffRecords = [];
for(let n=0;n<36582;n++){
  const base = FIRST_REC_OFF + n*STRIDE;
  for(let off=0;off<RECORD_BYTES;off++){
    if(buf1[base+off] !== buf2[base+off]){
      diffRecords.push(n);
      break;
    }
  }
}
console.log('records that differ between T1 and T5:', diffRecords.length);
console.log('first 20 differ:', diffRecords.slice(0,20));

// Cross-check: are nonCanon1 ⊂ diffRecords?
const inDiff = nonCanon1.filter(n => diffRecords.includes(n));
console.log('non-canonical-in-rome10 that ALSO differ:', inDiff.length, '/', nonCanon1.length);

// Also: do the canonical records' MEAN value of +28 stay always 6? Or does that vary by region?
// Sample +28 value at indices 0..200 + 36560..36580
console.log('\nField +28 sampling (canonical/non-canonical first hundred):');
for(let n=0;n<100;n++){
  const v28 = buf1.readUInt32LE(FIRST_REC_OFF + n*STRIDE + 28);
  if(v28 !== 6) console.log('  rec',n,'+28=',v28);
}

// Specifically test the "tile interpretation" — if record_idx maps to (x,y) via x = idx%W, y = idx/W
// what W would put Rome (idx=?) at coord (285, 404)?
// We don't know Rome's index in this array, but if first nonCanon record is at idx 14 (record 14),
// what would record 14 represent geographically?
// First few nonCanon records: 14, 101, 103, 208, 253, 259, 281, 341, 343, 389, 426, 447, 470, 492, 520, 579, 581, 621, 631, 731
// Let me look at deltas: 14, +87, +2, +105, +45, +6, +22, +60, +2, +46, +37, +21, +23, +22, +28, +59, +2, +40, +10, +100
// These don't look like a regular grid pattern.
