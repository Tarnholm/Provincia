// Hypothesis: save_1.3 was loaded from save_1.2 (post-Messene-battle), not
// from save_savestartsparta (pre-everything). Test by diffing save_1.2 vs
// save_1.3 — should be a TINY diff if just movement.
import fs from "node:fs";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const baseline = fs.readFileSync(path.join(SAVE_DIR, "save_savestartsparta.sav"));
const v12 = fs.readFileSync(path.join(SAVE_DIR, "save_1.2.sav"));
const v13 = fs.readFileSync(path.join(SAVE_DIR, "save_1.3.sav"));

console.log(`baseline:  ${baseline.length.toLocaleString()}`);
console.log(`save_1.2:  ${v12.length.toLocaleString()}  (Δbase=${v12.length - baseline.length})`);
console.log(`save_1.3:  ${v13.length.toLocaleString()}  (Δbase=${v13.length - baseline.length}, Δ12=${v13.length - v12.length})\n`);

// Quick byte-diff between v12 and v13
let totalDiff12to13 = 0;
const minLen = Math.min(v12.length, v13.length);
for (let i = 0; i < minLen; i++) if (v12[i] !== v13[i]) totalDiff12to13++;
console.log(`v12 vs v13 byte-diff (no shift correction): ${totalDiff12to13.toLocaleString()} bytes differ`);

let totalDiffBaseTo13 = 0;
const minLen2 = Math.min(baseline.length, v13.length);
for (let i = 0; i < minLen2; i++) if (baseline[i] !== v13[i]) totalDiffBaseTo13++;
console.log(`baseline vs v13 byte-diff (no shift correction): ${totalDiffBaseTo13.toLocaleString()} bytes differ`);

// If v12-vs-v13 is much smaller than baseline-vs-v13, the user loaded v12 to make v13.
console.log(`\n=== Cross-correlate (398,337)→(400,335) using save_1.2 as the prior ===`);

function findVal(buf, val) {
  const out = [];
  for (let i = 0; i + 2 <= buf.length; i++) if (buf.readUInt16LE(i) === val) out.push(i);
  return out;
}

// First: confirm save_1.2 has Leonidas at (398, 337) too. He didn't move during the Messene battle.
const v12_398 = new Set(findVal(v12, 398));
const v12_337 = new Set(findVal(v12, 337));
const v13_400 = new Set(findVal(v13, 400));
const v13_335 = new Set(findVal(v13, 335));
console.log(`save_1.2: 398=${v12_398.size}, 337=${v12_337.size}`);
console.log(`save_1.3: 400=${v13_400.size}, 335=${v13_335.size}`);

// Try every Y delta from -64 to +64 looking for unique X+Y co-occurrence
console.log(`\nbroad scan: any Y delta in [-64,+64], 12-vs-13 cross-correlation`);
for (let dy = -64; dy <= 64; dy++) {
  if (dy === 0) continue;
  // Find X-only matches between v12 and v13 with shift up to ±256
  let confirmedAtThisDy = 0;
  for (const xOff of v12_398) {
    if (xOff + dy < 0 || xOff + dy + 2 > v12.length) continue;
    if (!v12_337.has(xOff + dy)) continue;
    // X+Y in v12 ✓; now find shifted match in v13
    for (let s = -256; s <= 256; s++) {
      const bX = xOff + s;
      if (!v13_400.has(bX)) continue;
      if (bX + dy < 0 || bX + dy + 2 > v13.length) continue;
      if (!v13_335.has(bX + dy)) continue;
      confirmedAtThisDy++;
      if (confirmedAtThisDy <= 3) {
        console.log(`  dy=${dy}: X@v12 0x${xOff.toString(16)} → v13 0x${bX.toString(16)} (shift ${s})`);
      }
      break;
    }
  }
  if (confirmedAtThisDy > 0) console.log(`  total at dy=${dy}: ${confirmedAtThisDy}`);
}
