// dig-mapfeat-stride.js
// Among the (x,y,0x7fff) coord triples, separate the 354-byte character records
// from any tighter-strided arrays (candidate fort/watchtower lists). Print the
// sorted marker offsets and the gap between consecutive markers; a run of equal
// small gaps = a packed feature array.
import fs from "node:fs";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const f = process.argv[2] || "save_t0.sav";
const buf = fs.readFileSync(path.join(SAVE_DIR, f));

const COORD_MAX = 1024;
const hits = [];
for (let o = 8; o + 4 <= buf.length; o++) {
  if (buf.readUInt32LE(o) !== 0x7fff) continue;
  const x = buf.readUInt32LE(o - 8);
  const y = buf.readUInt32LE(o - 4);
  if (x > 0 && x < COORD_MAX && y > 0 && y < COORD_MAX) hits.push({ o, x, y });
}
console.log(`${f}: ${hits.length} triples`);

// Gap histogram
const gaps = {};
for (let i = 1; i < hits.length; i++) {
  const g = hits[i].o - hits[i - 1].o;
  gaps[g] = (gaps[g] || 0) + 1;
}
const top = Object.entries(gaps).map(([g, c]) => [Number(g), c]).sort((a, b) => b[1] - a[1]).slice(0, 25);
console.log("\nTop consecutive-marker gaps (stride: count):");
for (const [g, c] of top) console.log(`   ${String(g).padStart(7)} bytes : ${c}`);

// Find runs of small constant gaps (<= 64 bytes) = packed arrays
console.log("\nPacked runs (>=3 consecutive markers with gap <= 96):");
let runStart = 0;
for (let i = 1; i <= hits.length; i++) {
  const g = i < hits.length ? hits[i].o - hits[i - 1].o : 1e9;
  if (g <= 96) continue; // still in a run
  // run ended at i-1
  const len = (i - 1) - runStart + 1;
  if (len >= 3) {
    const s = hits[runStart], e = hits[i - 1];
    const stride = (e.o - s.o) / (len - 1);
    console.log(`   run @0x${s.o.toString(16)}..0x${e.o.toString(16)}  ${len} markers  ~stride ${stride.toFixed(1)}  firstXY=(${s.x},${s.y}) lastXY=(${e.x},${e.y})`);
  }
  runStart = i;
}
