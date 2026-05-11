// dig-diplomacy25.js — Drill into calm bands to inspect each diff.

import fs from "node:fs";

const SAVE_A = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.sav";
const SAVE_B = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_3.sav";

const bA = fs.readFileSync(SAVE_A);
const bB = fs.readFileSync(SAVE_B);

const bands = [
  [0x2c2a, 0x4506],
  [0xf8365e, 0xf847e4],
  [0x14e10b8, 0x14e5b43],
  [0x14f2073, 0x14f308c],
  [0x150041b, 0x150142c],
  [0x83476, 0x84f62],
];

for (const [start, end] of bands) {
  console.log(`\n=== band 0x${start.toString(16)}..0x${end.toString(16)} ===`);
  // dump each diff with 16 bytes of context on each side
  for (let i = start; i < end; i++) {
    if (bA[i] === bB[i]) continue;
    const ctxL = Array.from(bA.subarray(Math.max(0, i - 8), i)).map(x => x.toString(16).padStart(2, '0')).join(' ');
    const ctxR = Array.from(bA.subarray(i + 1, i + 9)).map(x => x.toString(16).padStart(2, '0')).join(' ');
    const ctxRB = Array.from(bB.subarray(i + 1, i + 9)).map(x => x.toString(16).padStart(2, '0')).join(' ');
    console.log(`  0x${i.toString(16)}  A=${bA[i].toString(16).padStart(2,'0')} B=${bB[i].toString(16).padStart(2,'0')}  L:[${ctxL}] R(A):[${ctxR}] R(B):[${ctxRB}]`);
  }
}
