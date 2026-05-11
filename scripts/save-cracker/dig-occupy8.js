// dig-occupy8.js
// The 3-field block at Uria-1590 (u32, u32, u32) varies in interesting ways.
// Pull a wider window around it to find the parent record structure.

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function read(name) { return fs.readFileSync(path.join(SAVE_DIR, name)); }

const saves = [
  ["save_9.1",  read("save_9.1.sav"),  0x1264861],
  ["save_10.1", read("save_10.1.sav"), 0x1264861],
  ["save_11.1", read("save_11.1.sav"), 0x12693c6],
  ["save_12.1", read("save_12.1.sav"), 0x1264861],
];

// Dump 256 bytes around Uria-1700 (so -1700..-1444) which contains the 3-field
function hexdump(buf, addr, len, lineStart) {
  const lines = [];
  for (let i = 0; i < len; i += 16) {
    const slice = buf.slice(addr + i, addr + Math.min(i + 16, len));
    const hex = [];
    for (let j = 0; j < slice.length; j++) {
      hex.push(slice[j].toString(16).padStart(2, "0"));
    }
    const ascii = Array.from(slice).map(b => (b >= 0x20 && b < 0x7e) ? String.fromCharCode(b) : ".").join("");
    const relAddr = addr + i - lineStart;
    lines.push(`@${relAddr >= 0 ? "+" : ""}${relAddr}  0x${(addr+i).toString(16)}: ${hex.join(" ").padEnd(48)} ${ascii}`);
  }
  return lines.join("\n");
}

console.log("=== Uria-1700..-1444 (256 bytes) ===");
for (const [name, buf, m] of saves) {
  console.log(`\n${name}:`);
  console.log(hexdump(buf, m - 1700, 256, m));
}
