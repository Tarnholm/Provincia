// dig-siege-turn4.js
// Sanity check: save_8 should have BOTH siege blocks (Brundisium still being sieged + Tarentum
// just started). Re-scan with no offset constraints.

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function findSiegeBlocks(buf) {
  const out = [];
  for (let off = 0; off < buf.length - 73; off++) {
    if (buf[off] !== 0x01) continue;
    let nz = 0;
    for (let k = 1; k <= 12; k++) if (buf[off + k] !== 0) nz++;
    if (nz < 8) continue;
    let allZero = true;
    for (let k = 13; k <= 65; k++) if (buf[off + k] !== 0) { allZero = false; break; }
    if (!allZero) continue;
    const u16 = buf.readUInt16LE(off + 66);
    if (u16 === 0) continue;
    let tailZero = true;
    for (let k = 68; k <= 72; k++) if (buf[off + k] !== 0) { tailZero = false; break; }
    if (!tailZero) continue;
    out.push({ off, uuid: buf.slice(off + 1, off + 13).toString("hex"), u16 });
  }
  return out;
}

for (const s of ["save_6.1.sav", "save_7.1.sav", "save_8.1.sav", "save_9.1.sav"]) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, s));
  const blocks = findSiegeBlocks(buf);
  console.log(`${s}: ${blocks.length} blocks`);
  for (const b of blocks) {
    // Look at +79 byte (turn counter candidate)
    const turnCounter = buf[b.off + 79];
    console.log(`  0x${b.off.toString(16)} u16=${b.u16} uuid=${b.uuid.slice(0,16)}... +79=${turnCounter}`);
  }
}
