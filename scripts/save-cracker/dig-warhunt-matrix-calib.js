// dig-warhunt-matrix-calib.js
// Matrix: base=0xf8fd1, stride=267, 57120 cells. Calibrate (A,B) indexing by
// brute-forcing (width, offset, transpose) to maximize matches against ALL
// known turn-0 war pairs from the mod file. Validate on BOTH t0 saves.
"use strict";
const fs = require("fs");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const RIS_FACTIONS = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
const REL = "C:/dev/Provincia/public/faction_relationships_large.json";
function loadFactionOrder(path) {
  const txt = fs.readFileSync(path, "utf8"); const order = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) { const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/); if (cm) { order.push(cur); cur = null; } }
  }
  return order;
}
const order = loadFactionOrder(RIS_FACTIONS);
const N = order.length;
const idOf = {}; order.forEach((f, i) => idOf[f] = i);
const rels = JSON.parse(fs.readFileSync(REL, "utf8"));
const gtWarPairs = new Set();
for (const [f, arr] of Object.entries(rels)) for (const r of arr) if (r.kind === "war" && idOf[f] != null && idOf[r.to] != null) {
  gtWarPairs.add([idOf[f], idOf[r.to]].sort((a,b)=>a-b).join("|"));
}

const STRIDE = 267;
function warCells(buf) {
  // find matrix base = first key=10 base=200 cell
  let base = -1;
  for (let o = 0x4000; o + 8 <= buf.length; o++) {
    if (buf.readUInt32LE(o) === 200 && [0,100,200,400,600,850,1000].includes(buf.readUInt32LE(o+4)) && buf.readUInt32LE(o-4) === 10) { base = o; break; }
  }
  // collect war cell indices = (off-base)/STRIDE for att=600
  const idxs = [];
  let count = 0;
  for (let o = base; o + 8 <= buf.length; o += STRIDE) {
    if (buf.readUInt32LE(o) !== 200) break; // matrix ended
    if (buf.readUInt32LE(o - 4) !== 10) break;
    const att = buf.readUInt32LE(o + 4);
    if (att === 600 || att === 850 || att === 1000) idxs.push(count);
    count++;
  }
  return { base, count, idxs };
}

const buf = fs.readFileSync(SAVES_DIR + (process.argv[2] || "save_macedon t0.sav"));
const { base, count, idxs } = warCells(buf);
console.log(`base=0x${base.toString(16)} cellCount=${count} warCells=${idxs.length}`);

// Brute force width in {N, N-1, N+1} and offset 0..2, and decode A=floor((i+off)/width), B=(i+off)%width
let best = null;
for (const width of [N, N - 1, N + 1]) {
  for (let off = -2; off <= 2; off++) {
    let hits = 0; const got = new Set();
    for (const i of idxs) {
      const j = i + off; if (j < 0) continue;
      const A = Math.floor(j / width), B = j % width;
      const pair = [A, B].sort((a,b)=>a-b).join("|");
      if (gtWarPairs.has(pair)) { hits++; got.add(pair); }
    }
    if (!best || got.size > best.gotSize) best = { width, off, hits, gotSize: got.size, got };
  }
}
console.log(`\nground-truth war pairs: ${gtWarPairs.size}`);
console.log(`best: width=${best.width} off=${best.off} distinctGTpairsMatched=${best.gotSize}/${gtWarPairs.size}`);
// Show which GT pairs matched and which missed
const matched = best.got;
const missed = [...gtWarPairs].filter(p => !matched.has(p));
function name(p){const [a,b]=p.split("|").map(Number);return `${order[a]}<->${order[b]}`;}
console.log("matched:", [...matched].map(name).join(", "));
console.log("missed :", missed.map(name).join(", "));
