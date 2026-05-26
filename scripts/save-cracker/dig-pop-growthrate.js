// dig-pop-growthrate.js
// We computed each city's observed growth rate (pop delta / pop). Now scan the
// whole stats block for a float OR scaled-int that matches that rate. Test:
//   - small float (0.005 .. 0.10) = fractional growth rate
//   - float ×100 = percentage (0.5 .. 10.0)
//   - int = growth rate in 0.5% units, etc.
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

function nameIdx(buf, city) {
  const u16 = Buffer.alloc(city.length * 2);
  for (let i = 0; i < city.length; i++) u16.writeUInt16LE(city.charCodeAt(i), i * 2);
  return buf.indexOf(u16);
}

const CITIES = ["Corduba", "Numantia", "Osca", "Scallabis", "Asturica"];

// Compute observed growth rate T1->T2 for each city = (pop2-pop1)/pop1.
const obs = {};
for (const c of CITIES) {
  const i1 = nameIdx(bufs[0].buf, c), i2 = nameIdx(bufs[1].buf, c);
  const p1 = bufs[0].buf.readUInt32LE(i1 - 37), p2 = bufs[1].buf.readUInt32LE(i2 - 37);
  obs[c] = { p1, p2, delta: p2 - p1, rate: (p2 - p1) / p1 };
  console.log(`${c}: pop ${p1}->${p2} delta=${p2 - p1} rate=${((p2 - p1) / p1 * 100).toFixed(3)}%`);
}
console.log("");

// For each city in T1, scan [name-300, name) for a float whose value matches
// rate, rate*100, rate*1000, delta, etc.
const dxBack = 300;
for (const c of CITIES) {
  const buf = bufs[0].buf;
  const idx = nameIdx(buf, c);
  const r = obs[c].rate;
  const targets = [
    ["rate", r], ["rate*100", r * 100], ["rate*1000", r * 1000],
    ["delta", obs[c].delta],
  ];
  const found = [];
  for (let dx = -dxBack; dx <= -4; dx++) {
    const o = idx + dx;
    if (o < 0 || o + 4 > buf.length) continue;
    const fv = buf.readFloatLE(o);
    const iv = buf.readUInt32LE(o);
    for (const [label, t] of targets) {
      if (t === 0) continue;
      if (Number.isFinite(fv) && Math.abs(fv - t) < Math.max(0.01, Math.abs(t) * 0.02)) found.push(`dx=${dx} f32=${fv.toFixed(4)}≈${label}(${t.toFixed(4)})`);
      if (iv === Math.round(t) && t > 1) found.push(`dx=${dx} u32=${iv}≈${label}`);
    }
  }
  console.log(`${c} (rate=${(r * 100).toFixed(3)}%):`);
  for (const ff of found) console.log("   " + ff);
  if (!found.length) console.log("   (no float/int match)");
}
