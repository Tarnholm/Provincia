// dig-diplovalid2.js — additional pass:
//  - Count ALL non-default cells in the 239x239 matrix
//  - Bucket by (prev,curr,+8) and by (+20,+32)
//  - Check whether declared "ally" pairs (faction_relationships<=199) ever produce
//    active (0,1) at turn 1
//  - Identify which faction is the player (look for save-marker)

const fs = require('fs');

const SAVE_PATH = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const STRIDE = 267;
const N = 239;
const MAT_START = 0xf8fd2;

const buf = fs.readFileSync(SAVE_PATH);

const stateCount = new Map();
const u20u32Count = new Map();
let activeCells = 0;
let rejectCells = 0;
let negU8 = 0;

for (let r = 0; r < N; r++) {
  for (let c = 0; c < N; c++) {
    const o = MAT_START + (r*N + c)*STRIDE;
    const prev = buf.readInt32LE(o);
    const curr = buf.readInt32LE(o+4);
    const u8   = buf.readInt32LE(o+8);
    const u20  = buf.readInt32LE(o+20);
    const u32v = buf.readInt32LE(o+32);
    const k = `prev=${prev},curr=${curr}`;
    stateCount.set(k, (stateCount.get(k)||0)+1);
    const kk = `+20=${u20},+32=${u32v}`;
    u20u32Count.set(kk, (u20u32Count.get(kk)||0)+1);
    if (prev===0 && curr===1) activeCells++;
    if (prev===0 && curr===-1) rejectCells++;
    if (u8 < 0) negU8++;
  }
}

console.log('=== Whole-matrix state counts (prev,curr) ===');
for (const [k,v] of [...stateCount.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15)) {
  console.log(`  ${k}: ${v}`);
}
console.log('=== Whole-matrix (+20,+32) top buckets ===');
for (const [k,v] of [...u20u32Count.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15)) {
  console.log(`  ${k}: ${v}`);
}
console.log(`\nactive(0,1) cells: ${activeCells}`);
console.log(`reject(0,-1) cells: ${rejectCells}`);
console.log(`+8 negative cells: ${negU8}`);

// Total cells
const total = N*N;
console.log(`\nTotal cells: ${total}`);
console.log(`Default cells: ${stateCount.get('prev=5,curr=0')||0}  (= ${((stateCount.get('prev=5,curr=0')||0)/total*100).toFixed(2)}%)`);

// Sample non-default cells
console.log('\n=== Sample non-default cells ===');
let shown = 0;
for (let r = 0; r < N && shown < 12; r++) {
  for (let c = 0; c < N && shown < 12; c++) {
    const o = MAT_START + (r*N + c)*STRIDE;
    const prev = buf.readInt32LE(o);
    const curr = buf.readInt32LE(o+4);
    if (prev===5 && curr===0) continue;
    console.log(`  [${r}][${c}]: prev=${prev} curr=${curr} +8=${buf.readInt32LE(o+8)} +20=${buf.readInt32LE(o+20)} +28=${buf.readInt32LE(o+28)} +32=${buf.readInt32LE(o+32)}`);
    shown++;
  }
}
