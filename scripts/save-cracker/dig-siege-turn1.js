// dig-siege-turn1.js
// Session 33 found the 73-byte siege block has u16=2261 at +66 ("wall HP"). But 2261 was the SAME
// value for BOTH Brundisium and Tarentum sieges. Wait — Brundisium and Tarentum likely have
// the SAME wall level (both walled minor towns), so wall-HP might coincidentally match.
// OR 2261 is not wall HP at all, just a constant.
//
// Cross-validate: look at OTHER bytes in the 73-byte block. If save_7.1 and save_8.1 have
// different siege progress (turn 0 vs turn 1+), some byte should differ.

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

// Per session 33, siege block at 0x152f529 in BOTH save_7 and save_8 (different sieges).
// Let me first confirm where the blocks are in each.

function findSiegeBlocks(buf) {
  // Predicate per session 33:
  //   buf[off]==1, buf[off+1..13] has >=8 non-zero bytes,
  //   buf[off+13..66] all zero, 0 < u16(off+66) < 65536, buf[off+68..73] all zero
  const out = [];
  for (let off = 0x1000000; off < Math.min(buf.length - 73, 0x1800000); off++) {
    if (buf[off] !== 0x01) continue;
    // 12-byte uuid >= 8 non-zero
    let nz = 0;
    for (let k = 1; k <= 12; k++) if (buf[off + k] !== 0) nz++;
    if (nz < 8) continue;
    // 53 zeros 13..65
    let allZero = true;
    for (let k = 13; k <= 65; k++) if (buf[off + k] !== 0) { allZero = false; break; }
    if (!allZero) continue;
    // u16 at +66 non-zero
    const u16 = buf.readUInt16LE(off + 66);
    if (u16 === 0) continue;
    // bytes 68..72 zero
    let tailZero = true;
    for (let k = 68; k <= 72; k++) if (buf[off + k] !== 0) { tailZero = false; break; }
    if (!tailZero) continue;
    out.push({ off, uuid: buf.slice(off + 1, off + 13).toString("hex"), u16 });
  }
  return out;
}

const saves = ["save_6.1.sav", "save_7.1.sav", "save_8.1.sav", "save_9.1.sav"];
for (const s of saves) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, s));
  const blocks = findSiegeBlocks(buf);
  console.log(`\n=== ${s}: ${blocks.length} siege blocks ===`);
  for (const b of blocks) {
    console.log(`  0x${b.off.toString(16)} uuid=${b.uuid} u16@+66=${b.u16}`);
    // Dump full block
    const block = buf.slice(b.off, b.off + 73);
    console.log(`    block: ${block.toString("hex")}`);
  }
}
