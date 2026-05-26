// Read u16 at role_string + 260 as a potential traitCount, then validate
// by reading traitCount * 8-byte trait entries (each = u32 tid + u16 level + 2 pad).
// All four bytes of tid must be a plausible small index (< 1000), level 1-8.
const fs = require("fs");
const { parseCharacterExtras } = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const chars = parseCharacterExtras(buf);
console.log(`${chars.length} chars\n`);

let validCount = 0;
let invalidCount = 0;
const traitCountDist = new Map();

for (const c of chars.slice(0, 30)) {
  const idx = c.offset;
  const tcOff = idx + 260;
  if (tcOff + 2 > buf.length) continue;
  const traitCount = buf.readUInt16LE(tcOff);
  // Validate
  if (traitCount > 50) {
    invalidCount++;
    continue;
  }
  // Validate trait entries — each is u32 tid (sensibly small) + u16 level (1-8) + 2 pad
  let valid = 0;
  let bad = 0;
  for (let i = 0; i < traitCount; i++) {
    const tOff = idx + 266 + i * 8;
    if (tOff + 8 > buf.length) break;
    const tid = buf.readUInt32LE(tOff);
    const level = buf.readUInt16LE(tOff + 4);
    if (tid < 2000 && level >= 1 && level <= 8) valid++;
    else bad++;
  }
  const status = bad === 0 && valid === traitCount && traitCount > 0 ? "✓" : (valid > bad ? "?" : "✗");
  console.log(`${status} char @0x${idx.toString(16)} role="${c.culture} ${c.role}" traitCount=${traitCount} valid=${valid}/${traitCount}`);
  if (traitCount > 0 && traitCount < 30 && valid > 0) {
    // Show first 3 traits
    for (let i = 0; i < Math.min(3, traitCount); i++) {
      const tid = buf.readUInt32LE(idx + 266 + i * 8);
      const level = buf.readUInt16LE(idx + 266 + i * 8 + 4);
      console.log(`    tid=${tid} level=${level}`);
    }
  }
  if (status === "✓") validCount++; else invalidCount++;
  traitCountDist.set(traitCount, (traitCountDist.get(traitCount) || 0) + 1);
}

console.log(`\nvalid: ${validCount}, invalid: ${invalidCount}`);
console.log("traitCount distribution:");
for (const [k, v] of Array.from(traitCountDist.entries()).sort((a, b) => a[0] - b[0])) {
  console.log(`  ${k}: ${v}`);
}

// Also try alternate offsets — maybe idx + 256 or 264 or +258
console.log("\n--- Try alternate trait-count offsets across first 10 chars ---");
const offsetsToTry = [254, 256, 258, 260, 262, 264, 266, 268, 270];
for (const off of offsetsToTry) {
  let plausible = 0;
  for (const c of chars.slice(0, 10)) {
    if (c.offset + off + 2 > buf.length) continue;
    const tc = buf.readUInt16LE(c.offset + off);
    if (tc <= 30 && tc > 0) plausible++;
  }
  console.log(`  +${off}: ${plausible}/10 plausible (0-30)`);
}
