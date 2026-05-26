// dig-pop-rate-halfpct.js
// RTW growth is internally in 0.5% steps. The growth shown for a settlement at
// the START of turn T produces the delta observed T->T+1. So the field stored in
// save_T should equal round(rate(T->T+1) / 0.5).
//
// Search a WIDE window on BOTH sides of the name (the record continues after the
// name with default_set building lists, but the stats fields could be after too)
// for ANY byte / i8 / u16 whose value at a single consistent dx equals the
// half-percent rate for ALL cities. Also report near-misses (matches >= 12/15).
import { loadSave } from "./loader.js";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
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

// Build samples for T1 (predict T1->T2) and T2 (predict T2->T3).
const samp = [];
for (let k = 0; k < 2; k++) {
  for (const c of CITIES) {
    const i = nameIdx(bufs[k].buf, c), iN = nameIdx(bufs[k + 1].buf, c);
    if (i < 0 || iN < 0) continue;
    const pop = bufs[k].buf.readUInt32LE(i - 37);
    const popN = bufs[k + 1].buf.readUInt32LE(iN - 37);
    if (pop < 100 || pop > 100000) continue;
    const ratePct = (popN - pop) / pop * 100;
    samp.push({ c, k, buf: bufs[k].buf, i, pop, ratePct, half: Math.round(ratePct / 0.5) });
  }
}
console.log(`samples=${samp.length} (T1 and T2 predictions)\n`);
console.log("Targets (half-% units):", samp.filter(s => s.k === 0).map(s => `${s.c.slice(0, 4)}=${s.half}`).join(" "));

const LO = -400, HI = 400;
const readers = [
  ["u8", (b, o) => b[o]],
  ["i8", (b, o) => { const v = b[o]; return v > 127 ? v - 256 : v; }],
];
console.log("\n-- exact + near matches for byte == half-% rate --");
let best = 0, bestInfo = "";
for (let dx = LO; dx <= HI; dx++) {
  for (const [enc, rd] of readers) {
    let ok = 0, tot = 0;
    for (const s of samp) {
      const o = s.i + dx;
      if (o < 0 || o + 1 > s.buf.length) { ok = -999; break; }
      tot++;
      if (rd(s.buf, o) === s.half) ok++;
    }
    if (ok < 0) continue;
    if (ok === tot && tot === samp.length) {
      console.log(`*** PERFECT dx=${dx} ${enc}: matches all ${tot}`);
    }
    if (ok > best) { best = ok; bestInfo = `dx=${dx} ${enc} (${ok}/${tot})`; }
    if (ok >= samp.length - 3 && ok >= 12) {
      const vals = samp.filter(s => s.k === 0).map(s => s.buf[s.i + dx]).join(",");
      console.log(`  near dx=${dx} ${enc}: ${ok}/${tot}  T1-bytes=[${vals}]`);
    }
  }
}
console.log(`\nBest overall: ${bestInfo}`);
