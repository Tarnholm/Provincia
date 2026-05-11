// dig-ai-policy3.js — Alexander/Macedon Turn 97 vs Turn 98 End — find AI policy cache that ticks per turn
const fs = require('fs');
const A = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_Autosave   Macedon   Turn 97.sav');
const B = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_Autosave   Macedon   Turn 98 End.sav');

console.log('A size:', A.length, 'B size:', B.length);

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
function findMinorFactions(buf){
  const recs = [];
  for(let i=0;i+200<buf.length;i++){
    if(buf.readUInt32LE(i+8) !== 100) continue;
    if(buf.readUInt32LE(i+12) !== 1) continue;
    if(buf.readUInt32LE(i+24) !== i+24) continue;
    if(buf.readUInt32LE(i+40) !== i+40) continue;
    if(buf.readUInt32LE(i+44) !== 8) continue;
    const regions = buf.readUInt32LE(i+48);
    if(regions > 200 || regions < 0) continue;
    recs.push({pos: i, regions, treasury: buf.readInt32LE(i)});
  }
  return recs;
}

const recsA = findMajorFactions(A);
const recsB = findMajorFactions(B);
console.log('majors A:', recsA.length, 'majors B:', recsB.length);
for(const r of recsA) console.log('  A: pos=0x'+r.pos.toString(16)+' treas='+r.treasury+' regions='+r.regions);
console.log();
for(const r of recsB) console.log('  B: pos=0x'+r.pos.toString(16)+' treas='+r.treasury+' regions='+r.regions);

const minorsA = findMinorFactions(A);
const minorsB = findMinorFactions(B);
console.log('\nminors A:', minorsA.length, 'minors B:', minorsB.length);
for(const r of minorsA) console.log('  A min: pos=0x'+r.pos.toString(16)+' treas='+r.treasury+' regions='+r.regions);
console.log();
for(const r of minorsB) console.log('  B min: pos=0x'+r.pos.toString(16)+' treas='+r.treasury+' regions='+r.regions);

// The Macedon record at idx 0 — diff trailing
if(minorsA.length>0 && minorsB.length>0){
  const rA = minorsA[0], rB = minorsB[0];
  const trailStartA = rA.pos + 52 + 4*rA.regions;
  const trailStartB = rB.pos + 52 + 4*rB.regions;

  // Find next record (could be a minor or major)
  // Calculate next-record-pos as the smallest pos > rA.pos
  const nextA = [...minorsA.slice(1).map(r=>r.pos), ...recsA.map(r=>r.pos)].filter(p=>p>rA.pos).sort((a,b)=>a-b)[0] || A.length;
  const nextB = [...minorsB.slice(1).map(r=>r.pos), ...recsB.map(r=>r.pos)].filter(p=>p>rB.pos).sort((a,b)=>a-b)[0] || B.length;
  const trailLenA = nextA - trailStartA;
  const trailLenB = nextB - trailStartB;
  console.log('\nMacedon minor (idx 0) trail size A:', trailLenA, 'B:', trailLenB);

  // diff
  const len = Math.min(trailLenA, trailLenB);
  const diffs = [];
  let inD = false, runS = 0;
  for(let off=0;off<len;off++){
    if(A[trailStartA+off] !== B[trailStartB+off]){
      if(!inD){ inD=true; runS=off; }
    } else {
      if(inD){ diffs.push({s:runS, e:off, len: off-runS}); inD=false; }
    }
  }
  if(inD) diffs.push({s:runS, e:len, len: len-runS});

  console.log('total diff regions:', diffs.length);
  // sum diff length
  const totDiff = diffs.reduce((a,b)=>a+b.len,0);
  console.log('total diff bytes:', totDiff);

  // Look at the largest contiguous diffs
  diffs.sort((a,b)=>b.len-a.len);
  console.log('\nTOP 20 longest diff runs:');
  for(const d of diffs.slice(0,20)){
    console.log('  trail+'+d.s+'..'+d.e+' (len '+d.len+')');
    // sample bytes
    let aHex='',bHex='';
    for(let i=0;i<Math.min(d.len,16);i++){
      aHex += A[trailStartA+d.s+i].toString(16).padStart(2,'0')+' ';
      bHex += B[trailStartB+d.s+i].toString(16).padStart(2,'0')+' ';
    }
    console.log('    A: '+aHex);
    console.log('    B: '+bHex);
  }

  // Compute small-int diff cluster: where bytes are small ints (0..10) and they differ by small amounts
  console.log('\nSmall-int byte changes (both bytes in 0..15 and differ by 1):');
  let smallChanges = 0;
  let clusters = [];
  let curStart = -1;
  for(let off=0;off<len;off++){
    const a = A[trailStartA+off], b = B[trailStartB+off];
    if(a < 16 && b < 16 && a !== b){
      smallChanges++;
      if(curStart<0) curStart = off;
    } else {
      if(curStart>=0){ clusters.push({s:curStart, e:off}); curStart=-1; }
    }
  }
  if(curStart>=0) clusters.push({s:curStart, e:len});
  console.log('  small changes total:', smallChanges, 'in', clusters.length, 'clusters');
  console.log('  largest clusters:');
  clusters.sort((a,b)=>(b.e-b.s)-(a.e-a.s));
  for(const c of clusters.slice(0,5)) console.log('    trail+'+c.s+'..'+c.e+' (len '+(c.e-c.s)+')');
}
