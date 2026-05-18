// Hypothesis: fields +288, +292 in the 354-byte extended record are
// x, y map coordinates (not portrait indexes). Verify by walking all
// records and checking if same-region characters have nearby coords.

const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const u16 = (o) => buf[o] | (buf[o + 1] << 8);
const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;

// Get all greek generals with region
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

// For each char, find the first occurrence of ownUuid in [0x1500000, role).
function findBackRef(uuid, before) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(uuid);
  let p = 0x1500000;
  while ((p = buf.indexOf(bytes, p)) !== -1) {
    if (p >= before) return -1;
    return p;
  }
  return -1;
}

// Walk 109 chars, get +288/+292 from their extended record
const recs = [];
for (const c of charByUuid.values()) {
  const ref = findBackRef(c.ownUuid, c.role);
  if (ref < 0) continue;
  recs.push({
    char: c,
    refOff: ref,
    f288: u32(ref + 288),
    f292: u32(ref + 292),
    f276: u32(ref + 276),
    f280: u32(ref + 280),
  });
}
console.log(`records: ${recs.length}`);

// Print first 30 with their +288/+292
console.log("\nrec_off       own        region                age  +276  +280     +288 +292");
for (const r of recs.slice(0, 30)) {
  console.log(
    `0x${r.refOff.toString(16)}  ${r.char.ownUuid.toString(16).padStart(8, '0')}  ` +
    `${r.char.region.padEnd(22)} ${r.char.age.toString().padStart(2)}  ` +
    `${r.f276.toString().padStart(4)}  ${r.f280.toString(16).padStart(8, '0')}  ` +
    `${r.f288.toString().padStart(4)} ${r.f292.toString().padStart(4)}`
  );
}

// Stats on +288, +292 ranges
const f288s = recs.map(r => r.f288);
const f292s = recs.map(r => r.f292);
console.log(`\n+288 range: ${Math.min(...f288s)} .. ${Math.max(...f288s)} (unique=${new Set(f288s).size})`);
console.log(`+292 range: ${Math.min(...f292s)} .. ${Math.max(...f292s)} (unique=${new Set(f292s).size})`);
