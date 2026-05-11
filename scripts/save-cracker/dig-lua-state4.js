// dig-lua-state4.js — Decode the area around the spawn_scripts/*.txt paths.
// These are at 0x18d3695, 0x18d4821, 0x1956796, 0x1ab163f, 0x1b0efc7, 0x1c939bc.
// Each one is INSIDE the body root (< 0x1f10c72), so they're embedded in body records.
// Are they script-event records or just config-path references?

const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

const paths = [
  { off: 0x18d3695, name: "chrysaoria" },
  { off: 0x18d4821, name: "cilicians" },
  { off: 0x1956796, name: "egypt" },
  { off: 0x1ab163f, name: "lycia" },
  { off: 0x1b0efc7, name: "miletus" },
  { off: 0x1c939bc, name: "thessaly" },
];

for (const p of paths) {
  console.log(`\n=== Around ${p.name} script @0x${p.off.toString(16)} ===`);
  for (let i = -3; i < 12; i++) {
    const off = p.off + i * 16;
    if (off < 0 || off + 16 > buf.length) continue;
    const hex = [];
    const ascii = [];
    for (let j = 0; j < 16; j++) {
      const b = buf[off + j];
      hex.push(b.toString(16).padStart(2, "0"));
      ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
    }
    console.log(`  0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
  }
}
