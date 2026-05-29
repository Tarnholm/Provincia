// Probe raw structure of the diplomacy matrix region: how does `key` (+4)
// progress across cells at stride 267? If key = row-owner faction id and it
// increments every M cells, that reveals row layout + dimension + the actual
// faction-index order (independent of descr_sm_factions guess).
"use strict";
const fs = require("fs");
const SAVE = process.argv[2] ||
  "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Julii turn1.sav";
const buf = fs.readFileSync(SAVE);
const STRIDE = 267;

// A located anchor cell (base = cell+8) from the calibration run:
const anchorBase = 0x10aade;
let cellStart = anchorBase - 8;
// walk backwards to the first cell of the contiguous [0,key,200] region
const isCell = (o) => o >= 0 && o + 12 < buf.length &&
  buf.readUInt32LE(o) === 0 && buf.readUInt32LE(o + 8) === 200 &&
  buf.readUInt32LE(o + 4) >= 1 && buf.readUInt32LE(o + 4) <= 300;
while (isCell(cellStart - STRIDE)) cellStart -= STRIDE;
// walk forwards to find the end
let cellEnd = cellStart;
let count = 0;
while (isCell(cellEnd)) { cellEnd += STRIDE; count++; }
console.log(`matrix region: first cell 0x${cellStart.toString(16)}, ${count} cells, last 0x${(cellEnd-STRIDE).toString(16)}`);
console.log(`sqrt(count) = ${Math.sqrt(count).toFixed(2)}  (M for an M×M matrix)`);

// dump key progression: where does key (+4) change?
console.log(`\n── key(+4) run-length (cellIndex: key ×runlen) ──`);
let prevKey = null, runStart = 0;
const runs = [];
for (let k = 0; k < count; k++) {
  const o = cellStart + k * STRIDE;
  const key = buf.readUInt32LE(o + 4);
  if (key !== prevKey) {
    if (prevKey !== null) runs.push({ key: prevKey, start: runStart, len: k - runStart });
    prevKey = key; runStart = k;
  }
}
runs.push({ key: prevKey, start: runStart, len: count - runStart });
console.log(`total key-runs: ${runs.length}`);
for (const r of runs.slice(0, 20)) console.log(`  cell ${String(r.start).padStart(6)}: key=${String(r.key).padStart(4)} ×${r.len}`);

// dump the fields of the first 12 cells to understand cell layout
console.log(`\n── first 12 cells: u32 fields at +0..+28 ──`);
for (let k = 0; k < 12; k++) {
  const o = cellStart + k * STRIDE;
  const f = [];
  for (let j = 0; j <= 28; j += 4) f.push(buf.readInt32LE(o + j));
  console.log(`  [${String(k).padStart(3)}] ` + f.map((v, i) => `+${i*4}=${v}`).join(" "));
}
