// dig-diploterms-06-zonecontext.js
// Dump raw bytes around each zone marker in T1 base to understand the owner
// byte and the zone structure. Verify -53 owner mapping and look for partner
// identity / extra fields near each zone.
"use strict";
const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const VANILLA_ORDER = [
  "romans_julii", "romans_brutii", "romans_scipii", "romans_senate",
  "macedon", "egypt", "seleucid", "carthage", "parthia", "pontus",
  "gauls", "germans", "britons", "armenia", "dacia",
  "greek_cities", "numidia", "scythia", "spain", "thrace", "slave",
];
const MARKER = 0x39240005;

const buf = fs.readFileSync(path.join(SAVE_DIR, "save_17-05-2026   Spain   Turn 1.sav"));

const markers = [];
for (let i = 53; i + 8 < buf.length; i++) {
  if (buf.readUInt32LE(i) !== MARKER) continue;
  const count = buf.readUInt32LE(i + 4);
  if (count > 250) continue;
  markers.push(i);
}
console.log(`Found ${markers.length} markers`);

function hex(off, len) {
  const s = [];
  for (let i = 0; i < len; i++) {
    s.push(buf[off + i].toString(16).padStart(2, "0"));
  }
  return s.join(" ");
}

// For each marker, show bytes from -60 to +8 to inspect owner byte & preamble.
for (let mi = 0; mi < markers.length; mi++) {
  const m = markers[mi];
  const count = buf.readUInt32LE(m + 4);
  const fidAt53 = buf[m - 53];
  console.log(`\n[zone ${mi}] markerOff=0x${m.toString(16)} count=${count} owner@-53=${fidAt53}(${VANILLA_ORDER[fidAt53]||"?"})`);
  // print bytes -60..-40 (where owner sits), and -16..0
  console.log(`  [-60..-40]: ${hex(m-60, 20)}`);
  console.log(`  [-40..-20]: ${hex(m-40, 20)}`);
  console.log(`  [-20..0]  : ${hex(m-20, 20)}`);
  console.log(`  [marker..+8]: ${hex(m, 8)}`);
}
