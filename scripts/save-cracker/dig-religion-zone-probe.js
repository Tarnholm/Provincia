// dig-religion-zone-probe.js
// The 53-element dense-vector scan flagged two suspicious zones:
//   * u16 scale-100 single-religion "100" vectors clustered ~0xf855xx-0xfa0xxx
//   * f32 sum-1.0 vectors at ~0xf89fc8+
// These overlap the diplomacy-matrix base (~0xf8000). Probe the raw bytes there
// to decide whether it's diplomacy, religion, or something else.
//
// Pure read. Dumps several windows + interprets as u32 records.
const fs = require("fs");
const SAVE = process.argv[2] || "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav";
const buf = fs.readFileSync(SAVE);
console.log("save:", SAVE.split("\\").pop(), "size:", buf.length);

function dump(label, start, count) {
  console.log("\n==== " + label + " @0x" + start.toString(16) + " ====");
  for (let row = start; row < start + count; row += 16) {
    let hex = "", asc = "";
    for (let k = 0; k < 16; k++) {
      const b = buf[row + k];
      hex += b.toString(16).padStart(2, "0") + " ";
      asc += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".";
    }
    console.log("0x" + (row >>> 0).toString(16) + "  " + hex + " " + asc);
  }
}

// Show the actual bytes at the f32 sum=1.0 hit and one u16 single-100 hit.
dump("f32 hit region", 0xf89f00, 0x120);
dump("u16 single-100 hit region", 0xf85540, 0x120);

// Interpret a window as u32 record stream to spot stride/structure.
console.log("\n==== u32 stream @0xf89f00 ====");
for (let o = 0xf89f00; o < 0xf89f00 + 0x100; o += 4) {
  console.log("0x" + o.toString(16) + "  u32=" + buf.readUInt32LE(o) + "  f32=" + buf.readFloatLE(o).toFixed(4));
}
