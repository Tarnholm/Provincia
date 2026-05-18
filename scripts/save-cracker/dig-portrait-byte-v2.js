// dig-portrait-byte-v2.js
//
// Correct pstr16 format: length INCLUDES the null terminator.
// "greek general\0" = 14 bytes, length prefix = 14 (0x0E).
//
// For each role-string position r, extract candidate bytes and look for
// the one that's a portrait index (small u8/u16, varying per character).

const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const u8 = (o) => buf[o];
const u16 = (o) => buf[o] | (buf[o + 1] << 8);
const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;

// Find all "greek general\0" pstr16 occurrences. Length = 14 (incl null).
const ROLE_STR = Buffer.concat([Buffer.from([0x0e, 0x00]), Buffer.from("greek general\0", "binary")]);
const positions = [];
let p = 0;
while ((p = buf.indexOf(ROLE_STR, p)) !== -1) {
  positions.push(p + 2); // r = position of "g"
  p += ROLE_STR.length;
}
console.log(`role strings found: ${positions.length}`);

const records = [];
for (const r of positions) {
  if (r - 16 < 0 || r + 80 >= buf.length) continue;
  // Known fields from memory:
  const ownUuid = u32(r + 15);
  const counter = u32(r + 27);
  const unk31 = u32(r + 31);
  const regionLen = u16(r + 35);
  if (regionLen < 1 || regionLen > 32) continue;
  let region = "";
  for (let i = 0; i < regionLen; i++) region += String.fromCharCode(u16(r + 37 + 2 * i));
  const regionEnd = r + 37 + 2 * regionLen;
  const sentinel = u32(regionEnd);
  if (sentinel !== 0xffffffff) continue;
  const age = u32(regionEnd + 12);
  if (age < 14 || age > 100) continue;

  records.push({
    r,
    ownUuid,
    age,
    region,
    counter,
    unk31,
    // Pre-role-string candidate bytes
    "r-16_u32": u32(r - 16),
    "r-12_u32": u32(r - 12),
    "r-8_u32":  u32(r - 8),
    "r-4_u16":  u16(r - 4),
    "r-3_u8":   u8(r - 3),
    "r-4_u8":   u8(r - 4),
    "r+14_u8":  u8(r + 14),
    "r+23_u32": u32(r + 23),
  });
}
console.log(`valid records: ${records.length}`);

// Statistics per candidate
const cands = ["r-16_u32", "r-12_u32", "r-8_u32", "r-4_u16", "r-3_u8", "r-4_u8", "r+14_u8", "r+23_u32", "counter", "unk31"];
console.log("\n=== candidate field stats ===");
for (const k of cands) {
  const vals = records.map(rec => rec[k]);
  const unique = new Set(vals).size;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const inRange = vals.filter(v => v >= 0 && v <= 500).length;
  const small = vals.filter(v => v >= 0 && v <= 200).length;
  console.log(`${k.padEnd(12)} unique=${unique.toString().padStart(3)} min=${min.toString().padStart(10)} max=${max.toString().padStart(10)} in_0_500=${inRange}/${records.length} in_0_200=${small}/${records.length}`);
}

console.log("\n=== first 20 chars: portrait candidates side-by-side ===");
console.log("region          age own       r-4u16  r-3u8 r-4u8 r+14");
for (const rec of records.slice(0, 20)) {
  console.log(
    `${rec.region.padEnd(15)} ${rec.age.toString().padStart(3)} ${rec.ownUuid.toString(16).padStart(8,'0')} ` +
    `${rec["r-4_u16"].toString().padStart(6)} ${rec["r-3_u8"].toString().padStart(5)} ${rec["r-4_u8"].toString().padStart(5)} ${rec["r+14_u8"].toString().padStart(4)}`
  );
}
