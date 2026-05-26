// dig-charpath-fullscan.js
// Robustness check: scan the ENTIRE file (not just 0x3b800..0x44000) for valid
// path blocks, to (1) confirm the static save has ZERO anywhere, and (2) make
// sure no path records live outside the assumed window. A "path block" =
//   [u8 legCount 1..8] then legCount × ([u32 count 1..200] count×(u32 x<512,u32 y<512))
//   with chebyshev-adjacency within legs, continuity across legs, and a trailing
//   01 00 terminator. We require >=2 total waypoints to avoid false positives.
import fs from "node:fs";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const FILES = {
  static: "save_17-05-2026   Spain   Turn 1.sav",
  spy:    "save_17-05-2026   Spain   Turn 1 move spy.sav",
  dip:    "save_17-05-2026   Spain   Turn 1move diplomat and army.sav",
};

const MAPW = 512; // map tile bound (sane upper limit; real map ~510 wide)

function parsePathBlock(buf, o) {
  const legCount = buf.readUInt8(o);
  if (legCount < 1 || legCount > 8) return null;
  let p = o + 1;
  const legs = [];
  let totalPts = 0;
  for (let k = 0; k < legCount; k++) {
    if (p + 4 > buf.length) return null;
    const count = buf.readUInt32LE(p);
    if (count < 1 || count > 200 || p + 4 + count * 8 > buf.length) return null;
    const pts = [];
    for (let i = 0; i < count; i++) {
      const b = p + 4 + i * 8;
      const x = buf.readUInt32LE(b), y = buf.readUInt32LE(b + 4);
      if (x >= MAPW || y >= MAPW) return null;
      if (i > 0 && (Math.abs(x - pts[i-1][0]) > 1 || Math.abs(y - pts[i-1][1]) > 1)) return null;
      // reject zero-step duplicates within a leg
      if (i > 0 && x === pts[i-1][0] && y === pts[i-1][1]) return null;
      pts.push([x, y]);
    }
    legs.push({ count, pts });
    totalPts += count;
    p = p + 4 + count * 8;
  }
  // continuity
  for (let k = 1; k < legs.length; k++) {
    const a = legs[k-1].pts[legs[k-1].count-1], b = legs[k].pts[0];
    if (a[0] !== b[0] || a[1] !== b[1]) return null;
  }
  if (totalPts < 3) return null; // need a real route
  return { legCount, legs, end: p, totalPts, destination: legs[legs.length-1].pts.slice(-1)[0] };
}

for (const [label, fname] of Object.entries(FILES)) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, fname));
  const hits = [];
  for (let o = 0; o < buf.length - 8; o++) {
    const blk = parsePathBlock(buf, o);
    if (!blk) continue;
    if (buf[blk.end] !== 0x01 || buf[blk.end + 1] !== 0x00) continue; // 01 00 terminator
    hits.push({ off: o, ...blk });
    o = blk.end + 1;
  }
  console.log(`\n${label}: ${hits.length} path block(s) in WHOLE FILE`);
  for (const h of hits) {
    console.log(`  @0x${h.off.toString(16)} legs=${h.legCount} totalPts=${h.totalPts} src=(${h.legs[0].pts[0]}) dest=(${h.destination}) bytes=${h.end - h.off + 2}`);
  }
}
