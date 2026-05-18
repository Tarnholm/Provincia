// Field +280 in the 354-byte extended record is a u32 that varies per
// character (not zero, not 0xffffffff, looks UUID-ish). Hypotheses:
//   1. Spouse/father UUID (cross-ref to another character record)
//   2. Portrait-pool entry hash
//   3. Trait hash
//   4. Birthday/random seed
//
// Test: does any +280 match another character's own_uuid? If so, it's a
// kin/spouse reference. If not, it's something else.

const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const u16 = (o) => buf[o] | (buf[o + 1] << 8);
const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;

const ROLE_STR = Buffer.concat([Buffer.from([0x0e, 0x00]), Buffer.from("greek general\0", "binary")]);
const ownUuids = new Set();
const charByUuid = new Map();
let p = 0;
while ((p = buf.indexOf(ROLE_STR, p)) !== -1) {
  const r = p + 2;
  p += ROLE_STR.length;
  const rl = u16(r + 35);
  if (rl < 1 || rl > 32) continue;
  const own = u32(r + 15);
  if (own === 0 || own === 0xffffffff) continue;
  ownUuids.add(own);
  charByUuid.set(own, { role: r, ownUuid: own });
}

function findBackRef(uuid, before) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(uuid);
  let p = 0x1500000;
  return (p = buf.indexOf(b, p)) !== -1 && p < before ? p : -1;
}

// Collect +280 values across all chars
const f280Map = new Map(); // uuid -> f280
for (const c of charByUuid.values()) {
  const ref = findBackRef(c.ownUuid, c.role);
  if (ref < 0) continue;
  f280Map.set(c.ownUuid, u32(ref + 280));
}

// Does any +280 match another own_uuid?
let crossMatches = 0;
for (const [own, f280] of f280Map) {
  if (ownUuids.has(f280) && f280 !== own) {
    crossMatches++;
    if (crossMatches <= 5) {
      console.log(`  char ${own.toString(16)} has +280=${f280.toString(16)} which IS another char's own_uuid`);
    }
  }
}
console.log(`\n+280 → another char's own_uuid: ${crossMatches}/${f280Map.size}`);

// Check if +280 values are unique
const f280Vals = [...f280Map.values()];
const uniqF280 = new Set(f280Vals).size;
console.log(`+280 uniqueness: ${uniqF280}/${f280Vals.length}`);

// Maybe +280 cross-refs to spouse UUID (from role-anchored record)
// Get all spouse UUIDs
const spouseMap = new Map(); // own -> spouse
for (const c of charByUuid.values()) {
  const rl = u16(c.role + 35);
  const regionEnd = c.role + 37 + 2 * rl;
  if (u32(regionEnd) !== 0xffffffff) continue;
  const spouse = u32(regionEnd + 4);
  spouseMap.set(c.ownUuid, spouse);
}
let spouseMatches = 0;
for (const [own, f280] of f280Map) {
  if (spouseMap.get(own) === f280) spouseMatches++;
}
console.log(`+280 == spouse_uuid: ${spouseMatches}/${f280Map.size}`);

// Check if +280 is the bodyguard_uuid (at role+19)
const bgMap = new Map();
for (const c of charByUuid.values()) bgMap.set(c.ownUuid, u32(c.role + 19));
let bgMatches = 0;
for (const [own, f280] of f280Map) {
  if (bgMap.get(own) === f280) bgMatches++;
}
console.log(`+280 == bodyguard_uuid: ${bgMatches}/${f280Map.size}`);

// What about +16 in the extended record? Print first 10 chars
console.log("\nfirst 10 chars: own, +16, +280, spouse, bodyguard");
for (const c of [...charByUuid.values()].slice(0, 10)) {
  const ref = findBackRef(c.ownUuid, c.role);
  if (ref < 0) continue;
  const f16 = u32(ref + 16);
  const f280 = u32(ref + 280);
  const sp = spouseMap.get(c.ownUuid);
  const bg = bgMap.get(c.ownUuid);
  console.log(
    `  own=${c.ownUuid.toString(16).padStart(8,'0')}  +16=${f16.toString(16).padStart(8,'0')}  +280=${f280.toString(16).padStart(8,'0')}  sp=${sp.toString(16).padStart(8,'0')}  bg=${bg.toString(16).padStart(8,'0')}`
  );
}
