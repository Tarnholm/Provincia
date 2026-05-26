// dig-pop-correlate.js
// Robust correlation: across ALL Spain settlements and turn pairs, compute
// pop delta, and for a set of candidate dx offsets compute that field's value.
// Report Pearson correlation between each field and (a) pop delta, (b) pop delta
// rate. Whichever field tracks growth will stand out. Also dump per-settlement
// rows so we can eyeball.
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

// Spain player + nearby settlements with real (nonzero growth) populations.
const CITIES = ["Corduba", "Numantia", "Osca", "Scallabis", "Asturica",
  "Carthago_Nova", "Lilybaeum", "Caralis", "Palma", "Carthage", "Cirta",
  "Thapsus", "Tingi", "Syracuse", "Messana"];

function nameIdx(buf, city) {
  const u16 = Buffer.alloc(city.length * 2);
  for (let i = 0; i < city.length; i++) u16.writeUInt16LE(city.charCodeAt(i), i * 2);
  return buf.indexOf(u16);
}

// Candidate dx (float reads) and int reads to test.
const FLOAT_DX = [-133, -33, -85, -65, -49, -81, -97, -117, -125];
const INT_DX = [-129, -49, -81, -65, -97, -117, -125, -30, -36];

function pearson(xs, ys) {
  const n = xs.length; if (n < 3) return NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; num += a * b; dx += a * a; dy += b * b; }
  return num / Math.sqrt(dx * dy);
}

// Collect samples: for each city, each consecutive turn pair, record
// field@T_k (predictor) and popDelta from T_k to T_{k+1}.
const samples = []; // {city, turn, popK, delta, rate, floats:{}, ints:{}}
for (const c of CITIES) {
  for (let k = 0; k < bufs.length - 1; k++) {
    const i0 = nameIdx(bufs[k].buf, c), i1 = nameIdx(bufs[k + 1].buf, c);
    if (i0 < 0 || i1 < 0) continue;
    const popK = bufs[k].buf.readUInt32LE(i0 - 37);
    const popN = bufs[k + 1].buf.readUInt32LE(i1 - 37);
    if (popK < 100 || popK > 100000 || popN < 100 || popN > 100000) continue;
    const delta = popN - popK;
    const rec = { city: c, turn: bufs[k].tag, popK, popN, delta, rate: delta / popK, floats: {}, ints: {} };
    for (const dx of FLOAT_DX) rec.floats[dx] = bufs[k].buf.readFloatLE(i0 + dx);
    for (const dx of INT_DX) rec.ints[dx] = bufs[k].buf.readUInt32LE(i0 + dx);
    samples.push(rec);
  }
}

console.log(`samples: ${samples.length}\n`);
// Per-sample table.
console.log("city".padEnd(15), "turn", "popK".padStart(6), "delta".padStart(6), "rate%".padStart(7),
  FLOAT_DX.map(dx => (`f${dx}`).padStart(8)).join(""));
for (const r of samples) {
  console.log(r.city.padEnd(15), r.turn, String(r.popK).padStart(6), String(r.delta).padStart(6),
    (r.rate * 100).toFixed(2).padStart(7),
    FLOAT_DX.map(dx => (Number.isFinite(r.floats[dx]) && Math.abs(r.floats[dx]) < 1e6 ? r.floats[dx].toFixed(1) : "·").padStart(8)).join(""));
}

console.log("\n-- Pearson(field, popDelta) and Pearson(field, rate) --");
for (const dx of FLOAT_DX) {
  const xs = samples.map(s => s.floats[dx]).filter(Number.isFinite);
  if (xs.length !== samples.length) { console.log(`f32@${dx}: non-finite, skip`); continue; }
  console.log(`f32@${dx}: r(delta)=${pearson(samples.map(s => s.floats[dx]), samples.map(s => s.delta)).toFixed(3)}  r(rate)=${pearson(samples.map(s => s.floats[dx]), samples.map(s => s.rate)).toFixed(3)}`);
}
for (const dx of INT_DX) {
  console.log(`u32@${dx}: r(delta)=${pearson(samples.map(s => s.ints[dx]), samples.map(s => s.delta)).toFixed(3)}  r(rate)=${pearson(samples.map(s => s.ints[dx]), samples.map(s => s.rate)).toFixed(3)}`);
}
