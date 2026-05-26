// SOLDIER_PERSISTENT is a single big section per the registry.
// Each soldier record is 9 bytes; byte +0 = weapon_lvl × 4 ∈ {0,4,8,12}.
// Find the longest contiguous run where every byte at offset (start + i*9)
// satisfies this constraint. That run = the soldier persistence section.
const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

let bestStart = -1, bestEnd = -1, bestLen = 0;
const VALID = new Set([0, 4, 8, 12]);
const MIN_RUN = 100;

for (let phase = 0; phase < 9; phase++) {
  let runStart = -1;
  let runLen = 0;
  for (let p = phase; p + 9 < buf.length; p += 9) {
    const b = buf[p];
    if (VALID.has(b)) {
      if (runStart === -1) runStart = p;
      runLen++;
    } else {
      if (runLen >= MIN_RUN) {
        if (runLen > bestLen) {
          bestLen = runLen;
          bestStart = runStart;
          bestEnd = p;
        }
      }
      runStart = -1;
      runLen = 0;
    }
  }
}

if (bestStart === -1) {
  console.log("No long stride-9 run found.");
} else {
  console.log(`Longest run: 0x${bestStart.toString(16)} → 0x${bestEnd.toString(16)} (${bestLen} soldiers, ${(bestEnd - bestStart).toLocaleString()} bytes)`);
}

if (bestStart !== -1) {
  console.log("\nfirst 10 soldier records:");
  for (let i = 0; i < 10; i++) {
    const off = bestStart + i * 9;
    const bytes = buf.slice(off, off + 9);
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join(" ");
    const w = bytes[0] / 4;
    console.log(`  +${(i*9).toString().padStart(3)}: ${hex}  weapon_lvl=${w}`);
  }

  const weaponCounts = new Map();
  for (let i = 0; i < bestLen; i++) {
    const w = buf[bestStart + i * 9] / 4;
    weaponCounts.set(w, (weaponCounts.get(w) || 0) + 1);
  }
  console.log("\nweapon_lvl distribution:");
  for (const [w, c] of Array.from(weaponCounts.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  w=${w}: ${c}`);
  }
}

console.log("\n--- All runs with len >= 1000 ---");
for (let phase = 0; phase < 9; phase++) {
  let runStart = -1;
  let runLen = 0;
  for (let p = phase; p + 9 < buf.length; p += 9) {
    const b = buf[p];
    if (VALID.has(b)) {
      if (runStart === -1) runStart = p;
      runLen++;
    } else {
      if (runLen >= 1000) {
        console.log(`  phase=${phase}: 0x${runStart.toString(16)} - 0x${p.toString(16)} len=${runLen}`);
      }
      runStart = -1;
      runLen = 0;
    }
  }
}
