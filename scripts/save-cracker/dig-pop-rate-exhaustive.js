// dig-pop-rate-exhaustive.js
// Exhaustive single-dx search for the stored growth-rate. For each city the
// "true" growth-rate% is the NEXT-turn delta / pop (stable per city in Spain).
// We then scan EVERY dx in a wide window around pop and test whether the byte(s)
// at that dx, under some encoding, equal the true rate for ALL cities at the
// SAME dx. That cross-city consistency requirement kills false positives.
//
// Encodings tested at each dx:
//   u8 with scale s in {0.1,0.25,0.5,1}        (rate% = u8*s)
//   i8 same scales (allow negative growth)
//   u16 with scale s in {0.01,0.1}             (rate% = u16*s)
//   f32 == rate% , rate%/100 , rate%*10
import { loadSave } from "./loader.js";
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

// Build samples: (turn k's buffer, name index, true rate% from k->k+1).
const samp = [];
for (const c of CITIES) {
  for (let k = 0; k < bufs.length - 1; k++) {
    const i = nameIdx(bufs[k].buf, c), iN = nameIdx(bufs[k + 1].buf, c);
    if (i < 0 || iN < 0) continue;
    const pop = bufs[k].buf.readUInt32LE(i - 37);
    const popN = bufs[k + 1].buf.readUInt32LE(iN - 37);
    if (pop < 100 || pop > 100000 || popN < 100 || popN > 100000) continue;
    samp.push({ c, buf: bufs[k].buf, i, pop, ratePct: (popN - pop) / pop * 100 });
  }
}
console.log(`samples=${samp.length}\n`);

const WIN_LO = -260, WIN_HI = 8;
const TOL = 0.30; // percent

function tryDx(dx) {
  const hits = [];
  // u8 / i8 scales
  for (const [enc, read, scales] of [
    ["u8", (b, o) => b[o], [0.1, 0.25, 0.5, 1]],
    ["i8", (b, o) => { const v = b[o]; return v > 127 ? v - 256 : v; }, [0.1, 0.25, 0.5, 1]],
    ["u16", (b, o) => b.readUInt16LE(o), [0.01, 0.1]],
  ]) {
    for (const s of scales) {
      let ok = samp.length > 0;
      for (const sm of samp) {
        const o = sm.i + dx;
        if (o < 0 || o + 4 > sm.buf.length) { ok = false; break; }
        const v = read(sm.buf, o) * s;
        if (Math.abs(v - sm.ratePct) > TOL) { ok = false; break; }
      }
      if (ok) hits.push(`${enc}*${s}`);
    }
  }
  // f32 forms
  for (const [enc, mul] of [["f32", 1], ["f32/100", 100], ["f32*10", 0.1]]) {
    let ok = samp.length > 0;
    for (const sm of samp) {
      const o = sm.i + dx;
      if (o < 0 || o + 4 > sm.buf.length) { ok = false; break; }
      const v = sm.buf.readFloatLE(o) * mul;
      if (!Number.isFinite(v) || Math.abs(v - sm.ratePct) > TOL) { ok = false; break; }
    }
    if (ok) hits.push(enc);
  }
  return hits;
}

let any = false;
for (let dx = WIN_LO; dx <= WIN_HI; dx++) {
  const hits = tryDx(dx);
  if (hits.length) {
    any = true;
    const vals = samp.slice(0, 6).map(sm => {
      const o = sm.i + dx;
      return `${sm.c.slice(0, 4)}:${sm.buf[o]}`;
    }).join(" ");
    console.log(`dx=${dx}  [${hits.join(", ")}]  sample-bytes: ${vals}`);
  }
}
if (!any) console.log("No single dx encodes the growth-rate consistently across all cities.");

// Also: maybe rate is NOT stored but ACCUMULATED-growth is. The fractional carry
// would be (pop*rate) mod 1 building up. Test: is there a u32 that increments by
// ~ delta each turn? We look for a field F where F(T+1)-F(T) ≈ k*delta with
// constant k, OR resets. Scan for "tracks pop but at finer scale".
console.log("\n-- accumulator search: field that grows ~proportional to pop each turn --");
const ACC = ["Corduba", "Osca", "Numantia", "Messana"];
for (let dx = WIN_LO; dx <= WIN_HI; dx++) {
  let consistent = true; const ratios = [];
  for (const c of ACC) {
    const seq = [];
    for (let k = 0; k < bufs.length; k++) {
      const i = nameIdx(bufs[k].buf, c); if (i < 0) { consistent = false; break; }
      const o = i + dx; if (o < 0 || o + 4 > bufs[k].buf.length) { consistent = false; break; }
      seq.push(bufs[k].buf.readUInt32LE(o));
    }
    if (!consistent) break;
    // must be monotonic non-decreasing and change every turn
    let mono = true, changes = 0;
    for (let k = 1; k < seq.length; k++) { if (seq[k] < seq[k - 1]) mono = false; if (seq[k] !== seq[k - 1]) changes++; }
    if (!mono || changes < 2) { consistent = false; break; }
    // ratio of its delta to pop delta
    const pop0 = bufs[0].buf.readUInt32LE(nameIdx(bufs[0].buf, c) - 37);
    const popDelta = bufs[1].buf.readUInt32LE(nameIdx(bufs[1].buf, c) - 37) - pop0;
    ratios.push((seq[1] - seq[0]) / (popDelta || 1));
  }
  if (consistent) console.log(`dx=${dx}: monotonic-growing u32 in all ${ACC.length} cities; deltaF/deltaPop ratios=[${ratios.map(r => r.toFixed(2)).join(",")}]`);
}
