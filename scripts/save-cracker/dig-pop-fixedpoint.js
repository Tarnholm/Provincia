// dig-pop-fixedpoint.js
// Test the hypothesis: population is stored as fixed-point (integer pop + a
// fractional accumulator = "progress toward next citizen / growth carry").
// Dump the 12 bytes around pop (dx -44..-30) per turn, and try several
// fixed-point interpretations:
//   - u32@-40 / 65536  (16.16 fixed point)
//   - read pop integer at -37 and fractional byte(s) just below
import { loadSave, hex } from "./loader.js";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const cityName = process.argv[2] || "Numantia";

const FILES = [
  ["T1", "save_17-05-2026   Spain   Turn 1.sav"],
  ["T2", "save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav"],
  ["T3", "save_Autosave   Spain   Turn 3 End.sav"],
  ["T4", "save_Autosave   Spain   Turn 4.sav"],
];

const u16 = Buffer.alloc(cityName.length * 2);
for (let i = 0; i < cityName.length; i++) u16.writeUInt16LE(cityName.charCodeAt(i), i * 2);

console.log(`city=${cityName}\n`);
console.log("turn  bytes[-41..-29]                                  | pop@-37 | u64@-41/2^32 | as 16.16@-40 | frac-byte@-41");
for (const [tag, f] of FILES) {
  const s = loadSave(path.join(SAVE_DIR, f));
  const buf = s.buf;
  const idx = buf.indexOf(u16);
  if (idx < 0) { console.log(`${tag}: not found`); continue; }
  const pop = buf.readUInt32LE(idx - 37);
  const bytes = hex(buf, idx - 41, 13);
  // Interpret the 8 bytes at -41 as a little-endian fixed-point where the top
  // 4 bytes are the integer pop and the low 4 bytes are the fraction.
  const lo = buf.readUInt32LE(idx - 41);
  const hi = buf.readUInt32LE(idx - 37);
  const fp64 = hi + lo / 4294967296;          // pop.frac  (32.32 fixed point)
  const fp1616 = buf.readUInt32LE(idx - 39) / 65536; // 16.16 reading at -39
  const fracByte = buf[idx - 41];
  console.log(`${tag}   ${bytes}  | ${String(pop).padStart(6)} | ${fp64.toFixed(6).padStart(14)} | ${fp1616.toFixed(4).padStart(11)} | ${String(fracByte).padStart(3)}`);
}
