// dig-pop-rate-anchor.js
// Anchor everything on the POPULATION u32 (found by .indexOf(name)-37) so dx is
// stable regardless of name length. For each Spain city across T1..T4, dump the
// most promising candidate fields and compare to the OBSERVED growth this turn
// (popNext - popThis) and growth-rate.
//
// Candidates under test (dx relative to the NAME PAYLOAD index, same convention
// the other dig-pop scripts use; pop is at dx=-37):
//   u32@-129  (corr r=0.86 with delta AND rate)  <-- best so far
//   f32@-33   (float right after pop u32)
//   f32@-49, f32@-85  (other floats that tracked delta)
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

const CITIES = ["Corduba", "Numantia", "Osca", "Scallabis", "Asturica",
  "Carthago_Nova", "Lilybaeum", "Caralis", "Palma", "Carthage", "Cirta",
  "Thapsus", "Tingi", "Syracuse", "Messana"];

function nameIdx(buf, city) {
  const u16 = Buffer.alloc(city.length * 2);
  for (let i = 0; i < city.length; i++) u16.writeUInt16LE(city.charCodeAt(i), i * 2);
  return buf.indexOf(u16);
}

// For each city, build a row per turn with pop + candidates + NEXT-turn pop.
console.log("Hypothesis test: does the field at turn T predict delta(T->T+1)?\n");
console.log("city".padEnd(14), "turn pop  next  delta  rate%  | u32@-129  f@-33  f@-49  f@-85  | -129/delta");
for (const c of CITIES) {
  for (let k = 0; k < bufs.length; k++) {
    const i = nameIdx(bufs[k].buf, c);
    if (i < 0) continue;
    const pop = bufs[k].buf.readUInt32LE(i - 37);
    if (pop < 100 || pop > 100000) continue;
    let next = null, delta = null, rate = null;
    if (k < bufs.length - 1) {
      const iN = nameIdx(bufs[k + 1].buf, c);
      if (iN >= 0) {
        next = bufs[k + 1].buf.readUInt32LE(iN - 37);
        if (next >= 100 && next <= 100000) { delta = next - pop; rate = delta / pop; }
      }
    }
    const u129 = bufs[k].buf.readUInt32LE(i - 129);
    const f33 = bufs[k].buf.readFloatLE(i - 33);
    const f49 = bufs[k].buf.readFloatLE(i - 49);
    const f85 = bufs[k].buf.readFloatLE(i - 85);
    const ratio = (delta && delta !== 0) ? (u129 / delta).toFixed(1) : "·";
    console.log(
      c.padEnd(14),
      bufs[k].tag,
      String(pop).padStart(5),
      (next == null ? "·" : String(next)).padStart(5),
      (delta == null ? "·" : String(delta)).padStart(5),
      (rate == null ? "·" : (rate * 100).toFixed(2)).padStart(6),
      "|",
      String(u129).padStart(7),
      f33.toFixed(0).padStart(6),
      f49.toFixed(0).padStart(6),
      f85.toFixed(0).padStart(6),
      "|",
      ratio.padStart(8),
    );
  }
  console.log("");
}
