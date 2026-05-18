// For each character, find the FIRST occurrence of own_uuid in the
// portrait section (back-reference) and dump bytes around it. Look for
// adjacent portrait pstr16 strings.

const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const u16 = (o) => buf[o] | (buf[o + 1] << 8);
const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;

const ROLE_STR = Buffer.concat([Buffer.from([0x0e, 0x00]), Buffer.from("greek general\0", "binary")]);
const chars = [];
let p = 0;
while ((p = buf.indexOf(ROLE_STR, p)) !== -1) {
  const r = p + 2;
  p += ROLE_STR.length;
  chars.push({ role: r, ownUuid: u32(r + 15) });
}

// Find first occurrence of own_uuid in portrait section
function findUuidBefore(uuid, before) {
  for (let off = 0x1500000; off + 4 <= before; off++) {
    if (u32(off) === uuid) return off;
  }
  return -1;
}

// For first 5 characters, dump bytes around the back-reference
for (const c of chars.slice(0, 5)) {
  const ref = findUuidBefore(c.ownUuid, c.role);
  if (ref < 0) continue;
  console.log(`\n=== char own=${c.ownUuid.toString(16).padStart(8, '0')}  back-ref at 0x${ref.toString(16)}  role at 0x${c.role.toString(16)}  delta=${c.role - ref} ===`);

  // Scan for pstr16 portrait strings within ±256 bytes of the back-ref
  for (let off = Math.max(0, ref - 256); off < Math.min(buf.length - 4, ref + 256); off++) {
    const len = u16(off);
    if (len < 8 || len > 200) continue;
    let s = "", ok = true;
    for (let k = 0; k < len - 1; k++) {
      const b = buf[off + 2 + k];
      if (b < 0x20 || b > 0x7e) { ok = false; break; }
      s += String.fromCharCode(b);
    }
    if (!ok || buf[off + 2 + len - 1] !== 0) continue;
    if (!s.startsWith("data/ui/") || !s.includes("portraits/")) continue;
    console.log(`  ${(off - ref >= 0 ? "+" : "")}${off - ref}: "${s}"`);
  }

  // Also dump the u32s ±16 bytes around ref
  console.log("  u32 window around back-ref:");
  for (let o = -16; o <= 16; o += 4) {
    if (ref + o < 0 || ref + o + 4 > buf.length) continue;
    const v = u32(ref + o);
    console.log(`    ${o >= 0 ? "+" : ""}${o}: ${v.toString(16).padStart(8, '0')} = ${v}`);
  }
}
