// dig-pop-unaligned.js
// The stats block is not 4-byte aligned to the name position. Scan EVERY byte
// offset in [name-span, name) reading a u32 there, and flag offsets whose value
// equals a known target (population) or sits in a plausible level/PO/income range.
import { loadSave, hex, ascii } from "./loader.js";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const file = process.argv[2] || "save_17-05-2026   Spain   Turn 1.sav";
const cityName = process.argv[3] || "Corduba";
const knownPop = parseInt(process.argv[4] || "1400", 10);
const span = parseInt(process.argv[5] || "650", 10);
const s = loadSave(path.join(SAVE_DIR, file));
const buf = s.buf;

const u16 = Buffer.alloc(cityName.length * 2);
for (let i = 0; i < cityName.length; i++) u16.writeUInt16LE(cityName.charCodeAt(i), i * 2);
const idx = buf.indexOf(u16);
if (idx < 0) { console.log("name not found"); process.exit(1); }
console.log(`file: ${file}  ${cityName} name @0x${idx.toString(16)}  knownPop=${knownPop}\n`);

// Find every dx where u32 == knownPop.
console.log(`-- u32 == ${knownPop} hits in [name-${span}, name):`);
for (let o = idx - span; o < idx - 3; o++) {
  if (buf.readUInt32LE(o) === knownPop) {
    console.log(`   dx=${o - idx}  (0x${o.toString(16)})  ctx: ${hex(buf, o - 4, 16)}`);
  }
}

// Print byte hex dump of region [name-64, name) so we can read the trailing fields.
console.log(`\n-- byte dump [name-80, name):`);
for (let o = idx - 80; o < idx; o += 16) {
  const dx = o - idx;
  console.log(`  dx=${String(dx).padStart(4)}  ${hex(buf, o, 16)}   ${ascii(buf, o, 16)}`);
}
