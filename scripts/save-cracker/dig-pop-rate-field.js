// dig-pop-rate-field.js
// Each Spain city has a clean, stable growth rate in 0.5% steps. Find a stored
// field that equals it. Compute per-city rate (rounded to nearest 0.5%), derive
// candidate encodings (rate as int*10, int*2, float, etc.) and scan the block
// for an offset that matches across ALL cities (consistent dx).
import { loadSave } from "./loader.js";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
// Use T1 save; predict T1->T2 growth.
const T1 = loadSave(path.join(SAVE_DIR, "save_17-05-2026   Spain   Turn 1.sav")).buf;
const T2 = loadSave(path.join(SAVE_DIR, "save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav")).buf;

const CITIES = ["Corduba", "Numantia", "Osca", "Scallabis", "Carthago_Nova",
  "Lilybaeum", "Caralis", "Palma", "Carthage", "Cirta", "Thapsus", "Tingi",
  "Syracuse", "Messana"];

function nameIdx(buf, city) {
  const u16 = Buffer.alloc(city.length * 2);
  for (let i = 0; i < city.length; i++) u16.writeUInt16LE(city.charCodeAt(i), i * 2);
  return buf.indexOf(u16);
}

// Per city: pop, delta, rate%, rate in 0.5% units.
const cd = [];
for (const c of CITIES) {
  const i1 = nameIdx(T1, c), i2 = nameIdx(T2, c);
  if (i1 < 0 || i2 < 0) continue;
  const p1 = T1.readUInt32LE(i1 - 37), p2 = T2.readUInt32LE(i2 - 37);
  const ratePct = (p2 - p1) / p1 * 100;
  const rateHalf = Math.round(ratePct / 0.5) * 0.5; // snapped to 0.5%
  cd.push({ c, idx: i1, p1, delta: p2 - p1, ratePct, rateHalf });
}
console.log("city           pop  delta  rate%   snapped");
for (const r of cd) console.log(r.c.padEnd(14), String(r.p1).padStart(5), String(r.delta).padStart(5), r.ratePct.toFixed(3).padStart(7), String(r.rateHalf).padStart(6));

// Scan: for each dx in [-300,-4], check if there's a single integer/float
// encoding that matches each city's snapped rate. Encodings tested:
//   u8 == rateHalf*2 (0.5%->1), u8 == rateHalf*10/5 ... we'll test many factors.
const dxBack = 300;
const factors = [
  ["u8*0.5", (b) => b * 0.5],
  ["u8*0.25", (b) => b * 0.25],
  ["u8*0.1", (b) => b * 0.1],
  ["u8*1", (b) => b * 1],
  ["i8*0.5", (b) => (b > 127 ? b - 256 : b) * 0.5],
];
console.log("\n-- searching for a dx whose u8 encodes the snapped rate for ALL cities --");
for (let dx = -dxBack; dx <= -1; dx++) {
  for (const [label, fn] of factors) {
    let ok = true;
    for (const r of cd) {
      const b = T1[r.idx + dx];
      if (Math.abs(fn(b) - r.rateHalf) > 0.26) { ok = false; break; }
    }
    if (ok) {
      const vals = cd.map(r => T1[r.idx + dx]).join(",");
      console.log(`  dx=${dx} ${label}: bytes=[${vals}]`);
    }
  }
}

// Also test float at each dx == rate fraction (rate/100) within tolerance.
console.log("\n-- searching for a dx whose float == rate/100 (fractional growth) --");
for (let dx = -dxBack; dx <= -4; dx++) {
  let ok = true;
  for (const r of cd) {
    const f = T1.readFloatLE(r.idx + dx);
    if (!Number.isFinite(f) || Math.abs(f - r.rateHalf / 100) > 0.003) { ok = false; break; }
  }
  if (ok) console.log(`  dx=${dx}: floats=[${cd.map(r => T1.readFloatLE(r.idx + dx).toFixed(4)).join(",")}]`);
}
