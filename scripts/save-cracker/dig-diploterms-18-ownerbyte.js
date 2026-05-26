// dig-diploterms-18-ownerbyte.js
// Precisely locate the owner faction id relative to the marker. Scan a window
// before each marker for a u32 in [0,20] that increments monotonically across
// the 21 markers (= descr_sm_factions order). Report the exact delta.
"use strict";
const fs = require("fs");
const path = require("path");
const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const VANILLA_ORDER = [
  "romans_julii","romans_brutii","romans_scipii","romans_senate","macedon","egypt",
  "seleucid","carthage","parthia","pontus","gauls","germans","britons","armenia",
  "dacia","greek_cities","numidia","scythia","spain","thrace","slave"];
const MARKER = 0x39240005;

const buf = fs.readFileSync(path.join(SAVE_DIR, "save_17-05-2026   Spain   Turn 1.sav"));
const markers = [];
for (let i = 4; i + 8 < buf.length; i++) {
  if (buf.readUInt32LE(i) !== MARKER) continue;
  const count = buf.readUInt32LE(i + 4);
  if (count > 250) continue;
  markers.push(i);
}
console.log(`markers=${markers.length}`);

// For each candidate delta, read u32 at marker-delta and see if it equals the
// marker's sequential index (0..20) for ALL markers.
for (let delta = 16; delta <= 60; delta++) {
  let allMatch = true;
  const vals = [];
  for (let mi = 0; mi < markers.length; mi++) {
    const off = markers[mi] - delta;
    if (off < 0) { allMatch = false; break; }
    const v = buf.readUInt32LE(off);
    vals.push(v);
    if (v !== mi) allMatch = false;
  }
  if (allMatch) console.log(`  delta=${delta} (u32): sequential-index match! vals=${vals.join(",")}`);
}

// Also test the -53 single byte
console.log("\n-53 byte vs marker index:");
for (let mi = 0; mi < markers.length; mi++) {
  const b = buf[markers[mi] - 53];
  console.log(`  marker ${mi}: byte@-53=${b} (${VANILLA_ORDER[b]||"?"})  ${b===mi?"==idx":"!=idx"}`);
}
