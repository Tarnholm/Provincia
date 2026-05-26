// dig-settle-hexdump.js — hex dump around an offset.
// Usage: node dig-settle-hexdump.js "<save>" <offset> [bytesBefore] [bytesAfter]
"use strict";
const { loadSave } = require("./dig-settle-lib");
const buf = loadSave(process.argv[2]);
const off = parseInt(process.argv[3], 10);
const before = parseInt(process.argv[4] || "64", 10);
const after = parseInt(process.argv[5] || "64", 10);
const start = Math.max(0, off - before);
const end = Math.min(buf.length, off + after);
for (let i = start; i < end; i += 16) {
  const row = [];
  const asc = [];
  for (let j = 0; j < 16 && i + j < end; j++) {
    const b = buf[i + j];
    row.push(b.toString(16).padStart(2, "0"));
    asc.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  const rel = i - off;
  console.log(`${i}\t(${rel >= 0 ? "+" : ""}${rel})\t${row.join(" ").padEnd(48)}  ${asc.join("")}`);
}
