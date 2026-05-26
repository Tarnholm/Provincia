// dig-pop-acc-detail.js
// Detail view of the two parallel growing fields at dx=-17 and dx=-13 (plus -12)
// for several cities across all 4 turns. Compare their per-turn delta to pop and
// pop delta to figure out what they encode (fixed-point pop? cumulative tax?
// cumulative income? growth accumulator?).
import { loadSave, hex } from "./loader.js";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const FILES = [
  ["T1", "save_17-05-2026   Spain   Turn 1.sav"],
  ["T2", "save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav"],
  ["T3", "save_Autosave   Spain   Turn 3 End.sav"],
  ["T4", "save_Autosave   Spain   Turn 4.sav"],
];
const bufs = FILES.map(([tag, f]) => ({ tag, buf: loadSave(path.join(SAVE_DIR, f)).buf }));

function nameIdx(buf, city) {
  const u16 = Buffer.alloc(city.length * 2);
  for (let i = 0; i < city.length; i++) u16.writeUInt16LE(city.charCodeAt(i), i * 2);
  return buf.indexOf(u16);
}

const CITIES = process.argv.slice(2);
if (!CITIES.length) CITIES.push("Corduba", "Numantia", "Osca", "Carthage");

for (const c of CITIES) {
  console.log(`\n=== ${c} ===`);
  console.log("turn  pop   dPop | u32@-17    d-17  | u32@-13    d-13 | u32@-12  d-12 | (-17)/pop  (-13)/pop");
  let prevPop = null, p17 = null, p13 = null, p12 = null;
  for (let k = 0; k < bufs.length; k++) {
    const i = nameIdx(bufs[k].buf, c);
    if (i < 0) { console.log(`${bufs[k].tag}: not found`); continue; }
    const pop = bufs[k].buf.readUInt32LE(i - 37);
    const v17 = bufs[k].buf.readUInt32LE(i - 17);
    const v13 = bufs[k].buf.readUInt32LE(i - 13);
    const v12 = bufs[k].buf.readUInt32LE(i - 12);
    const dPop = prevPop == null ? "·" : String(pop - prevPop);
    const d17 = p17 == null ? "·" : String(v17 - p17);
    const d13 = p13 == null ? "·" : String(v13 - p13);
    const d12 = p12 == null ? "·" : String(v12 - p12);
    console.log(
      bufs[k].tag,
      String(pop).padStart(5),
      dPop.padStart(5),
      "|",
      String(v17).padStart(9), d17.padStart(6),
      "|",
      String(v13).padStart(9), d13.padStart(6),
      "|",
      String(v12).padStart(6), d12.padStart(5),
      "|",
      (v17 / pop).toFixed(3).padStart(8),
      (v13 / pop).toFixed(3).padStart(8),
    );
    prevPop = pop; p17 = v17; p13 = v13; p12 = v12;
  }
}
