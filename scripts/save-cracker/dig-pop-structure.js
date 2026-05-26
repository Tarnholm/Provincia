// dig-pop-structure.js
// Dump the stats block as a labeled structure. The block appears to be a series
// of 8-byte slots, each = [u8 small-int][3 bytes that are the int << shifts]
// followed by a float. Print every dx with: u8, the "int<<? family" detection,
// and float interpretation, so we can see the record grammar.
import { loadSave, hex, ascii } from "./loader.js";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const file = process.argv[2] || "save_17-05-2026   Spain   Turn 1.sav";
const cityName = process.argv[3] || "Numantia";
const span = parseInt(process.argv[4] || "150", 10);
const s = loadSave(path.join(SAVE_DIR, file));
const buf = s.buf;

const u16 = Buffer.alloc(cityName.length * 2);
for (let i = 0; i < cityName.length; i++) u16.writeUInt16LE(cityName.charCodeAt(i), i * 2);
const idx = buf.indexOf(u16);
console.log(`${cityName} @0x${idx.toString(16)} in ${file}\n`);
console.log("dx     hex(4)        u32          float        notes");
for (let dx = -span; dx <= 0; dx++) {
  const o = idx + dx;
  if (o < 0 || o + 4 > buf.length) continue;
  const u = buf.readUInt32LE(o);
  const f = buf.readFloatLE(o);
  const b = hex(buf, o, 4);
  let note = "";
  // Float in a sane positive range?
  if (Number.isFinite(f) && f > 0.5 && f < 100000) note += `F=${f.toFixed(2)} `;
  // Looks like value<<8 pattern (i.e., low byte zero, value/256 small)?
  if ((u & 0xff) === 0 && (u >>> 8) > 0 && (u >>> 8) < 100000) note += `<<8?(${u >>> 8}) `;
  console.log(`${String(dx).padStart(4)}  ${b}  ${String(u).padStart(11)}  ${f.toFixed(3).padStart(11)}  ${note}`);
}
