// dig-rebellion2.js — correctly locate header + dump 16-byte records.
//
// For each spawn_scripts/*.txt path, the layout is (re-derived):
//   [u16 strLen][UTF-16LE strLen×2 bytes of path]
//   [u32 selfPtr  = offset of this u32 itself]
//   [6 bytes of zero?  OR  u32 zero + u16 zero?  TBD]
//   [u32 count]
//   [count × 16 bytes record]
//
// Goal: decode the 16-byte record's structure.

const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

const blocks = [
  { name: "chrysaoria", strLenOff: 0x18d3695 },
  { name: "cilicians",  strLenOff: 0x18d4821 },
  { name: "egypt",      strLenOff: 0x1956796 },
  { name: "lycia",      strLenOff: 0x1ab163f },
  { name: "miletus",    strLenOff: 0x1b0efc7 },
  { name: "thessaly",   strLenOff: 0x1c939bc },
];

function decodeBlock(b) {
  // u16 char count at strLenOff
  const charCount = buf.readUInt16LE(b.strLenOff);
  const strStart = b.strLenOff + 2;
  const strEnd = strStart + charCount * 2;
  const path = buf.slice(strStart, strEnd).toString("utf16le");
  console.log(`\n=== ${b.name} ===`);
  console.log(`  charCount=${charCount} path=${path}`);
  console.log(`  strStart=0x${strStart.toString(16)} strEnd=0x${strEnd.toString(16)}`);
  // After path: u32 selfPtr
  const selfPtr = buf.readUInt32LE(strEnd);
  console.log(`  selfPtr@0x${strEnd.toString(16)} = 0x${selfPtr.toString(16)} (delta=${selfPtr - strEnd})`);
  // Look at the 6 bytes after selfPtr (strEnd+4 .. strEnd+10)
  const midHex = [];
  for (let i = 4; i < 10; i++) midHex.push(buf[strEnd + i].toString(16).padStart(2, "0"));
  console.log(`  mid 6 bytes (strEnd+4..+9): ${midHex.join(" ")}`);
  // Count u32 at strEnd+10
  const count = buf.readUInt32LE(strEnd + 10);
  console.log(`  count u32 @0x${(strEnd+10).toString(16)} = ${count}`);
  const recStart = strEnd + 14;
  console.log(`  recStart=0x${recStart.toString(16)} bytesExpected=${count * 16}`);
  return { ...b, charCount, path, strStart, strEnd, selfPtr, count, recStart };
}

const decoded = blocks.map(decodeBlock);

// Now dump first 8 records of each
console.log("\n\n=== Hex dumps of first 8 records ===");
for (const b of decoded) {
  console.log(`\n--- ${b.name} (count=${b.count}) ---`);
  for (let i = 0; i < Math.min(8, b.count); i++) {
    const off = b.recStart + i * 16;
    const hex = [];
    const ascii = [];
    for (let j = 0; j < 16; j++) {
      const x = buf[off + j];
      hex.push(x.toString(16).padStart(2, "0"));
      ascii.push(x >= 0x20 && x <= 0x7e ? String.fromCharCode(x) : ".");
    }
    const u32s = [];
    for (let k = 0; k < 4; k++) u32s.push(buf.readUInt32LE(off + k * 4));
    const u16s = [];
    for (let k = 0; k < 8; k++) u16s.push(buf.readUInt16LE(off + k * 2));
    console.log(`  [${i}] @0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
    console.log(`        u32s=[${u32s.map(v => "0x"+v.toString(16)).join(", ")}]`);
    console.log(`        u16s=[${u16s.map(v => "0x"+v.toString(16)).join(", ")}]`);
  }
}
