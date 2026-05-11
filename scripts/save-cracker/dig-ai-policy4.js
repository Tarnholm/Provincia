// dig-ai-policy4.js — diff Macedon trailing across T97 vs T98 End, look for 16-byte-stride AI policy array
const fs = require('fs');
const A = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_Autosave   Macedon   Turn 97.sav');
const B = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_Autosave   Macedon   Turn 98 End.sav');

// Macedon at idx 0
const posA = 0x63a38, regsA = 25;
const posB = 0x62660, regsB = 25;
const trailStartA = posA + 52 + 4*regsA;
const trailStartB = posB + 52 + 4*regsB;
// next record is at 0x8ec33 (A) / 0x8d919 (B)
const trailEndA = 0x8ec33;
const trailEndB = 0x8d919;
const trailLenA = trailEndA - trailStartA;
const trailLenB = trailEndB - trailStartB;
console.log('Macedon trailing A:', trailLenA, 'B:', trailLenB);

const len = Math.min(trailLenA, trailLenB);

// Now: look for a 23-element (or N-element) 16-byte-stride array where one column varies
// per-turn-end. Try a scan: for each candidate start, treat trail+off as [u32 a, u32 b, u32 c, u32 d] * N
// Are there N records?
console.log('\nScanning for 16-byte arrays where col 0 = small int (faction-id-like):');
const N_factions = 5; // Alexander has 5 majors
for(let off=0;off<5000;off+=4){
  // Try reading as N x 16-byte records with first col being a small int 0..30
  const ids = [];
  for(let k=0;k<N_factions;k++){
    const v = A.readUInt32LE(trailStartA+off+k*16);
    if(v > 30 || v < 0){ ids.length = 0; break; }
    ids.push(v);
  }
  if(ids.length === N_factions && new Set(ids).size === N_factions){
    let rec = [];
    for(let k=0;k<N_factions;k++){
      rec.push('['+A.readUInt32LE(trailStartA+off+k*16)+','+A.readUInt32LE(trailStartA+off+k*16+4)+','+A.readUInt32LE(trailStartA+off+k*16+8)+','+A.readUInt32LE(trailStartA+off+k*16+12)+']');
    }
    console.log('  off=+'+off+': '+rec.join(' '));
  }
}

// Find longest diff cluster (likely the AI policy cache that recomputes per turn)
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

console.log('\nTotal diff regions:', diffs.length);
diffs.sort((a,b)=>b.len-a.len);
console.log('TOP 15 longest diff runs in Macedon trailing:');
for(const d of diffs.slice(0,15)){
  console.log('  trail+'+d.s+'..'+d.e+' (len '+d.len+')');
}

// Look at the trail+~2000..3000 region (session 11's identified AI policy cluster)
// (per session 11 finding #5: "+2002..+3000: 619 diff runs in T97→T98 End diff, with values in {0..7} small-int range")
console.log('\nMacedon trailing +1800..+3200 — small-int patterns (A vs B):');
let runStart = -1;
let cluster = [];
for(let off=1800;off<3200;off++){
  const a = A[trailStartA+off], b = B[trailStartB+off];
  if(a !== b){
    cluster.push({off, a, b});
  }
}
console.log('  diff count in this region:', cluster.length);
console.log('  sample 30 diffs:');
for(const c of cluster.slice(0,30)){
  console.log('    trail+'+c.off+': A=0x'+c.a.toString(16)+' B=0x'+c.b.toString(16));
}

// Check stride pattern: are the diffs at +2000..+3000 actually a 16-byte-stride array?
// Compute mod 16
const offMod16 = new Map();
for(const c of cluster) offMod16.set(c.off%16, (offMod16.get(c.off%16)||0)+1);
console.log('\noff%16 distribution:');
for(const [k,v] of [...offMod16.entries()].sort((a,b)=>a[0]-b[0])) console.log('  +'+k+': '+v);

// And mod 4
const offMod4 = new Map();
for(const c of cluster) offMod4.set(c.off%4, (offMod4.get(c.off%4)||0)+1);
console.log('\noff%4:');
for(const [k,v] of [...offMod4.entries()].sort((a,b)=>a[0]-b[0])) console.log('  +'+k+': '+v);
