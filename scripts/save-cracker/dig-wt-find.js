// dig-wt-find.js — find all occurrences of WATCHTOWER and see context
"use strict";
const fs = require("fs");

const SAVE = process.argv[2] || "C:/Users/vtarn/Downloads/save_item limit bug.sav";
const buf = fs.readFileSync(SAVE);

for (const text of ["WATCHTOWER", "PORT_MANAGER", "ROAD_MANAGER", "WATCHTOWER_MANAGER", "FORT", "PORT_SHROUD"]) {
  const target = Buffer.from(text, "ascii");
  let p = 0;
  console.log(`\n=== ${text} occurrences ===`);
  while ((p = buf.indexOf(target, p)) >= 0) {
    // Print context (8B before + word + 24B after)
    const start = Math.max(0, p - 8);
    const end = Math.min(buf.length, p + text.length + 24);
    const slice = buf.slice(start, end);
    const hex = slice.toString("hex").match(/.{2}/g).join(" ");
    console.log(`  0x${p.toString(16)}: ${hex}`);
    p += 1;
  }
}
