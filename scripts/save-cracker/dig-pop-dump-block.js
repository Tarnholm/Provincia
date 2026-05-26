// dig-pop-dump-block.js
// Dump the raw bytes preceding a city's UTF-16 name as a u32 grid, annotating
// the dx (offset from name position). Lets us read the whole stats block.
import { loadSave, hex, ascii } from "./loader.js";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const file = process.argv[2] || "save_17-05-2026   Spain   Turn 1.sav";
const cityName = process.argv[3] || "Corduba";
const span = parseInt(process.argv[4] || "600", 10);
const s = loadSave(path.join(SAVE_DIR, file));
const buf = s.buf;

const u16 = Buffer.alloc(cityName.length * 2);
for (let i = 0; i < cityName.length; i++) u16.writeUInt16LE(cityName.charCodeAt(i), i * 2);
const idx = buf.indexOf(u16);
if (idx < 0) { console.log("name not found"); process.exit(1); }
console.log(`file: ${file}  ${cityName} name @0x${idx.toString(16)}\n`);

// Print u32 grid from name-span to name, with dx labels. Print 8 u32 per row.
const start = idx - span;
for (let o = start; o < idx; o += 32) {
  const cells = [];
  for (let c = 0; c < 8; c++) {
    const oo = o + c * 4;
    if (oo + 4 > buf.length || oo < 0) { cells.push("        ----"); continue; }
    const dx = oo - idx;
    const v = buf.readUInt32LE(oo);
    cells.push(`${String(dx).padStart(4)}:${String(v).padStart(11)}`);
  }
  console.log(cells.join(" "));
}
