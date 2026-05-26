// dig-pop-turn-diff.js
// For a city, locate its UTF-16 name in each of N turn-saves, then dump the
// byte window [name-dxBack, name) for each turn SIDE BY SIDE, with both u32 and
// float32 interpretations, so growth fields that increment each turn pop out.
import { loadSave, hex, ascii } from "./loader.js";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const cityName = process.argv[2] || "Corduba";
const dxBack = parseInt(process.argv[3] || "140", 10);

// Spain turn series (small saves, controlled).
const FILES = [
  ["T1", "save_17-05-2026   Spain   Turn 1.sav"],
  ["T2", "save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav"],
  ["T3", "save_Autosave   Spain   Turn 3 End.sav"],
  ["T4", "save_Autosave   Spain   Turn 4.sav"],
];

const u16 = Buffer.alloc(cityName.length * 2);
for (let i = 0; i < cityName.length; i++) u16.writeUInt16LE(cityName.charCodeAt(i), i * 2);

const turns = [];
for (const [tag, f] of FILES) {
  const s = loadSave(path.join(SAVE_DIR, f));
  const idx = s.buf.indexOf(u16);
  if (idx < 0) { console.log(`${tag}: name not found in ${f}`); continue; }
  turns.push({ tag, buf: s.buf, idx });
}
console.log(`city=${cityName}  turns: ${turns.map(t => t.tag).join(",")}`);
console.log(`name offsets: ${turns.map(t => t.tag + "=0x" + t.idx.toString(16)).join("  ")}\n`);

// For each dx from -dxBack to -1, print the u32 (and float) value per turn.
// Only print rows where at least one turn's value differs from T1 (changed),
// OR the value looks pop-like (>100).
console.log("dx".padStart(5), turns.map(t => (`u32_${t.tag}`).padStart(12)).join(""), "   |", turns.map(t => (`f32_${t.tag}`).padStart(10)).join(""));
for (let dx = -dxBack; dx <= -4; dx++) {
  const u = turns.map(t => (t.idx + dx + 4 <= t.buf.length && t.idx + dx >= 0) ? t.buf.readUInt32LE(t.idx + dx) : null);
  const fl = turns.map(t => (t.idx + dx + 4 <= t.buf.length && t.idx + dx >= 0) ? t.buf.readFloatLE(t.idx + dx) : null);
  const changed = u.some(v => v !== u[0]);
  const popLike = u.some(v => v != null && v >= 100 && v <= 100000);
  const fLike = fl.some(v => v != null && v > 0.01 && v < 1e6 && Number.isFinite(v));
  if (!changed && !popLike) continue;
  const uStr = u.map(v => String(v).padStart(12)).join("");
  const fStr = fl.map(v => (v == null ? "" : (Number.isFinite(v) ? v.toFixed(2) : "nan")).padStart(10)).join("");
  const mark = changed ? " <CHG" : "";
  console.log(String(dx).padStart(5), uStr, "   |", fStr, mark);
}
