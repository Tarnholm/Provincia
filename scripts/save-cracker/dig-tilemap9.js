// dig-tilemap9.js — what's special about the records with non-canonical content?
// Hypothesis tests:
//   H1: each non-canonical record is a settlement location
//   H2: each is a trade-good resource
//   H3: each is a watchtower or other agent-placed entity
//   H4: each is a port location
//   H5: this is per-region data and non-canonical indicates "has settlement built"

const fs = require('fs');
const buf = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav');
const GAP_START = 0x633bb3;
const STRIDE = 267;
const FIRST_REC_OFF = GAP_START + 157;
const RECORD_BYTES = 97;

// classify records by variant pattern
const variants = new Map();
for(let n=0;n<36582;n++){
  const base = FIRST_REC_OFF + n*STRIDE;
  const a = buf.readUInt32LE(base+16);
  const b = buf.readUInt32LE(base+20);
  const c = buf.readUInt32LE(base+24);
  const d = buf.readUInt32LE(base+28);
  const e = buf.readUInt32LE(base+32);
  const key = `${a}_${b}_${c}_${d}_${e}`;
  if(!variants.has(key)) variants.set(key, []);
  variants.get(key).push(n);
}
console.log('distinct variant patterns:', variants.size);
const sorted = [...variants.entries()].sort((a,b)=>b[1].length - a[1].length);
for(const [k,arr] of sorted.slice(0,15)){
  console.log('  '+k+' count='+arr.length+' first idxs:', arr.slice(0,5));
}

// For the 200_0_2_54_200 variant (which is rec 101, 341, 581 etc.), check spacing
const variant200_0_2_54_200 = variants.get('200_0_2_54_200') || [];
console.log('\n200_0_2_54_200 variant total:', variant200_0_2_54_200.length);
console.log('first 30 indices:', variant200_0_2_54_200.slice(0,30));
const deltas = [];
for(let i=1;i<Math.min(variant200_0_2_54_200.length,30);i++){
  deltas.push(variant200_0_2_54_200[i] - variant200_0_2_54_200[i-1]);
}
console.log('deltas:', deltas);
// Check if same delta repeats → 1D grid
const deltaHist = new Map();
for(let i=1;i<variant200_0_2_54_200.length;i++){
  const d = variant200_0_2_54_200[i] - variant200_0_2_54_200[i-1];
  deltaHist.set(d, (deltaHist.get(d) || 0) + 1);
}
const topDeltas = [...deltaHist.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
console.log('top 10 deltas:', topDeltas);

// Test: is this 'rows'? If the array is row-major and one full row has X records, then 'row breaks' should
// show clearly. Let's check the variant 200_200_2_6_0 (= last field flipped 200->0) — could be 'right-edge'
const variantREdge = variants.get('200_200_2_6_0') || [];
console.log('\n200_200_2_6_0 variant total:', variantREdge.length, 'first 30:', variantREdge.slice(0,30));
const eDeltas = [];
for(let i=1;i<Math.min(variantREdge.length,30);i++) eDeltas.push(variantREdge[i] - variantREdge[i-1]);
console.log('its deltas:', eDeltas);

// And 200_600_2_6_600 (= both edges 600)
const variantHigh = variants.get('200_600_2_6_600') || [];
console.log('\n200_600_2_6_600 variant total:', variantHigh.length, 'first 30:', variantHigh.slice(0,30));
const hDeltas = [];
for(let i=1;i<Math.min(variantHigh.length,30);i++) hDeltas.push(variantHigh[i] - variantHigh[i-1]);
console.log('its deltas:', hDeltas);

// Hypothesis: this is the array of REGION RESOURCES (terrain features = land tiles per region).
// In RTW, descr_strat lists 'resources X Y' for many resources placed on the world map.
// Let me also look at the bytes that ARE non-zero in non-canonical records to see if there's more
// hidden info.
console.log('\nNon-canonical record content (first 6 200_0_2_54_200 variants):');
for(const n of variant200_0_2_54_200.slice(0,6)){
  const base = FIRST_REC_OFF + n*STRIDE;
  console.log('  rec '+n+' nonzero bytes:');
  for(let o=0;o<RECORD_BYTES;o++){
    if(buf[base+o]!==0) process.stdout.write(' +'+o+'=0x'+buf[base+o].toString(16));
  }
  console.log();
}
