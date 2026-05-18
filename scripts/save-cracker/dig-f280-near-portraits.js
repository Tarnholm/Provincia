// Hypothesis: +280 in the extended record IS the linkage to portrait —
// each portrait pool entry has a UUID, and +280 stores it.
//
// Test: for each char's +280, search the save for that u32. If it appears
// near a portrait pstr16, that's the link.

const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const u16 = (o) => buf[o] | (buf[o + 1] << 8);
const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;

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

function findBackRef(uuid, before) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(uuid);
  let p = 0x1500000;
  return (p = buf.indexOf(b, p)) !== -1 && p < before ? p : -1;
}

// All portrait offsets
const portraits = [];
for (let i = 0; i < buf.length - 200; i++) {
  const len = u16(i);
  if (len < 8 || len > 200) continue;
  let s = "", ok = true;
  for (let k = 0; k < len - 1; k++) {
    const b = buf[i + 2 + k];
    if (b < 0x20 || b > 0x7e) { ok = false; break; }
    s += String.fromCharCode(b);
  }
  if (!ok || buf[i + 2 + len - 1] !== 0) continue;
  if (!s.startsWith("data/ui/") || !s.includes("/portraits/")) continue;
  portraits.push({ at: i, s });
  i += 1 + len;
}

// For first 10 chars, get +280 and search the save for it.
console.log("char +280 search: where does each char's +280 value appear in save?");
for (const c of [...charByUuid.values()].slice(0, 5)) {
  const ref = findBackRef(c.ownUuid, c.role);
  if (ref < 0) continue;
  const f280 = u32(ref + 280);

  // Find all occurrences of f280 as u32 in save
  const occurrences = [];
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(f280);
  let p = 0;
  while ((p = buf.indexOf(bytes, p)) !== -1) {
    occurrences.push(p);
    p += 4;
  }

  console.log(`\nchar own=${c.ownUuid.toString(16).padStart(8, '0')} (${c.region} age ${c.age})`);
  console.log(`  +280 = ${f280.toString(16).padStart(8, '0')}`);
  console.log(`  total occurrences in save: ${occurrences.length}`);

  // For each occurrence, check if there's a portrait pstr16 within ±200 bytes
  for (const occ of occurrences.slice(0, 6)) {
    const nearby = portraits.filter(p => Math.abs(p.at - occ) < 200);
    if (nearby.length === 0) {
      console.log(`    @0x${occ.toString(16)}: (no portrait within 200 bytes)`);
    } else {
      const closest = nearby.reduce((a, b) => Math.abs(a.at - occ) < Math.abs(b.at - occ) ? a : b);
      console.log(`    @0x${occ.toString(16)}: portrait "${closest.s.split('/').slice(-3).join('/')}" at delta=${closest.at - occ}`);
    }
  }
}
