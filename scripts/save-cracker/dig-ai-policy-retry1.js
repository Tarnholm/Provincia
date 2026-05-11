// dig-ai-policy-retry1.js — session 18: AI policy retry via the within-turn-stable +
// across-turn-changing signature. WINNER: a per-turn AI event log at fixed offset
// 0x1024 in Alexander campaign saves, with 12-byte records (u32 hash, u32 key, u32
// turn) and ~445-477 records depending on save turn number.

const fs = require('fs');
const dir = 'C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z/';
const FILES = {
  t11s: '0161_save_Autosave   Macedon   Turn 11 Start.sav',
  t11e: '0169_save_Autosave   Macedon   Turn 11 End.sav',
  t12s: '0177_save_Autosave   Macedon   Turn 12 Start.sav',
  t13s: '0351_save_Autosave   Macedon   Turn 13 Start.sav',
  t13e: '0357_save_Autosave   Macedon   Turn 13 End.sav',
  t14e: '0369_save_Autosave   Macedon   Turn 14 End.sav',
  t15s: '0375_save_Autosave   Macedon   Turn 15 Start.sav',
  t15e: '0381_save_Autosave   Macedon   Turn 15 End.sav',
};
const bufs = {};
for(const [k,f] of Object.entries(FILES)) bufs[k] = fs.readFileSync(dir+f);

// AI policy cache starts at fixed offset 0x1024 (Alexander saves)
const START = 0x1024;
function walk(buf){
  const recs = [];
  for(let off=START; off<buf.length-12; off+=12){
    const c = buf.readUInt32LE(off+8);
    if(c >= 200 || c === 0) return recs;
    recs.push({a:buf.readUInt32LE(off), b:buf.readUInt32LE(off+4), c});
  }
  return recs;
}
const allRecs = {};
for(const [k, b] of Object.entries(bufs)) allRecs[k] = walk(b);
console.log('AI cache records per save:');
for(const [k, recs] of Object.entries(allRecs)){
  console.log('  '+k.padEnd(6)+recs.length.toString().padStart(8)+' records, endOff=0x'+(START + recs.length*12).toString(16));
}

// Diff intra-turn vs cross-turn
function diffRecs(r1, r2){
  let diffs = 0;
  const n = Math.min(r1.length, r2.length);
  for(let i=0;i<n;i++){
    if(r1[i].a!==r2[i].a || r1[i].b!==r2[i].b || r1[i].c!==r2[i].c) diffs++;
  }
  return diffs;
}
console.log('\nIntra-turn diffs (should be 0):');
console.log('  T11S → T11E:', diffRecs(allRecs.t11s, allRecs.t11e));
console.log('  T13S → T13E:', diffRecs(allRecs.t13s, allRecs.t13e));
console.log('  T15S → T15E:', diffRecs(allRecs.t15s, allRecs.t15e));
console.log('\nCross-turn diffs (>0):');
console.log('  T11E → T12S:', diffRecs(allRecs.t11e, allRecs.t12s));
console.log('  T13E → T14E:', diffRecs(allRecs.t13e, allRecs.t14e));
console.log('\nTurn-boundary preserve (T14E end = T15S start, should be 0):');
console.log('  T14E → T15S:', diffRecs(allRecs.t14e, allRecs.t15s));

// Dump first 10 records of T13E
console.log('\nFirst 10 records of T13E:');
for(let i=0;i<10;i++){
  const r = allRecs.t13e[i];
  console.log('  ['+i+'] hash=0x'+r.a.toString(16).padStart(8,'0')+' key=0x'+r.b.toString(16).padStart(8,'0')+' turn='+r.c);
}
console.log('\nLast 5 records of T13E:');
for(let i=allRecs.t13e.length-5;i<allRecs.t13e.length;i++){
  const r = allRecs.t13e[i];
  console.log('  ['+i+'] hash=0x'+r.a.toString(16).padStart(8,'0')+' key=0x'+r.b.toString(16).padStart(8,'0')+' turn='+r.c);
}

// Distinct hash count
const distinctHashes = new Set();
for(const r of allRecs.t13e) if(r.a !== 0) distinctHashes.add(r.a);
console.log('\nDistinct non-zero hash values in T13E:', distinctHashes.size);
