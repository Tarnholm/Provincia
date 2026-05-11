// Dump bytes around Leonidas's confirmed position field across all 5 saves.
// Goal:
//   - identify the 2 mystery bytes between X and Y
//   - see what changes in save_1.5 (embarked on boat)
//   - find record start + stride
import fs from "node:fs";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const labels = ["1.3", "1.4", "1.5", "1.6"];
const saves = labels.map(l => fs.readFileSync(path.join(SAVE_DIR, `save_${l}.sav`)));
const knownPos = {
  "1.3": [400, 335],
  "1.4": [406, 329],
  "1.5": [null, null], // unknown — embarked
  "1.6": [407, 320],
};
const TARGETS = { "1.3": 0x154a708, "1.4": 0x154a708, "1.5": 0x154a708, "1.6": 0x154a708 };

const PRE = 32, POST = 64;
for (let i = 0; i < labels.length; i++) {
  const l = labels[i];
  const buf = saves[i];
  const off = TARGETS[l];
  console.log(`\n=== save_${l} @0x${off.toString(16)} (X expected ${knownPos[l][0]}, Y expected ${knownPos[l][1]}) ===`);
  for (let row = -PRE; row < POST; row += 16) {
    const o = off + row;
    if (o < 0 || o + 16 > buf.length) continue;
    const bytes = Array.from(buf.subarray(o, o + 16)).map(b => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = Array.from(buf.subarray(o, o + 16)).map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".").join("");
    let line = `Δ${String(row).padStart(4)}  ${bytes}  ${ascii}`;
    // Annotate u16 values
    line += "  u16:";
    for (let u = 0; u < 16; u += 2) line += String(buf.readUInt16LE(o + u)).padStart(6) + ",";
    if (row === 0) line += "  ← X";
    if (row === 4) line += "  ← Y? (was +4 from X)";
    console.log(line);
  }
}

// Specifically: what are the 2 bytes between X (offset+0) and Y (offset+4)?
console.log(`\n=== mystery 2 bytes at X+2 across saves ===`);
for (let i = 0; i < labels.length; i++) {
  const l = labels[i];
  const buf = saves[i];
  const off = TARGETS[l];
  const m = buf.readUInt16LE(off + 2);
  console.log(`  save_${l}: u16@X+2 = ${m} (0x${m.toString(16)})  ← position (${knownPos[l][0]||"?"}, ${knownPos[l][1]||"?"})`);
}

// Dump 256B before and after the position to find record boundaries
console.log(`\n=== save_1.3 wide context (256B before, 384B after position) ===`);
const wide = saves[0];
const wideOff = TARGETS["1.3"];
for (let row = -256; row < 384; row += 32) {
  const o = wideOff + row;
  if (o < 0 || o + 32 > wide.length) continue;
  const bytes = Array.from(wide.subarray(o, o + 16)).map(b => b.toString(16).padStart(2, "0")).join(" ");
  const ascii = Array.from(wide.subarray(o, o + 32)).map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".").join("");
  console.log(`Δ${String(row).padStart(5)}  ${bytes}  ${ascii}`);
}
