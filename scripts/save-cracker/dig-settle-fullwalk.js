// dig-settle-fullwalk.js
//
// Dump EVERY byte of the 583-byte settlement stats block as u8/u16/u32 at each
// dx (-583..-1 relative to name position). Also reads a window AFTER the name.
// Used to walk the block field-by-field and label u32s.
//
// Usage: node dig-settle-fullwalk.js "<save>" <settlementName> [preDx] [postDx]

"use strict";
const { loadSave, findStatsBlock } = require("./dig-settle-lib.js");

const buf = loadSave(process.argv[2]);
const name = process.argv[3];
const preDx = parseInt(process.argv[4] || "-600", 10);
const postDx = parseInt(process.argv[5] || "40", 10);

const sb = findStatsBlock(buf, name);
if (!sb) { console.log("stats block not found for " + name); process.exit(1); }
const np = sb.namePos;
console.log(`=== ${name} namePos=0x${np.toString(16)} (${np}) score=${sb.score} ===`);
console.log(`creator=${sb.creator} level=${sb.level} tax=${sb.tax} PO=${sb.po} income=${sb.income} pop=${sb.pop} popCopy=${sb.popCopy}`);
console.log("\ndx\tu8\tu16\tu32\t(i32)\thex");
for (let dx = preDx; dx <= postDx; dx++) {
  const o = np + dx;
  if (o < 0 || o + 4 > buf.length) continue;
  const u8 = buf[o];
  const u16 = buf.readUInt16LE(o);
  const u32 = buf.readUInt32LE(o);
  const i32 = buf.readInt32LE(o);
  // only print non-zero u8 OR every 4-aligned dx for readability
  const aligned = (dx % 4 === 0);
  if (u8 === 0 && !aligned) continue;
  console.log(`${dx}\t${u8}\t${u16}\t${u32}\t${i32 < 0 ? "(" + i32 + ")" : ""}\t${u8.toString(16).padStart(2, "0")}`);
}
