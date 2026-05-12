// Goal #2: diplomat move 2 tiles south, save_3.2 -> save_4.2, +89 bytes.
// First find the structural delta (sample-based shift tracker).

const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVE_DIR, 'save_3.2.sav'));
const B = fs.readFileSync(path.join(SAVE_DIR, 'save_4.2.sav'));

console.log(`A=save_3.2 (${A.length}B)  B=save_4.2 (${B.length}B)  ΔlenB-A=${B.length-A.length}`);

const SAMPLE = 256;
const W = 64;

function findShift(off) {
  let bestS = null, bestM = 0;
  for (let s = -128; s <= 128; s++) {
    const bi = off + s;
    if (bi < 0 || bi + W >= B.length) continue;
    let m = 0;
    for (let k = 0; k < W; k++) if (A[off+k] === B[bi+k]) m++;
    if (m > bestM || (m === bestM && bestS !== null && Math.abs(s) < Math.abs(bestS))) {
      bestM = m; bestS = s;
    }
  }
  if (bestM < 56) return null;
  return bestS;
}

let lastShift = 0;
const transitions = [];
const runs = [];
let curShift = 0;
let runStart = 0x4000;
for (let off = 0x4000; off + W < A.length; off += SAMPLE) {
  const s = findShift(off);
  if (s === null) continue;
  if (s !== curShift) {
    runs.push({ shift: curShift, start: runStart, end: off, length: off - runStart });
    transitions.push({ off, from: curShift, to: s });
    curShift = s;
    runStart = off;
  }
}
runs.push({ shift: curShift, start: runStart, end: A.length, length: A.length - runStart });

// Time at each shift
const time = {};
for (const r of runs) time[r.shift] = (time[r.shift] || 0) + r.length;
console.log(`Total transitions: ${transitions.length}`);
console.log('Time at each shift (≥4 KB):');
const sortedShifts = Object.keys(time).map(Number).sort((a,b) => time[b] - time[a]);
for (const s of sortedShifts) {
  if (time[s] >= 4096) console.log(`  shift=${s}: ${time[s]} bytes (${(time[s]/1024).toFixed(1)} KB)`);
}

// All runs at +89 shift (the final accumulated delta)
console.log('\nRuns at shift=+89, ≥256 bytes:');
for (const r of runs) {
  if (r.shift === 89 && r.length >= 256) {
    console.log(`  0x${r.start.toString(16)} .. 0x${r.end.toString(16)} (${r.length} B)`);
  }
}

// Show transitions through positive shifts (insertions in B)
// The accumulated shift goes 0 -> +1 -> +2 -> ... -> +89
console.log('\nKey transitions (where shift grows, i.e. B has inserts):');
let accum = 0;
for (const t of transitions) {
  if (t.to > t.from) {
    console.log(`  at 0x${t.off.toString(16)}: shift ${t.from} -> ${t.to} (+${t.to - t.from})`);
  }
}
