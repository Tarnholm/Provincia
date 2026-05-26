// dig-pop-candidates.js
// Track the cleanly-incrementing candidate fields identified by the block diff
// across all Spain cities for the CLEAN turns T1->T2->T3 (T4 is a war/siege save
// with noise). Candidates: u8@-317, u16@-317, u8@-85, u16@-313, u32@-31.
// Goal: find one whose per-turn delta == population growth that turn, OR whose
// value == growth-rate%.
import { loadSave } from "./loader.js";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
// Clean turns only.
const FILES = [
  ["T1", "save_17-05-2026   Spain   Turn 1.sav"],
  ["T2", "save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav"],
  ["T3", "save_Autosave   Spain   Turn 3 End.sav"],
];
const bufs = FILES.map(([tag, f]) => ({ tag, buf: loadSave(path.join(SAVE_DIR, f)).buf }));

const CITIES = ["Corduba", "Numantia", "Osca", "Scallabis", "Asturica",
  "Carthago_Nova", "Lilybaeum", "Caralis", "Palma", "Carthage", "Cirta",
  "Thapsus", "Tingi", "Syracuse", "Messana"];

function nameIdx(buf, c) {
  const u16 = Buffer.alloc(c.length * 2);
  for (let i = 0; i < c.length; i++) u16.writeUInt16LE(c.charCodeAt(i), i * 2);
  return buf.indexOf(u16);
}

// dx -> reader
const CAND = {
  "u8@-317": (b, i) => b[i - 317],
  "u16@-318": (b, i) => b.readUInt16LE(i - 318),
  "u16@-317": (b, i) => b.readUInt16LE(i - 317),
  "u8@-85": (b, i) => b[i - 85],
  "u16@-86": (b, i) => b.readUInt16LE(i - 86),
  "u8@-313": (b, i) => b[i - 313],
  "u8@-81": (b, i) => b[i - 81],
  "u32@-31aligned": (b, i) => b.readUInt32LE(i - 31),
};

for (const c of CITIES) {
  const idxs = bufs.map(b => nameIdx(b.buf, c));
  if (idxs.some(x => x < 0)) { console.log(`${c}: missing`); continue; }
  const pops = bufs.map((b, k) => b.buf.readUInt32LE(idxs[k] - 37));
  const dPop = [pops[1] - pops[0], pops[2] - pops[1]];
  const rate = [(dPop[0] / pops[0] * 100), (dPop[1] / pops[1] * 100)];
  console.log(`\n${c}  pop ${pops.join("->")}  dPop=${dPop.join(",")}  rate%=${rate.map(r => r.toFixed(2)).join(",")}`);
  for (const [label, fn] of Object.entries(CAND)) {
    const vals = bufs.map((b, k) => fn(b.buf, idxs[k]));
    const d = [vals[1] - vals[0], vals[2] - vals[1]];
    console.log(`   ${label.padEnd(16)} = ${vals.map(v => String(v).padStart(7)).join(" ")}  d=${d.join(",")}`);
  }
}
