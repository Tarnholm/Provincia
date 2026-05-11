// dig-ai-policy5.js — focus on the 145-byte diff run at trail+173956
// Also look for 16-byte stride patterns inside the trailing data
const fs = require('fs');
const A = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_Autosave   Macedon   Turn 97.sav');
const B = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_Autosave   Macedon   Turn 98 End.sav');
const posA = 0x63a38, regsA = 25;
const posB = 0x62660, regsB = 25;
const trailStartA = posA + 52 + 4*regsA;
const trailStartB = posB + 52 + 4*regsB;

// 145-byte diff run at trail+173956 — DUMP both buffers there
console.log('Diff cluster at trail+173956..174101 (145 bytes):');
for(let off=173950;off<174110;off+=16){
  let lineA = 'A '+(off).toString().padStart(6)+': ';
  let lineB = 'B '+(off).toString().padStart(6)+': ';
  for(let i=0;i<16;i++){
    lineA += A[trailStartA+off+i].toString(16).padStart(2,'0')+' ';
    lineB += B[trailStartB+off+i].toString(16).padStart(2,'0')+' ';
  }
  console.log(lineA);
  console.log(lineB);
  console.log();
}

// Look at the +3901..+4010 diff (109 bytes):
console.log('\nDiff cluster at trail+3901..+4010 (109 bytes):');
for(let off=3896;off<4020;off+=16){
  let lineA = 'A +'+(off).toString().padStart(5)+': ';
  let lineB = 'B +'+(off).toString().padStart(5)+': ';
  for(let i=0;i<16;i++){
    lineA += A[trailStartA+off+i].toString(16).padStart(2,'0')+' ';
    lineB += B[trailStartB+off+i].toString(16).padStart(2,'0')+' ';
  }
  console.log(lineA);
  console.log(lineB);
}

// CRITICAL: look at small-int diffs in 0..8 range (Session 7 "AI policy cache" had values 0..7)
// Filter to bytes where A and B are both in {0..7}
console.log('\nSmall-int (both A,B in 0..7) diff bytes across entire trailing:');
const small = [];
const len = Math.min(A.length - trailStartA, B.length - trailStartB);
for(let off=0;off<len;off++){
  const a = A[trailStartA+off], b = B[trailStartB+off];
  if(a <= 7 && b <= 7 && a !== b) small.push({off, a, b});
}
console.log('total small-int changes:', small.length);
// Are they clustered?
console.log('first 30 with deltas:');
for(let i=0;i<Math.min(30, small.length);i++){
  const c = small[i];
  const d = i>0 ? c.off - small[i-1].off : 0;
  console.log('  trail+'+c.off+' (delta='+d+') A='+c.a+' B='+c.b);
}

// Find clusters of >=10 small-int changes in <100 byte window
const windowsBySize = [];
for(let i=0;i<small.length;i++){
  let j = i;
  while(j < small.length && small[j].off - small[i].off < 100) j++;
  windowsBySize.push({i, j, count: j-i, start: small[i].off, end: small[j-1]?.off});
}
windowsBySize.sort((a,b)=>b.count-a.count);
console.log('\ntop 10 small-int dense windows (size of cluster):');
for(const w of windowsBySize.slice(0,10)){
  console.log('  trail+'+w.start+'..'+w.end+': '+w.count+' small-int changes');
}
