// dig-occupy12.js
// Dump exact byte-aligned u32 values at Uria-1610, -1606, -1602, -1598, -1594, -1590, -1586, -1582
// for all 4 saves AND save_9.1 (pre-conquest baseline).

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function read(name) { return fs.readFileSync(path.join(SAVE_DIR, name)); }

const saves = [
  ["save_9.1",  read("save_9.1.sav"),  0x1264861, "pre-capture (Messapian)"],
  ["save_10.1", read("save_10.1.sav"), 0x1264861, "ENSLAVE"],
  ["save_11.1", read("save_11.1.sav"), 0x12693c6, "Brundisium captured (1 turn later)"],
  ["save_12.1", read("save_12.1.sav"), 0x1264861, "EXTERMINATE"],
];

const offsets = [-1620, -1616, -1612, -1610, -1608, -1606, -1604, -1602, -1598, -1594, -1590, -1586, -1582, -1578, -1574, -1570];

console.log("u32-LE values at byte offsets relative to Uria marker:");
console.log("offset".padEnd(8) + saves.map(s => s[0].padEnd(13)).join(" | "));
console.log("-".repeat(8 + saves.length * 16));
for (const off of offsets) {
  const row = [(`${off}`).padEnd(8)];
  for (const [_, buf, m] of saves) {
    const v = buf.readUInt32LE(m + off);
    const s = v > 1e7 ? `0x${v.toString(16)}` : `${v}`;
    row.push(s.padEnd(13));
  }
  console.log(row.join(" | "));
}

// Now also try reading the same offset as 4 separate bytes
console.log("\nByte-by-byte hex at offsets Uria-1620..-1570:");
for (let off = -1620; off < -1570; off += 8) {
  const row = [`${off}`.padEnd(6)];
  for (const [_, buf, m] of saves) {
    const hex = buf.slice(m + off, m + off + 8).toString("hex");
    row.push(hex);
  }
  console.log(row.join("  "));
}

// Investigate the +143 file size delta source. Find structural inserts.
console.log("\n=== Net file-size delta source ===");
const A = saves[1][1]; // save_10.1
const B = saves[3][1]; // save_12.1
console.log(`save_10.1 size = ${A.length}, save_12.1 size = ${B.length}, Δ=${B.length-A.length}`);
// Find first byte where they differ
let firstDiff = -1;
const minLen = Math.min(A.length, B.length);
for (let i = 0; i < minLen; i++) {
  if (A[i] !== B[i]) { firstDiff = i; break; }
}
console.log(`First diff at file offset 0x${firstDiff.toString(16)}`);

// Find last byte where they differ
let lastDiff = -1;
for (let i = 0; i < minLen; i++) {
  if (A[A.length-1-i] !== B[B.length-1-i]) { lastDiff = i; break; }
}
console.log(`Last diff at ${lastDiff} bytes from end (A.size-1-i; abs A=0x${(A.length-1-lastDiff).toString(16)}, B=0x${(B.length-1-lastDiff).toString(16)})`);
