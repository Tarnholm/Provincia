// v3: Wider sweep — look across r-64..r+128 for any field that:
//   - Has high cardinality (most characters get a unique value)
//   - All values fit in 0..187 (greek pool size)
//
// Also dump per-character all candidates so we can spot one matching the
// in-game family tree manually.

const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const u8 = (o) => buf[o];
const u16 = (o) => buf[o] | (buf[o + 1] << 8);
const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;
const f32 = (o) => buf.readFloatLE(o);

const ROLE_STR = Buffer.concat([Buffer.from([0x0e, 0x00]), Buffer.from("greek general\0", "binary")]);
const positions = [];
let p = 0;
while ((p = buf.indexOf(ROLE_STR, p)) !== -1) {
  positions.push(p + 2);
  p += ROLE_STR.length;
}

const records = [];
for (const r of positions) {
  if (r - 64 < 0 || r + 128 >= buf.length) continue;
  const regionLen = u16(r + 35);
  if (regionLen < 1 || regionLen > 32) continue;
  let region = "";
  for (let i = 0; i < regionLen; i++) region += String.fromCharCode(u16(r + 37 + 2 * i));
  const regionEnd = r + 37 + 2 * regionLen;
  if (u32(regionEnd) !== 0xffffffff) continue;
  const age = u32(regionEnd + 12);
  if (age < 14 || age > 100) continue;

  // Sweep every u8/u16/u32 from r-64 to r+128 (skipping the role string itself r..r+15)
  const fields = {};
  for (let off = -64; off <= 128; off++) {
    if (off >= 0 && off < 14) continue; // skip role string bytes
    if (r + off < 0 || r + off + 4 > buf.length) continue;
    fields[`r${off >= 0 ? "+" : ""}${off}_u8`] = u8(r + off);
  }
  // Also some u32s at strategic offsets
  for (const off of [-64, -60, -56, -52, -48, -44, -40, -36, -32, -28, -24, -20, -16, -12, -8, -4, 14, 23, 27, 31]) {
    if (r + off < 0 || r + off + 4 > buf.length) continue;
    fields[`r${off >= 0 ? "+" : ""}${off}_u32`] = u32(r + off);
  }
  // Post-region u32s
  for (const off of [16, 20, 24, 28, 32, 36, 40, 44, 48]) {
    if (regionEnd + off + 4 > buf.length) continue;
    fields[`pr+${off}_u32`] = u32(regionEnd + off);
  }

  records.push({ r, region, age, fields });
}

console.log(`records: ${records.length}`);

// Per-field stats
const keys = Object.keys(records[0].fields);
const candidates = [];
for (const k of keys) {
  const vals = records.map(rec => rec.fields[k]);
  const unique = new Set(vals).size;
  const inPool = vals.filter(v => v >= 0 && v <= 187).length;
  if (inPool === records.length && unique >= 30) {
    candidates.push({ k, unique, vals });
  }
}

console.log(`\ncandidate fields where ALL values fit 0..187 AND unique >= 30:`);
for (const c of candidates) {
  console.log(`  ${c.k.padEnd(14)} unique=${c.unique}/${records.length}`);
}

// Also: candidates where all values fit 0..187 (any uniqueness)
console.log(`\nall fields where ALL values fit 0..187:`);
for (const k of keys) {
  const vals = records.map(rec => rec.fields[k]);
  const unique = new Set(vals).size;
  const inPool = vals.filter(v => v >= 0 && v <= 187).length;
  if (inPool === records.length && unique > 10) {
    console.log(`  ${k.padEnd(14)} unique=${unique}/${records.length}  sample first 10: ${vals.slice(0, 10).join(",")}`);
  }
}
