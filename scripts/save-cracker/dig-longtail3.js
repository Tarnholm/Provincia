// dig-longtail3.js — why are 5-9 KB unknowns still showing after section 9b?
// Inspect those offsets.

const fs = require("fs");
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const buf = fs.readFileSync(SAVE);
const offs = [0x154aa4d, 0x16cd599, 0xf84632, 0x1a31ba5, 0x1978d12];
for (const o of offs) {
  const head = [...buf.subarray(o, o + 32)].map(x => x.toString(16).padStart(2,"0")).join(" ");
  // Look 64 B before
  const before = [...buf.subarray(Math.max(0,o-64), o)].map(x => x.toString(16).padStart(2,"0")).join(" ");
  console.log(`\n0x${o.toString(16)}:`);
  console.log(`  before-64: ${before}`);
  console.log(`  head-32  : ${head}`);
}
