// dig-diplomacy26.js — Look at the 0x14e10b8..0x14e5b43 band more carefully.
// Each ~3KB segment has a recurring pattern with 8-byte diffs that look like
// hashes/UUIDs being updated. Likely AI policy state — not diplomacy.
//
// Now try a different approach: look for u8 changes where the changed bytes
// form a coherent sequence (not single isolated bytes but a column in a matrix).
//
// If diplomacy is a [N_factions x N_factions] byte matrix, then changing the
// (Romans, Messapians) pair AND the (Messapians, Romans) pair (mirror) would
// give 2 byte changes at a fixed stride (= N_factions bytes apart).

import fs from "node:fs";

const SAVE_A = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.sav";
const SAVE_B = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_3.sav";

const bA = fs.readFileSync(SAVE_A);
const bB = fs.readFileSync(SAVE_B);

const sz = Math.min(bA.length, bB.length);

// Find ALL byte positions where bA[i] != bB[i] AND both <= 6.
// These are "enum-flip" candidates.
const flips = [];
for (let i = 0; i < sz; i++) {
  if (bA[i] === bB[i]) continue;
  if (bA[i] > 6 || bB[i] > 6) continue;
  // Plus: the byte must be in a "stable surrounding" — at least 8 bytes
  // around it should be identical.
  let stable = true;
  for (let d = -8; d <= 8; d++) {
    if (d === 0) continue;
    if (i + d < 0 || i + d >= sz) continue;
    if (bA[i + d] !== bB[i + d]) { stable = false; break; }
  }
  if (!stable) continue;
  flips.push({ i, a: bA[i], b: bB[i] });
}
console.log(`stable-surround enum flips (both ≤6, ±8B identical): ${flips.length}`);
// Most likely candidate: a pair (i, j) of flips where i-j is constant.
// Look for the most-frequent pair distance.
const distHist = new Map();
for (let k = 0; k < flips.length; k++) {
  for (let l = k + 1; l < Math.min(flips.length, k + 50); l++) {
    const d = flips[l].i - flips[k].i;
    if (d < 50000) distHist.set(d, (distHist.get(d) || 0) + 1);
  }
}
const sorted = Array.from(distHist.entries()).sort((a, b) => b[1] - a[1]);
console.log("\nTop pairwise distances:");
for (const [d, c] of sorted.slice(0, 30)) {
  console.log(`  Δ=${d} (0x${d.toString(16)}) count=${c}`);
}

// Dump first 50 flips with full context (32 bytes around)
console.log("\nFirst 50 strictly-isolated flips:");
for (const f of flips.slice(0, 50)) {
  const ctxL = Array.from(bA.subarray(Math.max(0, f.i - 16), f.i)).map(x => x.toString(16).padStart(2, '0')).join(' ');
  const ctxR = Array.from(bA.subarray(f.i + 1, f.i + 17)).map(x => x.toString(16).padStart(2, '0')).join(' ');
  console.log(`  0x${f.i.toString(16)}  A=${f.a} B=${f.b}  L:[${ctxL}] [${f.a.toString(16).padStart(2,'0')}/${f.b.toString(16).padStart(2,'0')}] R:[${ctxR}]`);
}
