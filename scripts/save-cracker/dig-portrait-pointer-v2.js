// Look INSIDE each character's 354-byte "summary" record (centered on the
// back-ref to own_uuid) for u32 values that look like file offsets into
// the portrait section. Build a set of valid pstr16 start offsets first
// so we can check against it.

const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const u16 = (o) => buf[o] | (buf[o + 1] << 8);
const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;

// Build set of all portrait pstr16 start offsets
const portraitOffsets = new Set();
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
  portraitOffsets.add(i);
  portraits.push({ at: i, s });
  i += 1 + len;
}
console.log(`portrait offsets: ${portraitOffsets.size}`);
const minOff = Math.min(...portraitOffsets);
const maxOff = Math.max(...portraitOffsets);
console.log(`offset range: 0x${minOff.toString(16)} .. 0x${maxOff.toString(16)}`);

// Find character back-refs
const ROLE_STR = Buffer.concat([Buffer.from([0x0e, 0x00]), Buffer.from("greek general\0", "binary")]);
const chars = [];
let p = 0;
while ((p = buf.indexOf(ROLE_STR, p)) !== -1) {
  const r = p + 2;
  p += ROLE_STR.length;
  if (u16(r + 35) < 1 || u16(r + 35) > 32) continue;
  const own = u32(r + 15);
  if (own === 0 || own === 0xffffffff) continue;
  chars.push({ role: r, ownUuid: own });
}

function findUuidBefore(uuid, before) {
  for (let off = 0x1500000; off + 4 <= before; off++) {
    if (u32(off) === uuid) return off;
  }
  return -1;
}

// For each char, check every u32 in [ref-200, ref+200] to see if it's a
// portrait pstr16 offset. Record offset position relative to ref.
const offsetVotes = {}; // pos relative to back-ref -> count of "is a valid portrait offset"
let totalChecked = 0;
for (const c of chars) {
  const ref = findUuidBefore(c.ownUuid, c.role);
  if (ref < 0) continue;
  totalChecked++;
  for (let off = -200; off <= 200; off++) {
    if (ref + off < 0 || ref + off + 4 > buf.length) continue;
    const v = u32(ref + off);
    if (portraitOffsets.has(v)) {
      offsetVotes[off] = (offsetVotes[off] || 0) + 1;
    }
  }
}
console.log(`\nchars examined: ${totalChecked}`);
console.log("\nrelative offsets where the u32 was a valid portrait-pstr16 start:");
const sorted = Object.entries(offsetVotes).sort((a,b) => b[1] - a[1]);
for (const [off, count] of sorted.slice(0, 15)) {
  console.log(`  off=${off.padStart(5)}: ${count}/${totalChecked} characters`);
}
