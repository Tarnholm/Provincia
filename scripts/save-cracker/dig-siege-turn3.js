// dig-siege-turn3.js
// Look more carefully at the post-siege-block context (0x152f57x area). The bytes
// after the 73-byte block look like a settlement record header.
//
// Per brief: siege block is 73 bytes at 0x152f529 with bytes 0..72 being:
//   +0=u8 0x01, +1..12=uuid, +13..65=zeros, +66..67=u16=2261, +68..72=zeros
// So the block ends at 0x152f529+73 = 0x152f572.
// What's at 0x152f572 onward?

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

for (const s of ["save_7.1.sav", "save_8.1.sav"]) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, s));
  console.log(`\n=== ${s} ===`);
  // Print bytes 0x152f520..0x152f5e0 with offsets relative to block start
  for (let off = 0x152f520; off < 0x152f5f0; off += 8) {
    const rel = off - 0x152f529;
    const hex = buf.slice(off, off + 8).toString("hex").replace(/(..)/g, "$1 ").trim();
    console.log(`  ${rel >= 0 ? "+" : ""}${rel.toString().padStart(4)}  0x${off.toString(16)}: ${hex}`);
  }
}

// Diff:
console.log("\n=== save_7.1 vs save_8.1 byte diffs in [0x152f520..0x152f700] ===");
const A = fs.readFileSync(path.join(SAVE_DIR, "save_7.1.sav"));
const B = fs.readFileSync(path.join(SAVE_DIR, "save_8.1.sav"));
for (let off = 0x152f520; off < 0x152f700; off++) {
  if (A[off] !== B[off]) {
    console.log(`  0x${off.toString(16)}: A=0x${A[off].toString(16).padStart(2,"0")} B=0x${B[off].toString(16).padStart(2,"0")}`);
  }
}
