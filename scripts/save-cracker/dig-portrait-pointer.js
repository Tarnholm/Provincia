// For each character record, sweep nearby bytes for a u32 whose value
// falls in the portrait-pool offset range. That'd be a back-pointer from
// the character into the portrait pool.

const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const u16 = (o) => buf[o] | (buf[o + 1] << 8);
const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;

// Find portrait pool offsets
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
const portraitOffsetSet = new Set(portraits.map(p => p.at));
const portraitMinOff = Math.min(...portraits.map(p => p.at));
const portraitMaxOff = Math.max(...portraits.map(p => p.at));
console.log(`portraits: ${portraits.length} (offsets 0x${portraitMinOff.toString(16)}..0x${portraitMaxOff.toString(16)})`);

// Find role strings
const ROLE_STR = Buffer.concat([Buffer.from([0x0e, 0x00]), Buffer.from("greek general\0", "binary")]);
const roleAt = [];
let p = 0;
while ((p = buf.indexOf(ROLE_STR, p)) !== -1) {
  roleAt.push(p + 2);
  p += ROLE_STR.length;
}
console.log(`roles: ${roleAt.length}`);

// For each role, look at offsets r-200..r+400 for u32 values in pool range
let foundCount = 0;
const offsetVotes = {}; // offset relative to role -> count of times it matched a pool entry
for (const r of roleAt) {
  let found = false;
  for (let off = -200; off <= 400; off++) {
    if (r + off < 0 || r + off + 4 > buf.length) continue;
    const v = u32(r + off);
    if (v < portraitMinOff || v > portraitMaxOff) continue;
    if (portraitOffsetSet.has(v)) {
      offsetVotes[off] = (offsetVotes[off] || 0) + 1;
      found = true;
    }
  }
  if (found) foundCount++;
}
console.log(`chars with a pool-offset u32 nearby: ${foundCount}/${roleAt.length}`);
console.log("\noffsets where many characters had a pool-pointing u32:");
const sorted = Object.entries(offsetVotes).sort((a, b) => b[1] - a[1]).slice(0, 12);
for (const [off, ct] of sorted) {
  console.log(`  off=${off.padStart(5)} votes=${ct}/${roleAt.length}`);
}
