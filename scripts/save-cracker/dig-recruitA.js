// Find the PERMANENT shift transition to -18. Walk forward; at each sample,
// require the match to be unambiguous (top shift ≥4 better than 0-shift),
// and report only "real" transitions where the shift settles into -18.

const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVE_DIR, 'save_2.2.sav'));
const B = fs.readFileSync(path.join(SAVE_DIR, 'save_3.2.sav'));

const SAMPLE = 256;
const W = 64;

// At each sample point in A, find the shift s minimising mismatches
// over a 64-byte window such that the match is at least 56/64. Return null if
// no good shift exists.
function findShift(off) {
  // Constraint: only consider shifts in {-32..+32}
  // Prefer shifts that yield large match (>=60/64) AND smallest |s|
  let bestS = null, bestM = 0;
  for (let s = -32; s <= 32; s++) {
    const bi = off + s;
    if (bi < 0 || bi + W >= B.length) continue;
    let m = 0;
    for (let k = 0; k < W; k++) if (A[off+k] === B[bi+k]) m++;
    if (m > bestM || (m === bestM && bestS !== null && Math.abs(s) < Math.abs(bestS))) {
      bestM = m; bestS = s;
    }
  }
  return { s: bestS, m: bestM };
}

// Skim and record. To filter ambiguity: only report points where
// (best match >= 60/64) AND (the shift's match count is >= second-best + 4).
function findShiftUnambig(off) {
  const ranks = [];
  for (let s = -32; s <= 32; s++) {
    const bi = off + s;
    if (bi < 0 || bi + W >= B.length) continue;
    let m = 0;
    for (let k = 0; k < W; k++) if (A[off+k] === B[bi+k]) m++;
    ranks.push({ s, m });
  }
  ranks.sort((a, b) => b.m - a.m);
  if (ranks[0].m < 56) return null;  // too low
  // If multiple shifts tie at top, choose smallest |s|
  const topM = ranks[0].m;
  const tied = ranks.filter(r => r.m === topM);
  tied.sort((a, b) => Math.abs(a.s) - Math.abs(b.s));
  return tied[0].s;
}

// Walk from 0x4000 to 0x1514174
let lastShift = 0;
const transitions = [];
for (let off = 0x4000; off < 0x1514174; off += SAMPLE) {
  const s = findShiftUnambig(off);
  if (s === null) continue;
  if (s !== lastShift) {
    transitions.push({ off, from: lastShift, to: s });
    lastShift = s;
  }
}
console.log(`Total transitions: ${transitions.length}`);

// Find runs where shift remained at -18 for >= 4 consecutive samples (=1024B)
// Actually just count time spent at each shift value
const time = {};
let curShift = 0;
let runStart = 0x4000;
const runs = [];
for (const t of transitions) {
  const runLen = t.off - runStart;
  runs.push({ shift: curShift, start: runStart, end: t.off, length: runLen });
  time[curShift] = (time[curShift] || 0) + runLen;
  curShift = t.to;
  runStart = t.off;
}
runs.push({ shift: curShift, start: runStart, end: 0x1514174, length: 0x1514174 - runStart });
time[curShift] = (time[curShift] || 0) + (0x1514174 - runStart);

console.log('\nTime spent at each shift (only shifts seen ≥ 4 KB):');
const sortedShifts = Object.keys(time).map(Number).sort((a,b) => time[b] - time[a]);
for (const s of sortedShifts) {
  if (time[s] >= 4096) console.log(`  shift=${s}: ${time[s]} bytes (${(time[s]/1024).toFixed(1)} KB)`);
}

// Find the run where shift first enters -18
console.log('\nFirst -18 shift run:');
const first18 = runs.find(r => r.shift === -18);
if (first18) {
  console.log(`  range 0x${first18.start.toString(16)} .. 0x${first18.end.toString(16)} (${first18.length} B)`);
}
// And the run where shift was 0 just before
const idx = runs.findIndex(r => r.shift === -18);
if (idx > 0) {
  const prev = runs[idx - 1];
  console.log(`  immediately preceded by shift=${prev.shift} range 0x${prev.start.toString(16)} .. 0x${prev.end.toString(16)}`);
}

// Output all -18 runs >= 256 bytes
console.log('\nAll -18 runs >= 256 bytes:');
for (const r of runs) {
  if (r.shift === -18 && r.length >= 256) {
    console.log(`  0x${r.start.toString(16)} .. 0x${r.end.toString(16)} (${r.length} B)`);
  }
}
