// dig-occupy7.js
// Context around the -1590 / -1877 region to understand what structure these
// changing bytes belong to.

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function read(name) { return fs.readFileSync(path.join(SAVE_DIR, name)); }

const saves = [
  ["save_9.1",  read("save_9.1.sav"),  0x1264861, "pre"],
  ["save_10.1", read("save_10.1.sav"), 0x1264861, "enslave"],
  ["save_11.1", read("save_11.1.sav"), 0x12693c6, "captured-Brund"],
  ["save_12.1", read("save_12.1.sav"), 0x1264861, "exterminate"],
];

// Dump 64-byte hex windows around Uria-1877 and Uria-1590 in all 4 saves
function hexdump(buf, addr, len) {
  const lines = [];
  for (let i = 0; i < len; i += 16) {
    const slice = buf.slice(addr + i, addr + Math.min(i + 16, len));
    const hex = [];
    for (let j = 0; j < slice.length; j++) {
      hex.push(slice[j].toString(16).padStart(2, "0"));
    }
    const ascii = Array.from(slice).map(b => (b >= 0x20 && b < 0x7e) ? String.fromCharCode(b) : ".").join("");
    lines.push(`0x${(addr+i).toString(16)}: ${hex.join(" ").padEnd(48)} ${ascii}`);
  }
  return lines.join("\n");
}

for (const offset of [-1877, -1610, -1590]) {
  console.log(`\n=== Around Uria${offset} ===`);
  for (const [name, buf, m] of saves) {
    console.log(`\n${name}:`);
    console.log(hexdump(buf, m + offset - 16, 64));
  }
}
