// dig-portrait-byte.js
//
// Find the per-character portrait_index byte in the save file.
//
// Approach: walk every "greek general" role string in the save (each
// marks a character record), dump nearby bytes, and look for a u8/u16
// field that (a) varies per character, (b) is in the plausible portrait
// pool range (0..478 for vanilla roman pool — capped).

const fs = require("fs");

const SAVE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav";

const buf = fs.readFileSync(SAVE);
console.log(`save size: ${buf.length} bytes`);

// Find all "greek general" pstr16 occurrences. pstr16 layout:
//   u16 length (little-endian)  +  ASCII bytes
// "greek general" = 13 chars, so length = 0x000D.
const ROLE = "greek general";
const marker = Buffer.concat([
  Buffer.from([ROLE.length, 0x00]),
  Buffer.from(ROLE, "ascii"),
]);

const positions = [];
let p = 0;
while (true) {
  const i = buf.indexOf(marker, p);
  if (i === -1) break;
  positions.push(i + 2); // role string position (skip pstr16 length)
  p = i + 2;
}
console.log(`"${ROLE}" role-string occurrences: ${positions.length}`);

// For each character, decode the known fields and dump candidates.
function u8(b, o) { return b[o]; }
function u16(b, o) { return b[o] | (b[o + 1] << 8); }
function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

const chars = [];
for (const r of positions) {
  if (r + 100 >= buf.length || r - 50 < 0) continue;
  const ownUuid = u32(buf, r + 15);
  const bgUuid = u32(buf, r + 19);
  const counter = u32(buf, r + 27);
  const unkA = u32(buf, r + 31);
  const regionLen = u16(buf, r + 35);
  if (regionLen > 64 || regionLen < 1) continue; // skip malformed/captain layouts
  const regionEnd = r + 37 + 2 * regionLen;
  let regionName = "";
  for (let i = 0; i < regionLen; i++) {
    regionName += String.fromCharCode(u16(buf, r + 37 + 2 * i));
  }
  const sentinel = u32(buf, regionEnd);
  if (sentinel !== 0xffffffff) continue;
  const spouseUuid = u32(buf, regionEnd + 4);
  const age = u32(buf, regionEnd + 12);
  if (age < 14 || age > 100) continue;

  chars.push({
    pos: r,
    ownUuid: ownUuid.toString(16),
    bgUuid: bgUuid.toString(16),
    counter: counter.toString(16),
    unkA: unkA.toString(16),
    regionLen, region: regionName,
    spouseUuid: spouseUuid.toString(16),
    age,
    // Candidate portrait-index bytes (pre-role-string and post-role-string):
    candidates: {
      "-50_u32": u32(buf, r - 50),
      "-46_u32": u32(buf, r - 46),
      "-42_u32": u32(buf, r - 42),
      "-38_u32": u32(buf, r - 38),
      "-34_u32": u32(buf, r - 34),
      "-30_u32": u32(buf, r - 30),
      "-26_u32": u32(buf, r - 26),
      "-22_u32": u32(buf, r - 22),
      "-18_u32": u32(buf, r - 18),
      "-14_u32": u32(buf, r - 14),
      "-10_u32": u32(buf, r - 10),
      "-6_u32":  u32(buf, r - 6),
      "-2_u16":  u16(buf, r - 2),
      "+23_u32": u32(buf, r + 23),
      "+27_u32": u32(buf, r + 27),
      "+31_u32": u32(buf, r + 31),
      // After region/age block:
      [`+${37 + 2 * regionLen + 8}_u32_float`]: buf.readFloatLE(regionEnd + 8),
      [`+${37 + 2 * regionLen + 16}_u32`]: u32(buf, regionEnd + 16),
      [`+${37 + 2 * regionLen + 20}_u32`]: u32(buf, regionEnd + 20),
    },
  });
}

console.log(`valid characters parsed: ${chars.length}`);

// Show the first 10 characters with all candidates
console.log("\n=== first 10 characters ===");
for (const c of chars.slice(0, 10)) {
  console.log(`pos=0x${c.pos.toString(16)}  region=${c.region.padEnd(15)}  age=${c.age.toString().padStart(2)}  own=${c.ownUuid.padStart(8, '0')}  bg=${c.bgUuid.padStart(8, '0')}  spouse=${c.spouseUuid.padStart(8, '0')}`);
  for (const [k, v] of Object.entries(c.candidates)) {
    const inRange = typeof v === "number" && v >= 0 && v <= 1000;
    console.log(`    ${k.padEnd(14)} = ${typeof v === "number" ? v : v} ${inRange ? "(in-range)" : ""}`);
  }
}

// Per-candidate analysis: which candidate keys have all values in 0..500?
console.log("\n=== candidate field stats (across all chars) ===");
const keys = Object.keys(chars[0].candidates);
for (const k of keys) {
  const vals = chars.map(c => c.candidates[k]);
  const numVals = vals.filter(v => typeof v === "number");
  if (numVals.length === 0) continue;
  const inRange = numVals.filter(v => v >= 0 && v <= 500).length;
  const unique = new Set(numVals).size;
  const min = Math.min(...numVals);
  const max = Math.max(...numVals);
  console.log(`${k.padEnd(14)} min=${min.toString().padStart(10)} max=${max.toString().padStart(10)} unique=${unique.toString().padStart(3)} in_range_0_500=${inRange}/${numVals.length}`);
}
