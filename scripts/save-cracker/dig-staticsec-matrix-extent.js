// dig-staticsec-matrix-extent.js
// GOAL: Determine whether the documented "15.25 MB static tile-grid section"
// IS the N×N attitude matrix, or a distinct region.
//   (1) Pin exact byte extent of the attitude matrix in save_macedon t0.sav.
//   (2) Compare to the tile-grid extent documented in RESEARCH.md (ARR_START=0xf8fd2,
//       stride 267, 240×238, end 0xf84632) and body-root end 0x633bb3.
//   (3) Decode per-cell extra fields (+0 zero, +4 key, +8 baseline200, +12 attitude,
//       +16 flag, +20 counter, +24 aggression) with field histograms.
//   (4) Cross-validate attitudes vs descr_strat faction_relationships ground truth.
const fs = require("fs");
const path = require("path");
const DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const SAVE = DIR + "save_macedon t0.sav";
const ORDER = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
const STRAT = "C:\\RIS\\RIS\\data\\world\\maps\\campaign\\imperial_campaign\\descr_strat.txt";

function loadOrder(p) {
  const txt = fs.readFileSync(p, "utf8");
  const order = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) { const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/); if (cm) { order.push(cur); cur = null; } }
  }
  return order;
}

function locateMatrix(buf, N) {
  const okAtt = v => v >= 0 && v <= 1000;
  for (let p = 0x4000; p < buf.length - 64; p++) {
    if (buf.readUInt32LE(p) !== 0) continue;
    const key = buf.readUInt32LE(p + 4);
    if (key < 1 || key > 64) continue;
    if (buf.readUInt32LE(p + 8) !== 200) continue;
    if (!okAtt(buf.readUInt32LE(p + 12))) continue;
    if (buf.readUInt32LE(p + 16) !== 2) continue;
    const runFor = (s) => { let g = 0; for (let k = 0; k < N + 2; k++) { const o = p + k * s; if (o + 12 >= buf.length) break; if (buf.readUInt32LE(o) === 0 && buf.readUInt32LE(o + 4) === key && buf.readUInt32LE(o + 8) === 200) g++; else break; } return g; };
    for (let s = 80; s <= 400; s++) {
      if (p + s + 12 >= buf.length) break;
      if (buf.readUInt32LE(p + s) === 0 && buf.readUInt32LE(p + s + 4) === key && buf.readUInt32LE(p + s + 8) === 200) {
        if (runFor(s) >= N) return { cellStart: p, base: p + 8, stride: s, key };
      }
    }
  }
  return null;
}

const buf = fs.readFileSync(SAVE);
const order = loadOrder(ORDER);
const N = order.length;
console.log(`SAVE: ${path.basename(SAVE)}  size=${buf.length} (0x${buf.length.toString(16)})  N=${N}`);

const m = locateMatrix(buf, N);
console.log(`\n=== MATRIX LOCATION ===`);
console.log(`cellStart (rec0) = 0x${m.cellStart.toString(16)}`);
console.log(`base (rec0+8)    = 0x${m.base.toString(16)}`);
console.log(`stride           = ${m.stride}`);
console.log(`key              = ${m.key}`);
const cells = N * N;
const matStart = m.cellStart;
const matEnd = m.cellStart + cells * m.stride; // exclusive
const matBytes = cells * m.stride;
console.log(`cells (N*N)      = ${cells}`);
console.log(`matrix start     = 0x${matStart.toString(16)}`);
console.log(`matrix end (excl)= 0x${matEnd.toString(16)}`);
console.log(`matrix size      = ${matBytes} bytes = ${(matBytes/1048576).toFixed(3)} MB`);

console.log(`\n=== RESEARCH.md documented "tile-grid / static section" ===`);
const ARR_START = 0xf8fd2, TGstride = 267, W = 240, H = 238;
const tgCells = W * H;
const tgEnd = ARR_START + tgCells * TGstride;
console.log(`ARR_START        = 0x${ARR_START.toString(16)} (doc: rec0 of tile-grid)`);
console.log(`stride           = ${TGstride}  dims ${W}x${H} = ${tgCells} cells`);
console.log(`tile-grid end    = 0x${tgEnd.toString(16)}  size=${(tgCells*TGstride/1048576).toFixed(3)} MB`);
const BODYROOT_END = 0x633bb3;
console.log(`body-root end    = 0x${BODYROOT_END.toString(16)} (doc: header-declared size end)`);

console.log(`\n=== OVERLAP TEST: matrix vs tile-grid ===`);
console.log(`matrix base 0x${m.base.toString(16)} vs doc ARR_START+8? doc cellStart=0x${ARR_START.toString(16)}, matrix cellStart=0x${matStart.toString(16)}, delta=${matStart - ARR_START}`);
const overlapStart = Math.max(matStart, ARR_START);
const overlapEnd = Math.min(matEnd, tgEnd);
const overlap = Math.max(0, overlapEnd - overlapStart);
console.log(`overlap region   = 0x${overlapStart.toString(16)}..0x${overlapEnd.toString(16)} = ${(overlap/1048576).toFixed(3)} MB`);
console.log(`overlap / matrix = ${(100*overlap/matBytes).toFixed(1)}%`);
console.log(`body-root end falls inside matrix? ${BODYROOT_END >= matStart && BODYROOT_END < matEnd} (record #${Math.floor((BODYROOT_END - matStart)/m.stride)})`);

console.log(`\n=== PER-CELL FIELD DECODE (first 10 u32 fields, all ${cells} cells) ===`);
// Decode field offsets relative to cellStart; show histogram per field.
const NF = 12; // examine first 12 u32 fields (48 bytes)
const hist = []; for (let f = 0; f < NF; f++) hist.push(new Map());
let symAtt = 0, symTot = 0;
const attOf = (A, B) => buf.readUInt32LE(m.base + (A * N + B + (-1)) * m.stride + 4); // C=-1 for RIS
for (let i = 0; i < cells; i++) {
  const o = matStart + i * m.stride;
  for (let f = 0; f < NF; f++) {
    const v = buf.readUInt32LE(o + f * 4);
    hist[f].set(v, (hist[f].get(v) || 0) + 1);
  }
}
const fieldName = {0:"+0 zero", 1:"+4 key", 2:"+8 base200", 3:"+12 ATTITUDE", 4:"+16 flag", 5:"+20 counter", 6:"+24 aggression", 7:"+28", 8:"+32", 9:"+36", 10:"+40", 11:"+44"};
for (let f = 0; f < NF; f++) {
  const top = [...hist[f].entries()].sort((a,b)=>b[1]-a[1]).slice(0, 8);
  const distinct = hist[f].size;
  console.log(`field ${fieldName[f].padEnd(15)} distinct=${distinct}  top: ${top.map(([v,c])=>`${v}×${c}`).join("  ")}`);
}

// describe attitude (+12) value semantics
console.log(`\n=== ATTITUDE (+12) value distribution ===`);
const attHist = hist[3];
[...attHist.entries()].sort((a,b)=>a[0]-b[0]).forEach(([v,c])=>{
  const lab = v===0?"ALLIED":v===200?"NEUTRAL":v===400?"HOSTILE":v===600?"AT_WAR":v===850?"TotalWar":v===1000?"Crazy":"?";
  console.log(`  attitude=${v} (${lab})  ×${c}`);
});

module.exports = { matStart, matEnd, matBytes, m, N };
