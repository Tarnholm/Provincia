// dig-midfile-recount1.js — session 18: rederive the mid-file fixed-stride record array
// SESSION 15 reported 36,582 records from 0x633c50. Re-scanning with a strict signature
// (full 267-byte template match: u32 +0=5, +12=10, +24=2, +84=576, +96=0xa6, all other
// bytes zero) finds the array spans MUCH further: 57,013-57,120 strict canonical records
// from 0x0fff6b/0xf8fd2 to 0xf84632. Session 15's count was severely undercounted by
// detecting only a smaller subrange.

const fs = require('fs');
const path = require('path');
const STRIDE = 267;

// Strict canonical: every byte equals expected canonical value
const PREFIX = Buffer.from([0x05,0,0,0, 0,0,0,0, 0,0,0,0, 0x0a,0,0,0]);
function strictRec(buf, off){
  if(off<0||off+STRIDE>buf.length) return false;
  for(let i=0;i<16;i++) if(buf[off+i]!==PREFIX[i]) return false;
  if(buf.readUInt32LE(off+24)!==2) return false;
  if(buf.readUInt32LE(off+84)!==576) return false;
  if(buf[off+96]!==0xa6) return false;
  for(let i=97;i<STRIDE;i++) if(buf[off+i]!==0) return false;
  return true;
}

const FILES = [
  ['rome10', 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav'],
  ['rome_t1', 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav'],
];
for(const [name, p] of FILES){
  const buf = fs.readFileSync(p);
  // find first 4-in-a-row
  let firstRun = -1;
  for(let off=0; off<buf.length-STRIDE*4; off++){
    if(strictRec(buf, off) && strictRec(buf, off+STRIDE) && strictRec(buf, off+2*STRIDE) && strictRec(buf, off+3*STRIDE)){
      firstRun = off; break;
    }
  }
  // walk back
  let earliest = firstRun;
  while(earliest>=0 && strictRec(buf, earliest-STRIDE)) earliest -= STRIDE;
  // walk forward
  let cnt = 0; let o = earliest;
  while(o+STRIDE <= buf.length && strictRec(buf, o)){ cnt++; o += STRIDE; }
  console.log(name+': file size='+buf.length+', start=0x'+earliest.toString(16)+', count='+cnt+', endat=0x'+o.toString(16));
}
