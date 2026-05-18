// The first character back-refs are at 0x171301b, 0x171317d, 0x17132df,
// 0x1713441 — perfect stride of 354 bytes (0x162). Walk the 354-byte
// extended-character-record format and dump fields to find consistent
// patterns. If there's an inline portrait reference, it'll be at a fixed
// offset within the 354-byte block.

const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const u16 = (o) => buf[o] | (buf[o + 1] << 8);
const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;
const f32 = (o) => buf.readFloatLE(o);

// First, get all greek general ownUuids
const ROLE_STR = Buffer.concat([Buffer.from([0x0e, 0x00]), Buffer.from("greek general\0", "binary")]);
const charByUuid = new Map();
let p = 0;
while ((p = buf.indexOf(ROLE_STR, p)) !== -1) {
  const r = p + 2;
  p += ROLE_STR.length;
  const rl = u16(r + 35);
  if (rl < 1 || rl > 32) continue;
  const own = u32(r + 15);
  if (own === 0 || own === 0xffffffff) continue;
  let region = "";
  for (let i = 0; i < rl; i++) region += String.fromCharCode(u16(r + 37 + 2 * i));
  const regionEnd = r + 37 + 2 * rl;
  const age = u32(regionEnd + 12);
  charByUuid.set(own, { role: r, ownUuid: own, region, age });
}

// Walk 354-byte records starting at 0x171301b looking for ownUuid at +0
const RECORD_SIZE = 354;
const START = 0x171301b;
let extRecords = [];
for (let off = START; off + RECORD_SIZE < buf.length; off += RECORD_SIZE) {
  const uuid = u32(off);
  // Validate: uuid should be in our char set OR a related character
  // Stop if we hit clearly invalid data (zeros, etc.)
  if (uuid === 0 || uuid === 0xffffffff) break;
  extRecords.push({ off, uuid });
  if (extRecords.length > 200) break;
}
console.log(`extended records walked: ${extRecords.length}`);
const fromOurSet = extRecords.filter(r => charByUuid.has(r.uuid)).length;
console.log(`of which are 'greek general' (in our 109): ${fromOurSet}/${extRecords.length}`);

// Dump fields of first record (Akarnania age 60)
console.log("\n=== First extended record (own=343ef9a3, Akarnania age 60) ===");
const r0 = extRecords[0].off;
console.log("u32 fields:");
for (let o = 0; o < RECORD_SIZE; o += 4) {
  const v = u32(r0 + o);
  if (v === 0) continue; // skip zeros
  let note = "";
  if (charByUuid.has(v)) note += " <- ownUuid match";
  if (v >= 0x1500000 && v <= 0x1d30000) note += " <- in portrait section range";
  // Could be a float?
  const fv = f32(r0 + o);
  const isPlausibleFloat = isFinite(fv) && Math.abs(fv) > 0.01 && Math.abs(fv) < 10000;
  if (isPlausibleFloat && (v >> 24) !== 0) note += ` (f32=${fv.toFixed(2)})`;
  // Could be a small int?
  if (v < 1000) note += ` (small int=${v})`;
  console.log(`  +${o.toString().padStart(3)}: 0x${v.toString(16).padStart(8, '0')}${note}`);
}

// Look for any u32 that varies across 30 records and is in 0..1000 range
console.log("\n=== Per-offset variance across first 30 records ===");
const fieldStats = [];
for (let o = 0; o < RECORD_SIZE; o += 4) {
  const vals = extRecords.slice(0, 30).map(r => u32(r.off + o));
  const unique = new Set(vals).size;
  const inSmall = vals.filter(v => v >= 0 && v <= 500).length;
  const inMed = vals.filter(v => v >= 0 && v <= 5000).length;
  const allInPool = vals.every(v => v === 0 || (v >= 0x1500000 && v <= 0x1d30000));
  fieldStats.push({ o, unique, inSmall, inMed, allInPool, vals });
}
const interesting = fieldStats.filter(f => f.unique >= 5 && (f.inSmall === 30 || f.allInPool));
console.log(`fields with >= 5 unique values AND all in plausible range:`);
for (const f of interesting.slice(0, 30)) {
  console.log(`  +${f.o.toString().padStart(3)}: unique=${f.unique}  in_0_500=${f.inSmall}  allInPool=${f.allInPool}  sample=[${f.vals.slice(0, 5).join(",")}]`);
}
