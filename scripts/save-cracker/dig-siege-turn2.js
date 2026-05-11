// dig-siege-turn2.js
// Check what 2261 corresponds to.
// In save_11.1, Tarentum-34 (u16 settlement pop) = 2261. But the siege blocks at u16+66=2261
// are in save_7.1 (Brundisium siege) and save_8.1 (Tarentum siege). So the value isn't Brundisium pop.
//
// Hypothesis A: 2261 is a constant (engine literal).
// Hypothesis B: 2261 is a wall HP value that happens to be the same for both Brundisium and Tarentum
//               (e.g., both are "stone wall" tier = 2261 HP).
//
// Let me find the besieged settlement records' "wall HP" field. Actually, sieges in RTW typically
// damage the WALL of the settlement. Let me check Brundisium's "defenses" chain HP across save_7 and save_8.

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function findAllSettlementMarkers(buf) {
  const out = [];
  for (let i = 0; i < buf.length - 30; i++) {
    const flag = buf[i];
    if (flag !== 0x01 && flag !== 0x00) continue;
    const nc = buf[i + 1];
    if (nc < 3 || nc > 32 || buf[i + 2] !== 0) continue;
    const se = i + 3 + nc * 2;
    if (se + 2 > buf.length || buf[se] !== 0 || buf[se + 1] !== 0) continue;
    let ok = true, name = "";
    for (let j = i + 3; j < se; j += 2) {
      const lo = buf[j], hi = buf[j + 1];
      if (hi !== 0 || lo < 0x20 || lo > 0x7e) { ok = false; break; }
      name += String.fromCharCode(lo);
    }
    if (ok && name[0] >= "A" && name[0] <= "Z") {
      out.push({ offset: i, name, blockEnd: se + 2 });
    }
  }
  return out;
}

const saves = ["save_6.1.sav", "save_7.1.sav", "save_8.1.sav", "save_9.1.sav"];

for (const s of saves) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, s));
  const markers = findAllSettlementMarkers(buf);
  const brun = markers.find(m => m.name === "Brundisium");
  const tar = markers.find(m => m.name === "Tarentum");
  console.log(`\n${s}:`);
  console.log(`  Brundisium @ 0x${brun.offset.toString(16)}: u16@-34=${buf.readUInt16LE(brun.offset - 34)}`);
  console.log(`  Tarentum @ 0x${tar.offset.toString(16)}: u16@-34=${buf.readUInt16LE(tar.offset - 34)}`);
}

// Hmm — 2261 is suspiciously equal to Tarentum's pop in save_11.1 but might be coincidence.
// Let me also check what 2261 could be: 2261 in decimal. In RTW vanilla wall HP for
// "wooden_wall" / "stone_wall" / "large_stone_wall" / "epic_stone_wall" tiers are typically
// in a range of 1500-8000 HP. 2261 could be a specific tier.

// Are 2261 values elsewhere in the save? Check occurrences.
function countU16(buf, val) {
  let count = 0;
  for (let i = 0; i < buf.length - 2; i++) {
    if (buf.readUInt16LE(i) === val) count++;
  }
  return count;
}

console.log("\nOccurrences of u16=2261:");
for (const s of saves) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, s));
  console.log(`  ${s}: ${countU16(buf, 2261)} occurrences`);
}

// Look at the byte just BEFORE the siege block — maybe siege block has surrounding context
console.log("\n\n=== Siege block PLUS surrounding context ===");
for (const s of ["save_7.1.sav", "save_8.1.sav"]) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, s));
  const blockStart = 0x152f529;
  console.log(`\n${s} bytes [0x${(blockStart-32).toString(16)}..0x${(blockStart+128).toString(16)}]:`);
  for (let off = blockStart - 32; off < blockStart + 128; off += 16) {
    console.log(`  0x${off.toString(16)}: ${buf.slice(off, off + 16).toString("hex")}`);
  }
}
