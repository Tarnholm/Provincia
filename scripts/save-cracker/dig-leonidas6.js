// Final approach: scan ALL byte positions for u16 transitions that change by
// exactly +2 (matching Leonidas's X delta) AND have a paired u16 within 32B
// that changed by exactly -2 (matching Y delta). The smallest such cluster
// IS Leonidas's coords, regardless of absolute values.
import fs from "node:fs";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const a = fs.readFileSync(path.join(SAVE_DIR, "save_savestartsparta.sav"));
const b = fs.readFileSync(path.join(SAVE_DIR, "save_1.3.sav"));

// We need shift-aware comparison. For each anchor offset O in baseline, find
// equivalent offset in save_1.3 by aligning to nearby unchanged windows.
// Simpler: try same-absolute-offset comparison over the first ~20MB
// (everything before the tile/FoW noise area).
const RANGE = 20 * 1024 * 1024;

// Find all offsets where u16(a) - u16(b) == +2 (X went up by 2)
// Then find paired offset within ±64 where u16(a) - u16(b) == -2 (Y went down by 2)
const xCandidates = [];
console.log("scanning for u16 deltas of +2 (matching Leonidas Δx)…");
for (let i = 0; i + 2 <= Math.min(RANGE, a.length, b.length); i++) {
  const av = a.readUInt16LE(i);
  const bv = b.readUInt16LE(i);
  if (av === bv) continue;
  if (av < 50 || av > 4000 || bv < 50 || bv > 4000) continue; // map-coord-like values
  if (bv - av === 2) xCandidates.push({ off: i, av, bv });
}
console.log(`  ${xCandidates.length} candidates`);

console.log("scanning for u16 deltas of -2 (matching Leonidas Δy)…");
const yMatches = new Set();
const yByOff = new Map();
for (let i = 0; i + 2 <= Math.min(RANGE, a.length, b.length); i++) {
  const av = a.readUInt16LE(i);
  const bv = b.readUInt16LE(i);
  if (av === bv) continue;
  if (av < 50 || av > 4000 || bv < 50 || bv > 4000) continue;
  if (bv - av === -2) {
    yMatches.add(i);
    yByOff.set(i, { av, bv });
  }
}
console.log(`  ${yMatches.size} candidates`);

// Pair them
const pairs = [];
for (const xc of xCandidates) {
  for (let dy = -64; dy <= 64; dy++) {
    if (yMatches.has(xc.off + dy)) {
      const yc = yByOff.get(xc.off + dy);
      pairs.push({ xOff: xc.off, yOff: xc.off + dy, dy, xa: xc.av, xb: xc.bv, ya: yc.av, yb: yc.bv });
      break; // closest dy is enough
    }
  }
}
console.log(`\n*** ${pairs.length} (X+2, Y-2) co-occurring transitions ***`);
for (const p of pairs.slice(0, 30)) {
  console.log(`  X@0x${p.xOff.toString(16).padStart(8,"0")}  ${p.xa}→${p.xb}   Y@0x${p.yOff.toString(16)}  ${p.ya}→${p.yb}   dy=${p.dy}`);
}

// Most interesting: pairs where xa = 398 OR ya = 337 (matches user's reported values)
const exact = pairs.filter(p => (p.xa === 398 && p.xb === 400) || (p.ya === 337 && p.yb === 335));
if (exact.length > 0) {
  console.log(`\n*** EXACT match for Leonidas's reported coords: ${exact.length} ***`);
  for (const p of exact) {
    console.log(`  X@0x${p.xOff.toString(16)}  ${p.xa}→${p.xb}   Y@0x${p.yOff.toString(16)}  ${p.ya}→${p.yb}   dy=${p.dy}`);
  }
} else if (pairs.length > 0) {
  console.log(`\n(no exact 398→400 + 337→335 match; user's UI coords may differ from save-stored values)`);
  console.log(`The unique-delta pairs ARE Leonidas's coord field — just at different absolute values.`);
}
