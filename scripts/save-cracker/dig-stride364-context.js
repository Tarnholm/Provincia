// Look at start of stride-364 array and what's RIGHT BEFORE it.
// Player faction record header should sit just before record[0].
const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const ARRAY_START = 0x1514037;

// Dump 256 bytes BEFORE the array, and 96 bytes of the first record
console.log("=== 256 bytes BEFORE first record ===");
for (let off = ARRAY_START - 256; off < ARRAY_START; off += 16) {
  let hex = "", asc = "";
  for (let i = 0; i < 16; i++) {
    const b = buf[off + i];
    hex += b.toString(16).padStart(2, "0") + " ";
    asc += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".";
  }
  console.log(`  0x${off.toString(16)}: ${hex.padEnd(48)} | ${asc}`);
}

console.log("\n=== First 96 bytes of record[0] at 0x" + ARRAY_START.toString(16) + " ===");
for (let off = 0; off < 96; off += 16) {
  let hex = "", asc = "";
  for (let i = 0; i < 16; i++) {
    const b = buf[ARRAY_START + off + i];
    hex += b.toString(16).padStart(2, "0") + " ";
    asc += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".";
  }
  console.log(`  +${off.toString(16).padStart(2, '0')}: ${hex.padEnd(48)} | ${asc}`);
}

// Look further back — search for a possible record count.
// If 45 records of 364 bytes follow, expect "45" (0x2d) somewhere before
console.log("\n=== self-pointers in 1MB BEFORE array start ===");
const wideBackStart = Math.max(0, ARRAY_START - 0x100000);
const selfPtrs = [];
for (let p = wideBackStart; p < ARRAY_START; p++) {
  if (p + 4 > buf.length) break;
  if (buf.readUInt32LE(p) === p) {
    selfPtrs.push(p);
  }
}
console.log(`${selfPtrs.length} self-pointers found. Last 20:`);
for (const sp of selfPtrs.slice(-20)) {
  const next4 = buf.readUInt32LE(sp + 4);
  console.log(`  0x${sp.toString(16)}  +4=0x${next4.toString(16)}  delta_to_array=${(ARRAY_START - sp).toLocaleString()}`);
}

// Also: dump 32 bytes around the very first 364-byte record's header bytes
// looking for any pattern like u32 record count
console.log("\n=== look for u32 = 45 (0x2d) in 1KB before array (possible count) ===");
for (let p = ARRAY_START - 1024; p < ARRAY_START; p++) {
  const v = buf.readUInt32LE(p);
  if (v >= 30 && v <= 100) {
    console.log(`  0x${p.toString(16)}: ${v}`);
  }
}
