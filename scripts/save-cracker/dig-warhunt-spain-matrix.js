// dig-warhunt-spain-matrix.js
// Validate the matrix model on the Spain vanilla transition. Vanilla N=21,
// key=13. Decode the matrix and confirm cell [spain=18][carthage=7] (and the
// symmetric [7][18]) flips 200->600 from T4Start to declareWAR, and that ALL
// pre-existing 600 cells are faction<->slave(20) pairs (vanilla descr_strat).
"use strict";
const fs = require("fs");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const VANILLA = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Total War ROME REMASTERED\\Contents\\Resources\\Data\\data\\descr_sm_factions.txt";
function loadFactionOrder(path) {
  const txt = fs.readFileSync(path, "utf8"); const order = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) { const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/); if (cm) { order.push(cur); cur = null; } }
  }
  return order;
}
const order = loadFactionOrder(VANILLA);
const N = order.length;
console.log(`vanilla N=${N}`);
const STRIDE = 267, KEY = 13;

function matrix(buf) {
  let base = -1;
  for (let o = 0x4000; o + 8 <= buf.length; o++) {
    if (buf.readUInt32LE(o) === 200 && [0,100,200,400,600,850,1000].includes(buf.readUInt32LE(o+4)) && buf.readUInt32LE(o-4) === KEY) { base = o; break; }
  }
  const cells = [];
  let i = 0;
  for (let o = base; o + 8 <= buf.length; o += STRIDE) {
    if (buf.readUInt32LE(o) !== 200 || buf.readUInt32LE(o - 4) !== KEY) break;
    cells.push(buf.readUInt32LE(o + 4)); i++;
  }
  return { base, cells };
}
function cellAt(cells, A, B, width, off) {
  const idx = A * width + B - off;
  return (idx >= 0 && idx < cells.length) ? cells[idx] : null;
}

for (const [tag, f] of [["T4Start", "save_Autosave   Spain   Turn 4 Start.sav"],
                        ["declareWAR", "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav"],
                        ["T4", "save_Autosave   Spain   Turn 4.sav"]]) {
  const buf = fs.readFileSync(SAVES_DIR + f);
  const { base, cells } = matrix(buf);
  // calibrate width/off using same scheme (width=N, off=1)
  const w = N, off = 1;
  const sc = cellAt(cells, 18, 7, w, off);  // spain->carthage
  const cs = cellAt(cells, 7, 18, w, off);  // carthage->spain
  // count all 600 cells and verify decode
  let n600 = 0; const pairs600 = [];
  for (let idx = 0; idx < cells.length; idx++) {
    if (cells[idx] === 600) {
      const j = idx + off; const A = Math.floor(j / w), B = j % w;
      pairs600.push([A, B]); n600++;
    }
  }
  console.log(`\n${tag}: base=0x${base.toString(16)} cells=${cells.length} 600-cells=${n600}`);
  console.log(`  cell[spain=18][carthage=7]=${sc}  cell[carthage=7][spain=18]=${cs}`);
  // how many of the 600 pairs involve slave(20)?
  const slaveId = order.indexOf("slave");
  const slaveWars = pairs600.filter(([a,b]) => a === slaveId || b === slaveId).length;
  const nonSlave = pairs600.filter(([a,b]) => a !== slaveId && b !== slaveId);
  console.log(`  slave(${slaveId}) involved in ${slaveWars}/${n600} war cells`);
  console.log(`  non-slave war pairs: ${nonSlave.map(([a,b])=>`${order[a]}<->${order[b]}`).join(", ") || "(none)"}`);
}
