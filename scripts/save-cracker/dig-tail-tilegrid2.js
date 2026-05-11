// dig-tail-tilegrid2.js — go directly to session 14's specified boundaries
// 0x1f8f97b..0x210f4d4 (rome10) and look inside. The session-1 detector
// was looking too early in the file.

const fs = require("fs");

const ROME10 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const ROR_T1 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav";

function analyze(savePath, label, startGuess, endGuess) {
  const buf = fs.readFileSync(savePath);
  console.log(`\n===== ${label} (size 0x${buf.length.toString(16)}) =====`);

  // Walk in 4KB blocks counting 0xff00 (LE) word frequency to find the tail grid.
  // Specifically, look in range (file-3MB) .. file-end.
  const BLOCK = 0x1000;
  const blocks = [];
  for (let off = buf.length - 3 * 1024 * 1024; off < buf.length - 1; off += BLOCK) {
    const end = Math.min(off + BLOCK, buf.length - 1);
    let nFf00 = 0;
    let nZeros = 0;
    let nFf = 0; // count of 0xff bytes
    let nNonZero = 0;
    for (let p = off; p < end - 1; p += 2) {
      const w = buf.readUInt16LE(p);
      if (w === 0xff00) nFf00++;
      else if (w === 0x0000) nZeros++;
      else if (w === 0xffff) nFf++;
      else nNonZero++;
    }
    blocks.push({ off, nFf00, nZeros, nFf, nNonZero });
  }

  // Find where 0xff00 is heavy (>200/2048 ≈ 10%)
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const tag = b.nFf00 > 200 ? "FF00" : (b.nZeros > 1800 ? "ZERO" : "MIX");
    if (i < 6 || tag !== "MIX" || (i > 0 && tag !== (blocks[i-1].nFf00 > 200 ? "FF00" : (blocks[i-1].nZeros > 1800 ? "ZERO" : "MIX")))) {
      console.log(`  0x${b.off.toString(16)}: ff00=${b.nFf00} zeros=${b.nZeros} ffff=${b.nFf} other=${b.nNonZero} → ${tag}`);
    }
  }

  // Try direct dump around session-14-given offsets
  console.log(`\n  Hex 0x${startGuess.toString(16)}..(+128):`);
  for (let row = 0; row < 8; row++) {
    const off = startGuess + row * 16;
    const hex = [];
    for (let j = 0; j < 16; j++) hex.push(buf[off + j].toString(16).padStart(2, "0"));
    console.log(`    0x${off.toString(16)}: ${hex.join(" ")}`);
  }
  if (endGuess) {
    console.log(`\n  Hex 0x${(endGuess - 64).toString(16)}..0x${endGuess.toString(16)}:`);
    for (let row = 0; row < 4; row++) {
      const off = endGuess - 64 + row * 16;
      const hex = [];
      for (let j = 0; j < 16; j++) hex.push(buf[off + j].toString(16).padStart(2, "0"));
      console.log(`    0x${off.toString(16)}: ${hex.join(" ")}`);
    }
  }
}

analyze(ROME10, "rome10", 0x1f8f97b, 0x210f4d4);
analyze(ROR_T1, "RoR-T1", 0x1f8f97b, 0x20ec900);
