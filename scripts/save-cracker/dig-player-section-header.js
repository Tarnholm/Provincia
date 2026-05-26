// Dump a wide region around the player's captain banner (0x150c1cc)
// looking for the player faction record header structure.
const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const BANNER = 0x150c1cc;

// Dump 512 bytes BEFORE and 256 after the banner
console.log("=== 512 bytes BEFORE the banner path ===");
for (let off = BANNER - 512; off < BANNER; off += 16) {
  let hex = "", asc = "";
  for (let i = 0; i < 16; i++) {
    const b = buf[off + i];
    hex += b.toString(16).padStart(2, "0") + " ";
    asc += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".";
  }
  console.log(`  0x${off.toString(16)}: ${hex.padEnd(48)} | ${asc}`);
}

console.log("\n=== 256 bytes AT and AFTER the banner ===");
for (let off = BANNER; off < BANNER + 256; off += 16) {
  let hex = "", asc = "";
  for (let i = 0; i < 16; i++) {
    const b = buf[off + i];
    hex += b.toString(16).padStart(2, "0") + " ";
    asc += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".";
  }
  console.log(`  0x${off.toString(16)}: ${hex.padEnd(48)} | ${asc}`);
}

// Look for u32 = 100 (major class tag) in 16KB before banner
console.log("\n=== u32=100 near banner (might indicate player rec start) ===");
for (let p = BANNER - 16384; p < BANNER; p++) {
  if (buf.readUInt32LE(p) === 100) {
    const next = buf.readUInt32LE(p + 4);
    console.log(`  0x${p.toString(16)}: +4=0x${next.toString(16)} (=${next}) delta_to_banner=${BANNER - p}`);
  }
}
