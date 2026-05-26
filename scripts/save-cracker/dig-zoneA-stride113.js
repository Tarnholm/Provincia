// dig-zoneA-stride113.js — investigate the stride-113 cardinality match in ZoneA
//
// ZoneA-log-slots (0x61c47..0x846af, 141,928 B) gives n=1256 if divided by
// stride 113. That's only 20 short of the dev image's "ports=1276".
// Worth a hard look.
"use strict";
const fs = require("fs");

const SAVES = [
  ["item_limit_bug", "C:/Users/vtarn/Downloads/save_item limit bug.sav"],
  ["t960",           "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav"],
  ["t1018",          "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 1018 Start.sav"],
];

for (const [tag, path] of SAVES) {
  const buf = fs.readFileSync(path);
  console.log(`\n=== ${tag} ===`);
  const start = 0x61c47, end = 0x846af;
  const span = end - start;
  console.log(`  Zone ${span} B`);
  // try stride 113 alignment 0
  console.log(`  First 4 records (stride 113):`);
  for (let i = 0; i < 4; i++) {
    const off = start + i * 113;
    const slice = buf.slice(off, off + 113);
    const hex = slice.slice(0,32).toString("hex").match(/.{2}/g).join(" ");
    console.log(`    rec ${i} @ 0x${off.toString(16)}: ${hex}...`);
  }
  // Read the first u32 of each record to look for variation
  const firstU32 = new Map();
  for (let i = 0; i < Math.floor(span/113); i++) {
    const off = start + i * 113;
    const v = buf.readUInt32LE(off);
    firstU32.set(v, (firstU32.get(v) || 0) + 1);
  }
  const top = [...firstU32.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5);
  console.log(`  Distinct first-u32 values: ${firstU32.size} (top 5): ${top.map(([v,n])=>`${v}=${n}`).join(", ")}`);
}
