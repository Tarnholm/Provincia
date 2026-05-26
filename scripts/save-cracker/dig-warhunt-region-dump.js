// dig-warhunt-region-dump.js  — hexdump arbitrary region with u32 annotation
"use strict";
const fs = require("fs");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const save = process.argv[2];
const start = parseInt(process.argv[3], 16);
const len = parseInt(process.argv[4] || "256", 10);
const buf = fs.readFileSync(SAVES_DIR + save);
for (let r = 0; r < len; r += 16) {
  const o = start + r;
  if (o >= buf.length) break;
  const slice = buf.slice(o, Math.min(o + 16, buf.length));
  const hex = Array.from(slice).map(b => b.toString(16).padStart(2, "0")).join(" ");
  const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : ".").join("");
  const u32 = [];
  for (let j = 0; j + 4 <= slice.length; j += 4) u32.push(slice.readUInt32LE(j));
  console.log(`0x${o.toString(16).padStart(8,"0")}  ${hex.padEnd(48)}  ${asc.padEnd(16)}  [${u32.join(",")}]`);
}
