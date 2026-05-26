// Dump raw cell records at the matrix base for RIS and vanilla, to understand
// the per-cell layout + how stride/key relate to faction count N (for a robust
// general locator in the app parser).
const fs = require("fs");
const DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";

function dump(label, path, base, stride, ncells) {
  let buf; try { buf = fs.readFileSync(path); } catch { console.log(`skip ${label}`); return; }
  console.log(`\n=== ${label}  base=0x${base.toString(16)} stride=${stride} ===`);
  for (let k = 0; k < ncells; k++) {
    const o = base - 8 + k * stride; // start 8 before 'base' to catch the key
    const u32s = [];
    for (let j = 0; j < Math.min(stride, 48); j += 4) u32s.push(buf.readUInt32LE(o + j));
    console.log(`  cell${k} @0x${o.toString(16)}: ${u32s.map(v=>v).join(" ")}`);
  }
}

// RIS macedon: base 0xf8fd1 stride 267
dump("RIS macedon t0", DIR + "save_macedon t0.sav", 0xf8fd1, 267, 4);
// vanilla Spain: base 0xcfec stride 115 (per agent)
dump("vanilla Spain T4 Start", DIR + "save_Autosave   Spain   Turn 4 Start.sav", 0xcfec, 115, 4);
