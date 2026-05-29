// Robustly locate the 239×239 diplomacy matrix (no hardcoded offset) and diff
// two saves. T1->T2 with player idle but AI active reveals how live diplomacy
// changes are encoded in the att(+12)/bond(+20)/agg(+24) fields.
"use strict";
const fs = require("fs");
const SMF = "C:/RIS/RIS/data/descr_sm_factions.txt";
const SAVE_A = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Julii turn1.sav";
const SAVE_B = process.argv[3] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Julii turn2.sav";
const STRIDE = 267, N = 239;

const names = [];
for (const line of fs.readFileSync(SMF, "utf8").split(/\r?\n/)) { const m = line.match(/^\t"([a-z_0-9]+)":/); if (m) names.push(m[1].toLowerCase()); }

// Locate: find a long run of stride-267 cells with +0==0 && +8==200 && +16==2,
// then walk back to the true first cell.
function locate(buf) {
  const limit = Math.min(buf.length - STRIDE * 4, 0x800000);
  const looksCell = (o) => o >= 0 && o + 20 <= buf.length && buf.readUInt32LE(o + 8) === 200 && buf.readUInt32LE(o + 16) === 2 && buf.readUInt32LE(o) === 0;
  // Scan all stride-267 runs; keep the LONGEST (the real matrix ≈ N*N=57121).
  let best = null;
  for (let p = 0x4000; p < limit; p++) {
    if (!looksCell(p)) continue;
    let good = 0;
    while (looksCell(p + good * STRIDE)) good++;
    if (!best || good > best.run) best = { cell0: p, run: good };
    p += good * STRIDE; // skip past this run
  }
  return best && best.run >= N ? best : null;
}

function loadMatrix(path) {
  const buf = fs.readFileSync(path);
  const loc = locate(buf);
  if (!loc) throw new Error("matrix not found in " + path);
  return { buf, cell0: loc.cell0, run: loc.run };
}

const A = loadMatrix(SAVE_A), B = loadMatrix(SAVE_B);
console.log(`A=${SAVE_A.split(/[\\/]/).pop()} matrix@0x${A.cell0.toString(16)} run=${A.run}`);
console.log(`B=${SAVE_B.split(/[\\/]/).pop()} matrix@0x${B.cell0.toString(16)} run=${B.run}`);

const get = (M, r, c, fo) => M.buf.readInt32LE(M.cell0 + (r * N + c) * STRIDE + fo);
const FIELDS = { att: 12, bond: 20, agg: 24 };

console.log(`\n── cells that CHANGED A->B (att/bond/agg) ──`);
let n = 0;
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
  if (r === c) continue;
  const changes = [];
  for (const [name, fo] of Object.entries(FIELDS)) {
    const a = get(A, r, c, fo), b = get(B, r, c, fo);
    if (a !== b) changes.push(`${name}:${a}->${b}`);
  }
  if (changes.length) {
    console.log(`  ${names[r].padEnd(18)} -> ${names[c].padEnd(18)}  ${changes.join("  ")}`);
    n++;
  }
  if (n > 80) { console.log("  ... (truncated)"); r = N; break; }
}
console.log(`\n${n} changed directed pairs`);
