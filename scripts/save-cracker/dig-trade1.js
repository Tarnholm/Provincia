// dig-trade1.js — locate trade-route data using messapian wipeout signal.
// Between rome6 and rome7, "messapian" strings drop from 7 to 0 in the file.
// Track WHERE these strings live in rome6, what surrounding data looks like,
// and find what changed.

const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const a = fs.readFileSync(path.join(SAVES, "save_rome6.sav"));
const b = fs.readFileSync(path.join(SAVES, "save_rome7.sav"));
console.log(`rome6: ${a.length} bytes, rome7: ${b.length} bytes`);

// Find all occurrences of "messapian" in rome6
function findAll(buf, needle) {
  const out = [];
  let p = 0;
  while (true) {
    p = buf.indexOf(needle, p);
    if (p === -1) break;
    out.push(p);
    p += 1;
  }
  return out;
}
const positions = findAll(a, "messapian");
console.log(`\n# 'messapian' occurrences in rome6: ${positions.length}`);
for (const p of positions) {
  // print context  +/- 40 bytes
  const start = Math.max(0, p - 40);
  const end = Math.min(a.length, p + 60);
  console.log(`\nat 0x${p.toString(16)}:`);
  const slice = a.slice(start, end);
  // print as both ASCII and hex
  const ascii = Array.from(slice).map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".").join("");
  console.log(`  ASCII: ${ascii}`);
  console.log(`  HEX:   ${slice.toString("hex").match(/.{1,2}/g).join(" ")}`);
}
