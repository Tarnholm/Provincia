// dig-tail7.js — Look at the boundary at 0x1f10c72 more carefully.
// Is the tail actually a separate top-level section, or continuation?
// And does it look like the settlement zone ENDS at 0x1f10c72 or continues?

const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

// Look at last 256 bytes of settlement zone and first 256 of tail in continuum.
console.log("=== Continuum around 0x1f10c72 (settlement-zone end / tail-start) ===");
for (let i = -16; i < 16; i++) {
  const off = 0x1f10c72 + i * 16;
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 16; j++) {
    const b = buf[off + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  const marker = i === 0 ? " <-- 0x1f10c72 (declared tail start)" : "";
  console.log(`  0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}${marker}`);
}

// Re-verify settlement zone size
const settlementZoneOff = 0xf88637;
const sp = buf.readUInt32LE(settlementZoneOff);
const sz = buf.readUInt32LE(settlementZoneOff + 4);
console.log(`\nSettlement zone: pos=0x${sp.toString(16)} size=${sz} → end=0x${(settlementZoneOff + sz).toString(16)}`);

// Look at every self-pointing structure at top level of the file (after header):
// Just walk the file from 0x3b99 looking for u32==pos.
console.log("\n=== All u32==pos selfs across file (every 4 bytes, top of file) ===");
const tops = [];
let p = 0x3b99;
while (p + 8 <= buf.length) {
  const v = buf.readUInt32LE(p);
  if (v === p) {
    const s = buf.readUInt32LE(p + 4);
    if (s >= 16 && p + s <= buf.length) {
      tops.push({ off: p, size: s });
    }
  }
  p += 4;
}
// Take only large ones (>1MB) — i.e. top-level sections
console.log("Top-level sections (>1MB):");
const bigs = tops.filter(t => t.size > 1024 * 1024).slice(0, 20);
for (const t of bigs) {
  console.log(`  @0x${t.off.toString(16)} size=${t.size} (0x${t.size.toString(16)}) end=0x${(t.off + t.size).toString(16)}`);
}

// Look for any self-pointing thing in tail area specifically.
console.log("\nSelf-pointing structures in tail (any size):");
const tailSelfs = tops.filter(t => t.off >= 0x1f10c72);
console.log(`Total: ${tailSelfs.length}`);
for (let i = 0; i < Math.min(20, tailSelfs.length); i++) {
  const t = tailSelfs[i];
  console.log(`  @0x${t.off.toString(16)} size=${t.size}`);
}

// What does the byte pattern at 0x1f10c72 look like?
// First 8 bytes: 00 05 8a 14 40 00 00 00
// = u32 LE: 0x148a0500 / 0x00000040
// Maybe this is part of a record that started earlier and is just being concatenated.
//
// The signatures `00 05 8a 14 40 00 00 00 00 00 02 81 16 10 00 00 00 00 00 04 90 14 60 00 00 00 00 00 00 ff ff`:
// 8-byte chunks: [00 05 8a 14 40 00 00 00] [00 00 02 81 16 10 00 00] [00 00 00 04 90 14 60 00] [00 00 00 00 00 ff ff ff]
// Pattern: [u8 zero][u8 (1..)][u8 (mod ascii?)][u8 0x14][u8 0x10..40][zero zero zero] - 8 bytes per record, some kind of stride array.

// Look at this 8-byte striding pattern.
console.log("\n=== 8-byte stride decode at 0x1f10c72 ===");
for (let i = 0; i < 12; i++) {
  const off = 0x1f10c72 + i * 8;
  const u32a = buf.readUInt32LE(off);
  const u32b = buf.readUInt32LE(off + 4);
  const u8s = [...buf.slice(off, off + 8)].map(b => b.toString(16).padStart(2, "0")).join(" ");
  console.log(`  +${(i*8).toString().padStart(3)} 0x${off.toString(16)}: ${u8s} u32a=${u32a} u32b=${u32b}`);
}

// Now look at 0x1f10c72 - 64 (last bytes of settlement zone) with 8-byte stride
console.log("\n=== 8-byte stride decode at 0x1f10c72-64 (pre-tail, in settlement zone) ===");
for (let i = -12; i < 0; i++) {
  const off = 0x1f10c72 + i * 8;
  const u32a = buf.readUInt32LE(off);
  const u32b = buf.readUInt32LE(off + 4);
  const u8s = [...buf.slice(off, off + 8)].map(b => b.toString(16).padStart(2, "0")).join(" ");
  console.log(`  -${(-i*8).toString().padStart(3)} 0x${off.toString(16)}: ${u8s} u32a=${u32a} u32b=${u32b}`);
}
