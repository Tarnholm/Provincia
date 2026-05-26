// Try cracking trait position on antigonid (player) chars who should have
// traits (leader / heir / generals). The role-anchored offset might be
// different for RIS — search a wide window.
const fs = require("fs");
const { parseCharacterExtras } = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const chars = parseCharacterExtras(buf);
const antigonid = chars.filter(c => c.culture === "antigonid");
console.log(`antigonid chars: ${antigonid.length}\n`);

// For the first few antigonid chars, scan a wide range looking for u16
// values that could be traitCount (1-30) followed by N × 8 bytes that look
// like traits (u32 tid < 2000, u16 level 1-8, u16 pad).
for (const c of antigonid.slice(0, 3)) {
  const idx = c.offset;
  console.log(`char @0x${idx.toString(16)} (antigonid general)`);
  console.log(`  ownUuid=0x${c.ownUuid.toString(16)} bgUuid=0x${c.bodyguardUuid.toString(16)}`);
  console.log(`  region="${c.region}" age=${c.age}`);
  // Compute postRegion offset (end of UTF-16 region) — known from parseCharacterExtras
  const roleStr = c.culture + " " + c.role + "\0";
  const roleLen = roleStr.length;
  const regionLen = c.region.length;
  const postRegion = idx + roleLen + 23 + regionLen * 2;
  console.log(`  postRegion = idx + ${roleLen + 23 + regionLen * 2} = 0x${postRegion.toString(16)}`);
  // After sentinel + spouse + f32 + age + age2, position is postRegion + 20.
  // Then comes additional data — possibly stats, traits.

  // Search window: postRegion+20 to postRegion+500
  const scanStart = postRegion + 20;
  const scanEnd = Math.min(buf.length, postRegion + 500);
  console.log(`  scanning ${scanStart.toString(16)}..${scanEnd.toString(16)} for trait header pattern:`);

  // Pattern: u16 traitCount (1-30) then traitCount × 8-byte entries
  for (let off = scanStart; off < scanEnd - 30; off += 1) {
    const tc = buf.readUInt16LE(off);
    if (tc < 1 || tc > 30) continue;
    // Validate next tc entries
    let allValid = true;
    let validCount = 0;
    for (let i = 0; i < tc; i++) {
      const tOff = off + 2 + i * 8;
      if (tOff + 8 > buf.length) { allValid = false; break; }
      const tid = buf.readUInt32LE(tOff);
      const level = buf.readUInt16LE(tOff + 4);
      const pad = buf.readUInt16LE(tOff + 6);
      // Trait IDs should be small (<2000), level 1-8, padding usually 0
      if (tid >= 2000 || tid === 0 || level === 0 || level > 8 || pad > 5) { allValid = false; break; }
      validCount++;
    }
    if (allValid && validCount === tc && tc >= 2) {
      const relativeOff = off - idx;
      console.log(`    HIT: u16=${tc} at idx+${relativeOff} (0x${off.toString(16)})`);
      // Show first 3 traits
      for (let i = 0; i < Math.min(3, tc); i++) {
        const tOff = off + 2 + i * 8;
        const tid = buf.readUInt32LE(tOff);
        const level = buf.readUInt16LE(tOff + 4);
        console.log(`      tid=${tid} level=${level}`);
      }
      break; // Found a hit, stop scanning for this char
    }
  }
}
