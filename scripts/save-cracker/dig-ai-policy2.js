// dig-ai-policy2.js — find the per-faction AI policy state by:
//   (1) finding all 16-byte-stride arrays inside player record trailing
//   (2) cross-checking with diff between T1 and T5 to find what changes
//   (3) check if a 23-element array (one per major faction) exists

const fs = require('fs');
const A = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav');
const B = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav');

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

const recsA = findMajorFactions(A);
const recsB = findMajorFactions(B);

// Player record (idx 0) — diff trailing bytes
const rA = recsA[0];
const rB = recsB[0];
const trailStartA = rA.pos + 52 + 4*rA.regions;
const trailStartB = rB.pos + 52 + 4*rB.regions;

// align by trailing offset (not file offset, since they shift)
const len = Math.min(recsA[1].pos - trailStartA, recsB[1].pos - trailStartB);
console.log('aligned trailing length:', len);

// Diff: find regions where bytes differ
const diffRegions = [];
let inDiff = false, runStart = 0;
for(let off=0;off<len;off++){
  if(A[trailStartA+off] !== B[trailStartB+off]){
    if(!inDiff){ inDiff = true; runStart = off; }
  } else {
    if(inDiff){
      diffRegions.push({start: runStart, end: off, len: off - runStart});
      inDiff = false;
    }
  }
}
if(inDiff) diffRegions.push({start: runStart, end: len, len: len - runStart});

console.log('diff regions:', diffRegions.length);
// only show meaningful diffs
for(const r of diffRegions.slice(0,40)){
  console.log('  diff at trail+'+r.start+'..'+r.end+' (len '+r.len+')');
}

// Now find 16-byte-stride arrays — look for "patterns of N elements of 16 bytes each"
// where the elements look like (u32 small, u32 small, u32 small, u32 small)
console.log('\n\nSearching for 16-byte-stride arrays in rome10 player trailing (first 5000 bytes):');
for(let off=0;off<5000;off+=4){
  // candidate array start
  // Heuristic: 23 records of 16 bytes each = 368 bytes, all with similar field patterns
  // Check first element looks plausible as a 4-u32 record
  const e0 = [
    A.readUInt32LE(trailStartA+off),
    A.readUInt32LE(trailStartA+off+4),
    A.readUInt32LE(trailStartA+off+8),
    A.readUInt32LE(trailStartA+off+12),
  ];
  // Check next 22 records have the same first-u32 (faction_id ordering) pattern
  let allValid = true;
  let allSimilar = true;
  let firstU32s = [];
  for(let k=0;k<23;k++){
    const e = A.readUInt32LE(trailStartA+off+k*16);
    if(e > 30 || e < 0){ allValid = false; break; }
    firstU32s.push(e);
  }
  if(allValid && new Set(firstU32s).size >= 5){
    // looks like a 23-element array with diverse first-u32
    let s = 'off=+'+off+': first u32s='+firstU32s.join(',');
    console.log('  '+s);
    // Print fully
    if(firstU32s.length === 23){
      let arr = [];
      for(let k=0;k<23;k++){
        const a = A.readUInt32LE(trailStartA+off+k*16);
        const b = A.readUInt32LE(trailStartA+off+k*16+4);
        const c = A.readUInt32LE(trailStartA+off+k*16+8);
        const d = A.readUInt32LE(trailStartA+off+k*16+12);
        arr.push(`(${a},${b},${c},${d})`);
      }
      console.log('    full: '+arr.join(' '));
    }
  }
}
