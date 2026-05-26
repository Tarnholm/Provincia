// dig-tail-endrecords1.js — decode the final self-pointer record array at EOF
// and characterise the last bytes (footer/checksum?).
"use strict";
const fs = require("fs");
const SAVE = process.argv[2] ||
  "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";
const buf = fs.readFileSync(SAVE);
const N = buf.length;

// Find the first self-pointer in the EOF record array (scan from 0x20d0000)
function hex(s, e) { return [...buf.slice(s, e)].map(x => x.toString(16).padStart(2, "0")).join(" "); }

console.log(`size=${N} (0x${N.toString(16)})`);

// Find all self-pointers in last 0.5MB and report stride distribution
const SCAN = Math.max(0, N - 0x80000);
const ptrs = [];
for (let i = SCAN; i + 4 <= N; i += 4) {
  if (buf.readUInt32LE(i) === i) ptrs.push(i);
}
console.log(`\nself-pointers in last 0x80000: ${ptrs.length}`);
if (ptrs.length) {
  console.log(`first=0x${ptrs[0].toString(16)} last=0x${ptrs[ptrs.length-1].toString(16)}`);
  // strides
  const strides = new Map();
  for (let i = 1; i < ptrs.length; i++) {
    const d = ptrs[i] - ptrs[i-1];
    strides.set(d, (strides.get(d)||0)+1);
  }
  console.log("stride histogram (top 10):");
  [...strides.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10)
    .forEach(([d,c]) => console.log(`  stride ${d} (0x${d.toString(16)})  x${c}`));
}

// Dump first 3 records of the EOF array
if (ptrs.length >= 4) {
  const start = ptrs[0];
  console.log(`\n=== first records around 0x${start.toString(16)} ===`);
  for (let r = 0; r < 6 && start + r*0 < N; r++) {
    const p = ptrs[r];
    if (!p) break;
    console.log(`  rec[${r}] @0x${p.toString(16)}: ${hex(p, Math.min(N, p+48))}`);
  }
}

// Last 128 bytes
console.log(`\n=== last 128 bytes (0x${(N-128).toString(16)}..EOF) ===`);
for (let row = N - 128; row < N; row += 16) {
  const e = Math.min(N, row + 16);
  let asc = "";
  for (let i = row; i < e; i++) { const v = buf[i]; asc += (v>=0x20&&v<0x7f)?String.fromCharCode(v):"."; }
  console.log(`  0x${row.toString(16)}  ${hex(row, e).padEnd(48)}  ${asc}`);
}

// Look at the lua-footer marker zone (0x20e6e8e per memory) for ASCIIZ counter names
console.log(`\n=== ASCIIZ-ish strings near EOF (last 0x30000) ===`);
let cur=-1, shown=0;
for (let i=N-0x30000;i<=N;i++){
  const v=i<N?buf[i]:0; const p=v>=0x20&&v<0x7f;
  if(p&&cur<0)cur=i; else if(!p&&cur>=0){ if(i-cur>=5){console.log(`  0x${cur.toString(16)} "${buf.slice(cur,i).toString("ascii")}"`); if(++shown>=40)break;} cur=-1; }
}
