// dig-pop-block-diff.js
// Byte-exact diff of a settlement's stats block across consecutive turns.
// Anchor on pop u32 (name-37). Print, for every dx in [-600, +4], the byte
// values across T1..T4 and flag the ones that CHANGE. This bounds where any
// growth/accumulator state can live. We then highlight fields whose change
// pattern correlates with population growth.
import { loadSave, hex, ascii } from "./loader.js";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const FILES = [
  ["T1", "save_17-05-2026   Spain   Turn 1.sav"],
  ["T2", "save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav"],
  ["T3", "save_Autosave   Spain   Turn 3 End.sav"],
  ["T4", "save_Autosave   Spain   Turn 4.sav"],
];
const bufs = FILES.map(([tag, f]) => ({ tag, buf: loadSave(path.join(SAVE_DIR, f)).buf }));

const city = process.argv[2] || "Corduba";
const LO = parseInt(process.argv[3] || "-600", 10);
const HI = parseInt(process.argv[4] || "4", 10);

function nameIdx(buf, c) {
  const u16 = Buffer.alloc(c.length * 2);
  for (let i = 0; i < c.length; i++) u16.writeUInt16LE(c.charCodeAt(i), i * 2);
  return buf.indexOf(u16);
}

const idxs = bufs.map(b => nameIdx(b.buf, city));
console.log(`${city}  name offsets: ${idxs.map((x, k) => bufs[k].tag + "=0x" + x.toString(16)).join("  ")}`);
console.log(`pop@-37: ${idxs.map((x, k) => bufs[k].buf.readUInt32LE(x - 37)).join(" -> ")}\n`);

// Print only dx where the BYTE differs across turns.
console.log("dx     T1   T2   T3   T4   |  as-u32 (aligned reads start here)");
const changedDx = [];
for (let dx = LO; dx <= HI; dx++) {
  const vals = bufs.map((b, k) => (idxs[k] + dx >= 0 && idxs[k] + dx < b.buf.length) ? b.buf[idxs[k] + dx] : null);
  if (vals.some(v => v == null)) continue;
  if (vals.every(v => v === vals[0])) continue; // unchanged byte
  changedDx.push(dx);
  console.log(String(dx).padStart(4), vals.map(v => String(v).padStart(4)).join(" "));
}

console.log(`\n${changedDx.length} changed bytes. Grouping into u32 fields (changed dx that are 4-aligned starts):`);
// Group consecutive changed bytes into runs, then interpret each run start as u32.
const runs = [];
for (const dx of changedDx) {
  if (runs.length && dx === runs[runs.length - 1].end + 1) runs[runs.length - 1].end = dx;
  else runs.push({ start: dx, end: dx });
}
for (const r of runs) {
  // For a run, interpret the u32 at its aligned start.
  const start = r.start;
  const u32s = bufs.map((b, k) => (idxs[k] + start + 4 <= b.buf.length) ? b.buf.readUInt32LE(idxs[k] + start) : null);
  const f32s = bufs.map((b, k) => (idxs[k] + start + 4 <= b.buf.length) ? b.buf.readFloatLE(idxs[k] + start) : null);
  console.log(`  dx ${r.start}..${r.end} (${r.end - r.start + 1}B): u32=[${u32s.join(", ")}]  f32=[${f32s.map(f => Number.isFinite(f) && Math.abs(f) < 1e7 ? f.toFixed(2) : "·").join(", ")}]`);
}
