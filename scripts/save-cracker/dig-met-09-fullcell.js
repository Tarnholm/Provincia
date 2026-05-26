// dig-met-09-fullcell.js
// Dump the FULL matrix cell (all 267 bytes / ~66 u32 words) for the player row
// (carthage vs B) for a few B factions: known-met neighbors vs known-unmet
// far-flung factions. If ANY word in the cell distinguishes met from unmet
// (binary or a small flag), it'll show up as a column that's constant for the
// met group and different for the unmet group.
"use strict";
const fs = require("fs");
const RIS_FACTIONS = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
function loadOrder(p) { const t = fs.readFileSync(p, "utf8"); const o = []; let c = null; for (const l of t.split(/\r?\n/)) { const m = l.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/); if (m) { c = m[1]; continue; } if (c) { const cm = l.match(/^\s*"culture":\s*"([a-z_]+)"/); if (cm) { o.push(c); c = null; } } } return o; }
const order = loadOrder(RIS_FACTIONS);
const N = order.length;

function locate(buf) {
  const okAtt = (v) => v >= 0 && v <= 1000;
  const limit = Math.min(buf.length - 64, 0x400000);
  for (let p = 0x4000; p < limit; p++) {
    if (buf.readUInt32LE(p) !== 0) continue;
    const key = buf.readUInt32LE(p + 4);
    if (key < 1 || key > 64) continue;
    if (buf.readUInt32LE(p + 8) !== 200) continue;
    if (!okAtt(buf.readUInt32LE(p + 12))) continue;
    if (buf.readUInt32LE(p + 16) !== 2) continue;
    for (let s = 80; s <= 400; s++) {
      if (p + s + 12 >= buf.length) break;
      if (buf.readUInt32LE(p + s) === 0 && buf.readUInt32LE(p + s + 4) === key && buf.readUInt32LE(p + s + 8) === 200) {
        let good = 0; for (let k = 0; k < N + 2; k++) { const o = p + k * s; if (o + 12 >= buf.length) break; if (buf.readUInt32LE(o) === 0 && buf.readUInt32LE(o + 4) === key && buf.readUInt32LE(o + 8) === 200) good++; else break; }
        if (good >= N) return { cellStart: p, stride: s, key };
      }
    }
  }
  return null;
}

const save = process.argv[2] || "save_t0.sav";
const buf = fs.readFileSync(SAVES_DIR + save);
const loc = locate(buf);
console.log(`### ${save}  cellStart=0x${loc.cellStart.toString(16)} stride=${loc.stride} key=${loc.key}`);
// calibrate C by symmetry
const att = (idx) => { const o = loc.cellStart + idx * loc.stride + 12; return o + 4 <= buf.length ? buf.readUInt32LE(o) : null; };
let bestC = 0, best = -1;
for (let C = -3; C <= 3; C++) { let sym = 0, tot = 0; for (let A = 1; A < N; A += 3) for (let B = A + 1; B < N; B += 3) { const v1 = att(A * N + B + C), v2 = att(B * N + A + C); if (v1 == null || v2 == null) continue; tot++; if (v1 === v2) sym++; } const sc = tot ? sym / tot : 0; if (sc > best) { best = sc; bestC = C; } }
const C = bestC;
console.log(`C=${C} sym=${best.toFixed(3)} N=${N}\n`);

const A = order.indexOf("carthage");
// Known-met-at-T0 (carthage neighbors / contacts) vs known-unmet (far east).
const met = ["gades", "numidia", "spain", "romans_julii", "slave"].filter(x => order.includes(x));
const unmet = ["bactria", "saka", "mauryan", "parni", "seleucid", "armenia"].filter(x => order.includes(x));
function cellWords(B) {
  const o = loc.cellStart + (A * N + B + C) * loc.stride;
  const w = [];
  for (let j = 0; j + 4 <= loc.stride && o + j + 4 <= buf.length; j += 4) w.push(buf.readUInt32LE(o + j));
  return w;
}
function dump(label, list) {
  console.log(`=== ${label} ===`);
  for (const nm of list) {
    const B = order.indexOf(nm);
    const w = cellWords(B);
    // print only words that differ from a "pure default" template, plus key offsets
    console.log(`${nm.padEnd(14)} att(+12)=${w[3]} flag(+16)=${w[4]} ctr(+20)=${w[5]} | nonzero words: ` +
      w.map((v, i) => v !== 0 ? `+${i * 4}:${v}` : null).filter(Boolean).join(" "));
  }
  console.log("");
}
dump("MET neighbors", met);
dump("UNMET far-flung", unmet);
