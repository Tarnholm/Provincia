// dig-econ-364run.js
// Investigate the stride-364 self-ptr runs at 0x158b5bc (len 22) and 0x1635b58
// (len 21) found earlier — these sit inside the faction-record region. 22 ~ player
// regionCount; could be per-region econ sub-records OR diplomacy. Dump first few.
const fs = require("fs");
const path = require("path");
const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const buf = fs.readFileSync(path.join(BASE, "save_arretium pre retrained..sav"));

for (const start of [0x158b5bc, 0x1635b58]) {
  console.log(`\n=== stride-364 run @0x${start.toString(16)} ===`);
  for (let k = 0; k < 4; k++) {
    const p = start + k * 364;
    const hdr = Array.from(buf.slice(p, p + 64)).map(b=>b.toString(16).padStart(2,"0")).join(" ");
    console.log(`  rec[${k}] @0x${p.toString(16)}: ${hdr}`);
    // as u32
    const u = []; for (let j=0;j<16;j++) u.push(buf.readInt32LE(p+j*4));
    console.log(`    i32[0..15]: ${u.join(" ")}`);
  }
}

// Also: what is the run length really? recompute
function runLen(start, stride) {
  let n=0; for(let k=0;;k++){const p=start+k*stride; if(p+4>buf.length)break; if(buf.readUInt32LE(p)!==p)break; n++;} return n;
}
console.log(`\nrun lengths: 0x158b5bc->${runLen(0x158b5bc,364)}  0x1635b58->${runLen(0x1635b58,364)}`);
