// dig-warhunt-matrix.js
// The diplomacy attitude table is an N×N faction-relationship matrix
// (239 factions => ~57120 records). Each record: key=10, base=200,
// attitude(DS), ... Verify it's a contiguous matrix with fixed stride, find
// the stride, and decode [A][B] indexing. Then check the known turn-0 wars:
//   antigonid(5) <-> epirus(98), galatians(102)
//   seleucid(7) <-> bithynia(46), seleucid_rebels(235), seleucid_rebels2(236)
"use strict";
const fs = require("fs");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const RIS_FACTIONS = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
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
console.log(`N (faction count) = ${N}`);
const buf = fs.readFileSync(SAVES_DIR + (process.argv[2] || "save_macedon t0.sav"));

// Find all key=10 base=200 records (the matrix cells). Capture base offset+att.
const cells = [];
for (let o = 0x4000; o + 8 <= buf.length; o++) {
  if (buf.readUInt32LE(o) !== 200) continue;
  if (![0,100,200,400,600,850,1000].includes(buf.readUInt32LE(o + 4))) continue;
  if (buf.readUInt32LE(o - 4) !== 10) continue;
  cells.push({ base: o, att: buf.readUInt32LE(o + 4) });
}
console.log(`matrix cells: ${cells.length}`);
// stride histogram
const sp = {};
for (let i = 1; i < cells.length; i++) { const d = cells[i].base - cells[i-1].base; sp[d] = (sp[d]||0)+1; }
console.log("stride histogram (top):", Object.entries(sp).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>`${k}:${v}`).join("  "));
console.log(`first cell @0x${cells[0].base.toString(16)}, last @0x${cells[cells.length-1].base.toString(16)}`);

// If contiguous matrix: cell index i corresponds to (A,B). Test row-major:
// A = floor(i / (N-1or N)), B = i mod ...  Try assuming N or N-1 per row.
// First, find rows by detecting where att resets / structure. Simpler: map the
// 476 war cells to their linear index and see if (idx) decodes to known pairs.
const war = cells.map((c,i)=>({i,...c})).filter(c=>c.att===600);
console.log(`\nwar cells (att=600): ${war.length}`);
// Try several row widths and check if antigonid(5) row contains epirus(98)/galatians(102)
function decode(width, diagIncluded) {
  // returns map of warpairs as "A|B"
  const pairs = new Set();
  for (const c of war) {
    const A = Math.floor(c.i / width);
    const B = c.i % width;
    pairs.add(`${A}|${B}`);
  }
  return pairs;
}
for (const width of [N, N-1]) {
  const pairs = decode(width);
  const checks = [["antigonid",5,"epirus",98],["antigonid",5,"galatians",102],["seleucid",7,"bithynia",46],["seleucid",7,"seleucid_rebels",235]];
  let hits = 0;
  const detail = [];
  for (const [an,a,bn,b] of checks) {
    const f1 = pairs.has(`${a}|${b}`) || pairs.has(`${b}|${a}`);
    if (f1) hits++;
    detail.push(`${an}<->${bn}:${f1?"YES":"no"}`);
  }
  console.log(`  width=${width}: known-war hits ${hits}/4  [${detail.join(", ")}]`);
}
