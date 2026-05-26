// dig-charpath-decode.js
// Decode the waypoint path records discovered in the body-root CHARACTER_PATHS
// region. Structure hypothesis (little-endian):
//   [u8 marker=0x02][u32 count][count × (u32 x, u32 y)]   -- full queued path
//   [u8 marker=0x01][u32 count][count × (u32 x, u32 y)]   -- remaining path?
// The path is preceded by the owning character's pos record. We scan a window
// of the body-root for any run that looks like "count followed by count (x,y)
// pairs whose successive tiles are chebyshev-adjacent" (a real march path moves
// one tile at a time).
import fs from "node:fs";
import path from "node:path";
import { hex } from "./loader.js";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const FILES = {
  static: "save_17-05-2026   Spain   Turn 1.sav",
  spy:    "save_17-05-2026   Spain   Turn 1 move spy.sav",
  dip:    "save_17-05-2026   Spain   Turn 1move diplomat and army.sav",
};

// Validate a candidate path list at offset `o`:
//   [u32 count][count*(u32 x,u32 y)] where count in 2..64 and each tile
//   coordinate < 512 (map width) and successive tiles are adjacent (|dx|<=1,|dy|<=1).
function tryPath(buf, o) {
  if (o + 4 > buf.length) return null;
  const count = buf.readUInt32LE(o);
  if (count < 2 || count > 200) return null;
  const end = o + 4 + count * 8;
  if (end > buf.length) return null;
  const pts = [];
  for (let i = 0; i < count; i++) {
    const x = buf.readUInt32LE(o + 4 + i * 8);
    const y = buf.readUInt32LE(o + 4 + i * 8 + 4);
    if (x > 1000 || y > 1000) return null;
    pts.push([x, y]);
  }
  // Adjacency check: every consecutive pair must be chebyshev-adjacent
  let adj = true;
  for (let i = 1; i < pts.length; i++) {
    const dx = Math.abs(pts[i][0] - pts[i - 1][0]);
    const dy = Math.abs(pts[i][1] - pts[i - 1][1]);
    if (dx > 1 || dy > 1 || (dx === 0 && dy === 0)) { adj = false; break; }
  }
  return { count, end, pts, adj };
}

// Scan the body-root window for all valid adjacent paths
function scanPaths(buf, lo, hi) {
  const out = [];
  for (let o = lo; o < hi; o++) {
    const p = tryPath(buf, o);
    if (p && p.adj && p.count >= 3) {
      // marker byte just before the count
      const marker = o >= 1 ? buf[o - 1] : null;
      out.push({ off: o, marker, ...p });
    }
  }
  // de-overlap: keep only paths not fully contained in a longer one starting earlier
  out.sort((a, b) => a.off - b.off || (b.count - a.count));
  const kept = [];
  let lastEnd = -1;
  for (const p of out) {
    if (p.off >= lastEnd) { kept.push(p); lastEnd = p.end; }
  }
  return kept;
}

for (const [label, fname] of Object.entries(FILES)) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, fname));
  console.log(`\n========== ${label}  (${buf.length} bytes) ==========`);
  // Body root path region observed at ~0x3b900..0x3bc00 plus character extended
  // blocks at 0x42000..0x43000 (dip/army). Scan a generous window.
  const paths = scanPaths(buf, 0x3b900, 0x44000);
  console.log(`found ${paths.length} adjacent waypoint paths in 0x3b900..0x44000`);
  for (const p of paths) {
    const dest = p.pts[p.pts.length - 1];
    const src = p.pts[0];
    console.log(`  @0x${p.off.toString(16)} marker=0x${(p.marker||0).toString(16).padStart(2,"0")} count=${p.count}  src=(${src[0]},${src[1]}) dest=(${dest[0]},${dest[1]})`);
    console.log(`     pts: ${p.pts.map(([x,y])=>`(${x},${y})`).join(" ")}`);
  }
}
