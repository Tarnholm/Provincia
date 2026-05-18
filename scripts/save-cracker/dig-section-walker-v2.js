// Walk sections from 0x3bf7 forward. Each section: [u32 self_ptr][...] ends
// at next self-pointer. Look for the section pattern that includes treasury.

const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;

// Step 1: find ALL positions where u32(P) == P (self-pointers)
const selfPtrs = [];
for (let off = 0x3bf7; off < Math.min(buf.length, 0x100000); off += 4) {
  if (u32(off) === off) selfPtrs.push(off);
}
console.log(`self-pointer positions in 0x3bf7..0x100000: ${selfPtrs.length}`);
console.log(`first 20: ${selfPtrs.slice(0, 20).map(o => "0x" + o.toString(16)).join(", ")}`);

// Step 2: check if consecutive self-pointers form a section chain
console.log("\nstride between consecutive self_ptrs (first 30):");
for (let i = 0; i + 1 < Math.min(30, selfPtrs.length); i++) {
  console.log(`  0x${selfPtrs[i].toString(16)} → 0x${selfPtrs[i + 1].toString(16)} (delta=${selfPtrs[i + 1] - selfPtrs[i]})`);
}

// Step 3: check if there's a TYPE BYTE near each self-pointer
// Format hypothesis: [u8 type_id][u8 flags][u16 zero][u32 self_ptr][...data...]
console.log("\nfor first 10 self_ptrs, dump bytes -4..+12 to find type marker:");
for (let i = 0; i < Math.min(10, selfPtrs.length); i++) {
  const p = selfPtrs[i];
  const bytes = [];
  for (let off = -4; off <= 12; off++) {
    if (p + off < 0 || p + off >= buf.length) continue;
    bytes.push(buf[p + off].toString(16).padStart(2, "0"));
  }
  console.log(`  0x${p.toString(16)}: ${bytes.join(" ")}`);
}
