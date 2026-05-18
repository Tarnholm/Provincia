// For each "greek general" character, extract own_uuid and bodyguard_uuid
// from the role-string-anchored record, then search the portrait pool
// section (0x1500000-0x1d20000) for those u32 values. If found, the
// surrounding bytes are likely the character's portrait metadata block.

const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const u16 = (o) => buf[o] | (buf[o + 1] << 8);
const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;

// Find role-string-anchored characters
const ROLE_STR = Buffer.concat([Buffer.from([0x0e, 0x00]), Buffer.from("greek general\0", "binary")]);
const chars = [];
let p = 0;
while ((p = buf.indexOf(ROLE_STR, p)) !== -1) {
  const r = p + 2;
  p += ROLE_STR.length;
  const ownUuid = u32(r + 15);
  const bgUuid = u32(r + 19);
  const regionLen = u16(r + 35);
  if (regionLen < 1 || regionLen > 32) continue;
  let region = "";
  for (let i = 0; i < regionLen; i++) region += String.fromCharCode(u16(r + 37 + 2 * i));
  const regionEnd = r + 37 + 2 * regionLen;
  if (u32(regionEnd) !== 0xffffffff) continue;
  const age = u32(regionEnd + 12);
  if (age < 14 || age > 100) continue;
  chars.push({ role: r, ownUuid, bgUuid, region, age });
}
console.log(`role-string characters: ${chars.length}`);

// Search portrait section [0x1500000, 0x1d30000] for each ownUuid
const POOL_START = 0x1500000;
const POOL_END = 0x1d30000;
const occurrences = new Map(); // uuid -> [offsets]
for (let off = POOL_START; off + 4 <= POOL_END && off + 4 <= buf.length; off += 1) {
  const v = u32(off);
  // Only check if v looks like a character UUID (non-zero, not 0xffffffff)
  if (v === 0 || v === 0xffffffff) continue;
  for (const c of chars) {
    if (v === c.ownUuid) {
      if (!occurrences.has(c.ownUuid)) occurrences.set(c.ownUuid, []);
      occurrences.get(c.ownUuid).push(off);
    }
  }
}

let hits = 0;
console.log("\nCharacters with own_uuid found in portrait section:");
for (const c of chars.slice(0, 15)) {
  const where = occurrences.get(c.ownUuid) || [];
  if (where.length > 0) hits++;
  console.log(
    `  ${c.region.padEnd(15)} age=${c.age.toString().padStart(2)} own=${c.ownUuid.toString(16).padStart(8, '0')} ` +
    `found at: ${where.length === 0 ? "(none)" : where.slice(0, 5).map(o => "0x" + o.toString(16)).join(", ")}`
  );
}
const totalHits = chars.filter(c => occurrences.has(c.ownUuid)).length;
console.log(`\nTotal chars whose ownUuid appears in portrait section: ${totalHits}/${chars.length}`);
