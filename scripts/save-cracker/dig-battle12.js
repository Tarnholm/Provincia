// dig-battle12.js — Check session 22's per-faction turn counter at +(52+4N+188)
// and look for a battle counter that differs between Romans+Messapians but not others.

import fs from "node:fs";

const SAVE_A = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.sav";
const SAVE_B = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_3.sav";

const bA = fs.readFileSync(SAVE_A);
const bB = fs.readFileSync(SAVE_B);

function findMajor(buf) {
  const out = [];
  for (let i = 0; i + 64 < buf.length; i++) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    const regions = buf.readUInt32LE(i + 48);
    if (regions > 200) continue;
    out.push({ pos: i, regions });
    i += 60;
  }
  return out;
}

const recsA = findMajor(bA);
const recsB = findMajor(bB);
console.log("checking per-faction turn counter at +(52+4N+188):");
for (let i = 0; i < recsA.length; i++) {
  const baseA = recsA[i].pos + 52 + 4 * recsA[i].regions;
  const baseB = recsB[i].pos + 52 + 4 * recsB[i].regions;
  const tA = bA.readUInt32LE(baseA + 188);
  const tB = bB.readUInt32LE(baseB + 188);
  console.log(`  [${i}] regions=${recsA[i].regions} +188: A=${tA} B=${tB} Δ=${tB-tA}`);
}

// Now check session-21 cumulative event counter at +(92+4N+20) — that was for Alex.
// But session 22 didn't see it stick in RIS. Let's see if any K from 0..3000 changes
// ONLY for Romans+Messapians and is a small int (potential event counter).
//
// Look for u32-aligned fields where A and B differ such that:
//   - both A and B are <100 (counter-like)
//   - the field changes by +1 OR +N where N >= 1
//   - the field appears in faction 0 AND faction 20, AND NO other faction's same offset
//     has same diff value.

console.log("\n=== Searching for per-faction event counters that ticked only for Romans+Messapians ===");
const N = recsA.length;
const baseAs = recsA.map(r => r.pos + 52 + 4 * r.regions);
const baseBs = recsB.map(r => r.pos + 52 + 4 * r.regions);

for (let k = 0; k < 3000; k += 4) {
  // Read u32 at each faction's k for both saves
  const valsA = baseAs.map(b => bA.readUInt32LE(b + k));
  const valsB = baseBs.map(b => bB.readUInt32LE(b + k));
  // For Romans (idx 0) and Messapians (idx 20), value must differ AND be <= 100 in both.
  const r_diff = valsA[0] !== valsB[0];
  const m_diff = valsA[20] !== valsB[20];
  if (!r_diff && !m_diff) continue;
  // Both must be small ints
  const all_in_range = (valsA[0] <= 100 && valsB[0] <= 100 && valsA[20] <= 100 && valsB[20] <= 100);
  if (!all_in_range) continue;
  // Other factions: do they ALSO change at this k?
  const otherChange = [];
  for (let i = 1; i < N; i++) {
    if (i === 20) continue;
    if (valsA[i] !== valsB[i]) otherChange.push(i);
  }
  console.log(`  k=${k}: R=${valsA[0]}→${valsB[0]}  M=${valsA[20]}→${valsB[20]}  others changed at: ${otherChange.length === 0 ? 'NONE' : otherChange.join(',')}`);
}
