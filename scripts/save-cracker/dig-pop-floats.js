// dig-pop-floats.js
// Scan every byte in [name-dxBack, name) and report ONLY offsets that read as a
// "clean" float32 (finite, in [0.1, 100000], and within ~1 of an integer-ish or
// .5 value) across ALL turns. Print the per-turn float series. The growth-rate
// accumulator should be a clean float that increments smoothly.
import { loadSave } from "./loader.js";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const cityName = process.argv[2] || "Corduba";
const dxBack = parseInt(process.argv[3] || "300", 10);

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
  if (idx < 0) continue;
  turns.push({ tag, buf: s.buf, idx });
}
console.log(`city=${cityName}  clean-float scan [name-${dxBack}, name):\n`);

function cleanFloat(v) {
  return Number.isFinite(v) && Math.abs(v) >= 0.1 && Math.abs(v) <= 100000;
}

for (let dx = -dxBack; dx <= -4; dx++) {
  const fl = turns.map(t => (t.idx + dx + 4 <= t.buf.length && t.idx + dx >= 0) ? t.buf.readFloatLE(t.idx + dx) : NaN);
  if (!fl.every(cleanFloat)) continue;
  // Require it to look like a managed quantity: at least one change OR a value
  // that's a "nice" number.
  const changed = fl.some(v => Math.abs(v - fl[0]) > 1e-3);
  const series = fl.map(v => v.toFixed(3).padStart(12)).join("");
  console.log(`dx=${String(dx).padStart(4)}  ${series}  ${changed ? "<CHG" : ""}`);
}
