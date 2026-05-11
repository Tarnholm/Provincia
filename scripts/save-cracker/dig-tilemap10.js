// dig-tilemap10.js — find exact grid width by looking at row-edge variant patterns
// The "200_200_2_6_0" and "200_600_2_6_600" variants seem to indicate row edges (left or right column)
// Find consistent stride of edge variants
const fs = require('fs');
const buf = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav');
const GAP_START = 0x633bb3;
const STRIDE = 267;
const FIRST_REC_OFF = GAP_START + 157;

// For each grid-width candidate W, check: do non-canonical records cluster at column positions consistent
// with row edges? E.g. if W=240, then non-canonical records' (idx mod W) should cluster on specific columns.
function isCanonical(n){
  const base = FIRST_REC_OFF + n*STRIDE;
  return buf.readUInt32LE(base+16) === 200 &&
         buf.readUInt32LE(base+20) === 200 &&
         buf.readUInt32LE(base+24) === 2 &&
         buf.readUInt32LE(base+28) === 6 &&
         buf.readUInt32LE(base+32) === 200;
}
function getKey(n){
  const base = FIRST_REC_OFF + n*STRIDE;
  return `${buf.readUInt32LE(base+16)}_${buf.readUInt32LE(base+20)}_${buf.readUInt32LE(base+24)}_${buf.readUInt32LE(base+28)}_${buf.readUInt32LE(base+32)}`;
}

const nonCanon = [];
for(let n=0;n<36582;n++){
  if(!isCanonical(n)) nonCanon.push(n);
}
console.log('total non-canonical:', nonCanon.length);

// Test grid widths from 100..300 - check how concentrated columns are
console.log('\nGrid width discovery (entropy method):');
const widths = [];
for(let W=100;W<=320;W++){
  // count non-canonical records per column
  const colCount = new Array(W).fill(0);
  for(const n of nonCanon) colCount[n%W]++;
  const occupied = colCount.filter(c=>c>0).length;
  // Score: fewer occupied columns = stronger row pattern
  widths.push({W, occupied, max: Math.max(...colCount)});
}
widths.sort((a,b)=>a.occupied - b.occupied);
console.log('top 15 widths (fewest occupied columns):');
for(const w of widths.slice(0,15)) console.log('  W='+w.W+'  occupied='+w.occupied+'  maxColCount='+w.max);

// Now do the same for SPECIFIC variant only (200_600_2_6_600)
console.log('\n200_600_2_6_600 variant column analysis:');
const variantHigh = [];
for(let n=0;n<36582;n++) if(getKey(n)==='200_600_2_6_600') variantHigh.push(n);
const widthsH = [];
for(let W=100;W<=320;W++){
  const colSet = new Set();
  for(const n of variantHigh) colSet.add(n%W);
  widthsH.push({W, occupied: colSet.size});
}
widthsH.sort((a,b)=>a.occupied - b.occupied);
for(const w of widthsH.slice(0,10)) console.log('  W='+w.W+'  uniqueCols='+w.occupied);

// 240 deltas in 200_0_2_54_200 suggests W=240. Check column distribution at W=240:
console.log('\nNonCanon records at W=240 — column distribution:');
const W = 240;
const colDist = new Array(W).fill(0);
for(const n of nonCanon) colDist[n%W]++;
for(let c=0;c<W;c++){
  if(colDist[c]>0){
    console.log('  col '+c+': '+colDist[c]+' records');
  }
}

// Also test: 36582 / 240 = 152.425; 36582 / 239 = 153.06; 36582 / 241 = 151.79
console.log('\n36582 / various widths:');
for(const W2 of [200,224,225,238,239,240,241,242,255,256]){
  console.log('  /'+W2+' = '+ (36582/W2).toFixed(2));
}
// In a perfect grid 36582 = W*H. Factors: 2*3*7*13*67. So (W,H) options: 1x36582, 2x18291, 3x12194, 6x6097, 7x5226, 13x2814, 14x2613, 21x1742, 26x1407, 39x938, 42x871, 67x546, 78x469, 91x402, 134x273, 182x201, 201x182, 273x134, ...
// 201x182 is interesting! 201*182=36582. And 182*201=36582.
// 201 ~ matches 200 (regions) + 1.
// 182 — what could this be?
console.log('201*182 =', 201*182);
console.log('273*134 =', 273*134);
console.log('134*273 =', 134*273);
// 273 close to 270 — map height candidate
// 134 — map width candidate? Half of 270?
