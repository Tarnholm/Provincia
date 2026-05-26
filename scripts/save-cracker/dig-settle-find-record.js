// dig-settle-find-record.js
//
// The settlement NAME appears in multiple places in the save (name pool,
// region list, the stats-block record). Only the stats-block occurrence has a
// sane creator/level/PO/income/pop block immediately before it. Find which
// occurrence(s) of a given settlement name satisfy the stats-block invariants.
//
// Usage: node dig-settle-find-record.js "<save>" <settlementName>

"use strict";
const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
function loadSave(arg) {
  if (fs.existsSync(arg)) return fs.readFileSync(arg);
  const p = path.join(SAVES, arg); if (fs.existsSync(p)) return fs.readFileSync(p);
  throw new Error("save not found: " + arg);
}

const buf = loadSave(process.argv[2]);
const name = process.argv[3];

// Build the marker byte pattern: [01|00, nchars, 00, UTF-16 chars, 00 00]
function nameMarkerVariants(name) {
  const variants = [];
  for (const flag of [0x01, 0x00]) {
    const b = Buffer.alloc(3 + name.length * 2 + 2);
    b[0] = flag; b[1] = name.length; b[2] = 0;
    for (let i = 0; i < name.length; i++) { b[3 + i * 2] = name.charCodeAt(i); b[3 + i * 2 + 1] = 0; }
    b[3 + name.length * 2] = 0; b[3 + name.length * 2 + 1] = 0;
    variants.push(b);
  }
  return variants;
}

const occurrences = [];
for (const pat of nameMarkerVariants(name)) {
  let p = 0;
  while ((p = buf.indexOf(pat, p)) !== -1) {
    // namePos = memory convention (marker + 1 = the length-prefix byte).
    occurrences.push({ markerOffset: p, flag: pat[0], namePos: p + 1 });
    p += 1;
  }
}
occurrences.sort((a, b) => a.markerOffset - b.markerOffset);
console.log(`name "${name}": ${occurrences.length} marker occurrence(s)`);

for (const o of occurrences) {
  const namePos = o.namePos;
  const rd = (dx) => (namePos + dx >= 0 && namePos + dx + 4 <= buf.length) ? buf.readUInt32LE(namePos + dx) : null;
  const rdu8 = (dx) => (namePos + dx >= 0 && namePos + dx < buf.length) ? buf[namePos + dx] : null;
  const creator = rd(-583), level = rd(-571), tax = rdu8(-562), po = rd(-435), income = rd(-127), pop = rd(-35);
  // Sanity gate: creator small (<300), level<10, PO 0..100, income 0..100000, pop 100..200000
  const sane = creator !== null && creator < 300 && level !== null && level < 10 &&
    po !== null && po <= 200 && income !== null && income >= 0 && income < 200000 &&
    pop !== null && pop >= 100 && pop < 300000;
  console.log(`  marker@${o.markerOffset} flag=${o.flag} : creator=${creator} level=${level} tax=${tax} PO=${po} income=${income} pop=${pop} ${sane ? "  <== STATS BLOCK" : ""}`);
}
