// dig-t900-explore.js — figure out what t900-end has in place of the post-grid array
"use strict";
const fs = require("fs");
const path = "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 900 End.sav";
const buf = fs.readFileSync(path);

// Look at bytes around 0xf84632
console.log(`File size: ${buf.length}`);
console.log(`\nBytes 0xf84632..0xf86000:`);
for (let off = 0xf84632; off < 0xf86000; off += 32) {
  const slice = buf.slice(off, off + 32);
  const hex = slice.toString("hex").match(/.{2}/g).join(" ");
  const asc = Array.from(slice).map(c => c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : ".").join("");
  console.log(`  0x${off.toString(16)}: ${hex}  ${asc}`);
}

// Search for byte sequences that resemble the c8 c8 02 06 signature anywhere from 0xf84632 onward
const SIG = Buffer.from([0xc8, 0x00, 0x00, 0x00, 0xc8, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x06]);
let p = 0xf84632;
let hits = 0;
const positions = [];
while ((p = buf.indexOf(SIG, p)) >= 0 && p < 0x1100000) {
  positions.push(p);
  hits++;
  p += 1;
}
console.log(`\nFound ${hits} c8c8-02-06 signature hits between 0xf84632 and 0x1100000`);
console.log(`First 5: ${positions.slice(0,5).map(x => "0x"+x.toString(16)).join(", ")}`);
// Check inter-position deltas — does the 267-stride hold?
if (positions.length > 5) {
  const deltas = [];
  for (let i = 1; i < Math.min(positions.length, 20); i++) deltas.push(positions[i] - positions[i-1]);
  console.log(`First deltas: ${deltas.join(", ")}`);
}
