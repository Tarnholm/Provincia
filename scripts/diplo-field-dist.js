// Per-field value distribution across the whole 239×239 matrix.
// Reveals which cell offset carries core_attitudes ({-10,200,600}),
// faction_relationships ({199,200,201}), faction_agression ({-10,400,600}).
"use strict";
const fs = require("fs");
const SAVE = process.argv[2] ||
  "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Julii turn1.sav";
const buf = fs.readFileSync(SAVE);
const STRIDE = 267, N = 239, CELL0 = 0x10aad6 - STRIDE; // back up one (C=-1 hint)
const TOTAL = N * N;

for (let fo = 0; fo <= 263; fo += 4) {
  const hist = new Map();
  for (let i = 0; i < TOTAL; i++) {
    const o = CELL0 + i * STRIDE + fo;
    if (o + 4 > buf.length) break;
    const v = buf.readInt32LE(o);
    hist.set(v, (hist.get(v) || 0) + 1);
  }
  // show only fields that VARY (more than 1 distinct value) and are smallish sets
  const entries = [...hist.entries()].sort((a, b) => b[1] - a[1]);
  if (entries.length === 1) { console.log(`+${String(fo).padStart(2)}: CONST ${entries[0][0]}`); continue; }
  const top = entries.slice(0, 8).map(([v, c]) => `${v}×${c}`).join("  ");
  console.log(`+${String(fo).padStart(2)}: ${entries.length} distinct | ${top}`);
}
