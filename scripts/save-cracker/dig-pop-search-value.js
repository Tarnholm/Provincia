// dig-pop-search-value.js
// Search for a known u32 value (a city's population) across the file and show
// each location's context. Helps locate the live settlement stats record.
import { loadSave, hex, ascii } from "./loader.js";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const file = process.argv[2] || "save_17-05-2026   Spain   Turn 1.sav";
const target = parseInt(process.argv[3] || "1400", 10);
const s = loadSave(path.join(SAVE_DIR, file));
const buf = s.buf;
console.log(`file: ${file}  target u32 = ${target} (0x${target.toString(16)})\n`);

const needle = Buffer.alloc(4);
needle.writeUInt32LE(target);

let from = 0, hits = 0;
const locs = [];
while (true) {
  const idx = buf.indexOf(needle, from);
  if (idx < 0) break;
  from = idx + 1;
  hits++;
  locs.push(idx);
  if (hits > 400) break;
}
console.log(`total u32 occurrences of ${target}: ${hits}\n`);

// Show context for first 40 — look for nearby ascii city names / UTF-16.
for (const idx of locs.slice(0, 40)) {
  const asc = ascii(buf, Math.max(0, idx - 40), 80);
  // also scan +40 ahead for a UTF-16 name (lo byte printable, hi=0)
  let utf = "";
  for (let j = idx; j < Math.min(buf.length, idx + 120); j += 2) {
    const lo = buf[j], hi = buf[j + 1];
    if (hi === 0 && lo >= 0x41 && lo <= 0x7a) utf += String.fromCharCode(lo);
    else if (utf.length >= 3) break;
    else utf = "";
  }
  console.log(`@0x${idx.toString(16).padStart(7,"0")}  ascii[-40..+40]: ${asc}`);
}
