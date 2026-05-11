// dig-army-manifest1.js — session 18: per-faction army manifest stretch.
// NEGATIVE result. The AI cache at 0x1024..0x25fc contains 12-byte records with
// (hash, key, turn). 45 distinct non-zero hash values exist. Hypothesis: these are
// per-character/per-agent UUIDs the AI tracks. Confirmation: nearly all hashes occur
// ONLY inside the AI cache region, NOT elsewhere in the save body. So the hashes are
// AI-cache-local identifiers, NOT character UUIDs referenced by the faction's army
// roster. The army manifest is not directly accessible from the AI cache.

const fs = require('fs');
const buf = fs.readFileSync('C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z/0357_save_Autosave   Macedon   Turn 13 End.sav');

const START = 0x1024;
const N_RECS = 466;
const uniqueHashes = new Set();
for(let i=0;i<N_RECS;i++){
  const off = START + i*12;
  const h = buf.readUInt32LE(off);
  if(h !== 0) uniqueHashes.add(h);
}
console.log('Unique non-zero hashes:', uniqueHashes.size);

// For each hash, scan body and count occurrences across the file (excluding AI cache range)
const AI_RANGE = [START, START + N_RECS*12];
const occurrences = {};
for(const h of uniqueHashes){
  occurrences[h] = {inCache: 0, outsideCache: []};
  for(let off=0; off<buf.length-4; off+=4){
    if(buf.readUInt32LE(off) === h){
      if(off >= AI_RANGE[0] && off < AI_RANGE[1]) occurrences[h].inCache++;
      else occurrences[h].outsideCache.push(off);
    }
  }
}
const sorted = Array.from(uniqueHashes).sort((a,b)=>occurrences[b].inCache + occurrences[b].outsideCache.length - occurrences[a].inCache - occurrences[a].outsideCache.length);
console.log('Top 15 hashes by total occurrences:');
console.log('  hash         inCache  outsideCache    outsideRanges');
for(const h of sorted.slice(0,15)){
  const oc = occurrences[h];
  const ranges = oc.outsideCache.slice(0,5).map(x=>'0x'+x.toString(16)).join(',');
  console.log('  0x'+h.toString(16).padStart(8,'0')+' '+oc.inCache.toString().padStart(8)+' '+oc.outsideCache.length.toString().padStart(8)+'        '+ranges);
}

// Conclusion: hashes are AI-cache-local.
// Per-faction army manifest still requires either:
//  (1) decoding the major-faction record's trailing data (sessions 9, 15, 17 all attempted)
//  (2) finding a global "armies by region" table (not yet found)
