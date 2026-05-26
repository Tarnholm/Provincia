// dig-pop-find-record.js
// Find ALL UTF-16 occurrences of a given city name and, at each, read u32 at
// name-35 (pop), name-571 (level), name-583 (creator). The live settlement
// stats record is the occurrence where pop is a sane number.
import { loadSave, hex, ascii } from "./loader.js";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const file = process.argv[2] || "save_17-05-2026   Spain   Turn 1.sav";
const cityName = process.argv[3] || "Corduba";
const s = loadSave(path.join(SAVE_DIR, file));
const buf = s.buf;
console.log(`file: ${file}  city: ${cityName}\n`);

// Build the UTF-16LE bytes of the name.
const u16 = Buffer.alloc(cityName.length * 2);
for (let i = 0; i < cityName.length; i++) u16.writeUInt16LE(cityName.charCodeAt(i), i * 2);

let from = 0, hits = 0;
while (true) {
  const idx = buf.indexOf(u16, from);
  if (idx < 0) break;
  from = idx + 1;
  hits++;
  // namePos = idx (start of UTF-16 chars).
  const rd = (dx) => {
    const o = idx + dx;
    if (o < 0 || o + 4 > buf.length) return null;
    return buf.readUInt32LE(o);
  };
  const pop = rd(-35);
  const lvl = rd(-571);
  const creator = rd(-583);
  // Check what precedes the name (the marker bytes).
  const pre = hex(buf, Math.max(0, idx - 3), 3);
  console.log(`#${hits} @0x${idx.toString(16)}  pre=[${pre}]  creator@-583=${creator}  lvl@-571=${lvl}  pop@-35=${pop}`);
}
console.log(`\ntotal UTF-16 occurrences of "${cityName}": ${hits}`);
