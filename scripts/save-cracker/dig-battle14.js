// dig-battle14.js — Check Romans Julii's record near the per-faction stats
// block at +(52+4N+...). Per session 22, RIS has at +188 a turn counter (here 0 in both saves).
// Also check +(52+4N+0) = block schema tag '30' and friends.

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

console.log("=== Each major faction's post-region-list u32s (K=0..240) ===");
console.log("(Per session 22: K=0 should be '30' tag, K=188 = turn counter)");
console.log("                          K0  K4  K8  K12 K16 K20 K24 K28 K32 K36 K40 K44 K48 K52 K56 K60 K64 K68 K72 K76 K80 K84 K88 K92 K96 K100 K104 K108 K112 K116 K120 K124 K128 K132 K136 K140 K144 K148 K152 K156 K160 K164 K168 K172 K176 K180 K184 K188 K192 K196 K200 K204 K208 K212 K216 K220 K224 K228 K232 K236");
for (let i = 0; i < recsA.length; i++) {
  const baseA = recsA[i].pos + 52 + 4 * recsA[i].regions;
  const baseB = recsB[i].pos + 52 + 4 * recsB[i].regions;
  const vals = [];
  for (let k = 0; k < 240; k += 4) {
    const a = bA.readUInt32LE(baseA + k);
    const b = bB.readUInt32LE(baseB + k);
    if (a !== b) vals.push(`K${k}: ${a}→${b}`);
  }
  if (vals.length > 0) console.log(`  [${i}] regions=${recsA[i].regions}: ${vals.join(', ')}`);
  else console.log(`  [${i}] regions=${recsA[i].regions}: (identical)`);
}

// Specifically look at known battle counter offsets
// Session 21 says +(92+4N+20) is the Alex event counter.
// For RIS the cumulative count should also be detectable.
console.log("\n=== Each faction at +92 +96 ... +152 (around Alex's +92+4N+16/20/24 area) ===");
for (let i = 0; i < recsA.length; i++) {
  const baseA = recsA[i].pos + 52 + 4 * recsA[i].regions;
  const baseB = recsB[i].pos + 52 + 4 * recsB[i].regions;
  // Offset relative to post-region-list start
  for (const k of [88, 92, 96, 100, 104, 108]) {
    const a = bA.readUInt32LE(baseA + k);
    const b = bB.readUInt32LE(baseB + k);
    if (a !== b) console.log(`  [${i}] K=${k}: ${a}→${b}`);
  }
}
