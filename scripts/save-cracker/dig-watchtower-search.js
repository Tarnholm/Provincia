// dig-watchtower-search.js — search for any trace of "watchtower" in the save
// (ASCII, UTF-16, partial). Also search for fort.
"use strict";
const fs = require("fs");

const SAVE = process.argv[2] || "C:/Users/vtarn/Downloads/save_item limit bug.sav";
const buf = fs.readFileSync(SAVE);

for (const text of ["watchtower", "Watchtower", "WATCHTOWER", "watch_tower", "tower", "fort", "Fort", "FORT", "outpost"]) {
  // ASCII
  let p = 0, count = 0;
  const target = Buffer.from(text, "ascii");
  while ((p = buf.indexOf(target, p)) >= 0) { count++; p += 1; }
  // UTF-16 LE
  const utf16 = Buffer.alloc(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    utf16.writeUInt16LE(text.charCodeAt(i), i * 2);
  }
  let p2 = 0, count2 = 0;
  while ((p2 = buf.indexOf(utf16, p2)) >= 0) { count2++; p2 += 1; }
  console.log(`'${text}': ASCII=${count}, UTF-16=${count2}`);
}

// Also: look for byte patterns that imply "fort_data" records. Tier 5 in HST = WATCHTOWER (idx 60)
// Look for sections marked as section_type = 60. Find them in ZoneA, ZoneB, etc.

// Locate the FORT building chain (which is "fort_chain" or similar in EDB)
console.log("\n--- FORT chain strings ---");
for (const text of ["fort_chain", "fort_capability", "fort_building", "watchtower_chain"]) {
  const target = Buffer.from(text);
  let p = 0, count = 0;
  while ((p = buf.indexOf(target, p)) >= 0) { count++; p += 1; }
  console.log(`'${text}': ${count} ASCII hits`);
}
