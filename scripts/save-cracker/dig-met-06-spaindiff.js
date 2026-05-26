// dig-met-06-spaindiff.js
// Diff the matrix cells between two Spain saves to see EXACTLY which (A,B) cells
// change when Spain first contacts / trades with Carthage. If "met" is a per-cell
// field, the Spain<->Carthage cell (and only newly-met pairs) will gain a marker
// distinct from a stance change.
"use strict";
const fs = require("fs");
const VANILLA = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Total War ROME REMASTERED\\Contents\\Resources\\Data\\data\\descr_sm_factions.txt";
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
function loadOrder(p){const t=fs.readFileSync(p,"utf8");const o=[];let c=null;for(const l of t.split(/\r?\n/)){const m=l.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);if(m){c=m[1];continue;}if(c){const cm=l.match(/^\s*"culture":\s*"([a-z_]+)"/);if(cm){o.push(c);c=null;}}}return o;}
const order = loadOrder(VANILLA);
const N = order.length;

function locate(buf) {
  const limit = Math.min(buf.length - 64, 0x400000);
  for (let p = 0x4000; p < limit; p++) {
    if (buf.readUInt32LE(p) !== 0) continue;
    const key = buf.readUInt32LE(p + 4);
    if (key < 1 || key > 64) continue;
    if (buf.readUInt32LE(p + 8) !== 200) continue;
    if (buf.readUInt32LE(p + 16) !== 2) continue;
    for (let s = 80; s <= 200; s++) {
      if (p + s + 12 >= buf.length) break;
      if (buf.readUInt32LE(p + s) === 0 && buf.readUInt32LE(p + s + 4) === key && buf.readUInt32LE(p + s + 8) === 200) {
        let good = 0; for (let k = 0; k < N + 2; k++) { const o = p + k * s; if (o + 12 >= buf.length) break; if (buf.readUInt32LE(o) === 0 && buf.readUInt32LE(o + 4) === key && buf.readUInt32LE(o + 8) === 200) good++; else break; }
        if (good >= N) return { cellStart: p, stride: s, key };
      }
    }
  }
  return null;
}
function calib(buf, loc) {
  const att = (idx) => { const o = loc.cellStart + idx * loc.stride + 12; return o + 4 <= buf.length ? buf.readUInt32LE(o) : null; };
  let bestC = 0, best = -1;
  for (let C = -3; C <= 3; C++) { let sym = 0, tot = 0; for (let A = 1; A < N; A++) for (let B = A + 1; B < N; B++) { const v1 = att(A * N + B + C), v2 = att(B * N + A + C); if (v1 == null || v2 == null) continue; tot++; if (v1 === v2) sym++; } const sc = tot ? sym / tot : 0; if (sc > best) { best = sc; bestC = C; } }
  return bestC;
}
function cellFull(buf, loc, idx) {
  const o = loc.cellStart + idx * loc.stride;
  if (o + loc.stride > buf.length) return null;
  const u = []; for (let j = 0; j < loc.stride; j += 4) { if (o + j + 4 > buf.length) break; u.push(buf.readUInt32LE(o + j)); }
  return u;
}

const A = process.argv[2], B = process.argv[3];
const ba = fs.readFileSync(SAVES_DIR + A), bb = fs.readFileSync(SAVES_DIR + B);
const la = locate(ba), lb = locate(bb);
const Ca = calib(ba, la), Cb = calib(bb, lb);
console.log(`A=${A}\n  stride=${la.stride} C=${Ca}`);
console.log(`B=${B}\n  stride=${lb.stride} C=${Cb}`);

console.log(`\n=== changed cells (A->B), showing att/flag/ctr + every changed word index ===`);
let changes = 0;
for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
  if (a === b) continue;
  const ua = cellFull(ba, la, a * N + b + Ca);
  const ub = cellFull(bb, lb, a * N + b + Cb);
  if (!ua || !ub) continue;
  const diffs = [];
  const len = Math.min(ua.length, ub.length);
  for (let w = 0; w < len; w++) if (ua[w] !== ub[w]) diffs.push(`w${w}(+${w*4}):${ua[w]}->${ub[w]}`);
  if (diffs.length) {
    changes++;
    console.log(`(${order[a]} , ${order[b]})  ${diffs.join("  ")}`);
  }
}
console.log(`\ntotal changed cells: ${changes}`);
