// The 354-byte extended char record has 3 u32 pointers at +268, +272, +284
// that look like internal sub-section markers (self-pointer pattern).
// Dump bytes at those targets to see what they point to.

const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const u16 = (o) => buf[o] | (buf[o + 1] << 8);
const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;

const RECORD_SIZE = 354;
const FIRST_REC = 0x171301b;

function dumpHex(off, n = 80) {
  const lines = [];
  for (let i = 0; i < n; i += 16) {
    const hex = [];
    const ascii = [];
    for (let j = 0; j < 16; j++) {
      if (off + i + j >= buf.length) break;
      const b = buf[off + i + j];
      hex.push(b.toString(16).padStart(2, "0"));
      ascii.push(b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".");
    }
    lines.push(`  0x${(off + i).toString(16)}: ${hex.join(" ").padEnd(48)} ${ascii.join("")}`);
  }
  return lines.join("\n");
}

// For first 4 chars, dump the area BEFORE the extended record (where the
// portrait data might live) AND inspect the sub-section pointers.
for (let recIdx = 0; recIdx < 4; recIdx++) {
  const recOff = FIRST_REC + recIdx * RECORD_SIZE;
  const own = u32(recOff);
  console.log(`\n========= record ${recIdx} at 0x${recOff.toString(16)} own=${own.toString(16).padStart(8, '0')} =========`);

  // What are the sub-section pointers?
  console.log("sub-pointers in record:");
  for (const o of [268, 272, 284]) {
    const tgt = u32(recOff + o);
    console.log(`  +${o}: 0x${tgt.toString(16)}  (offset from rec_start: ${tgt - recOff})`);
  }

  // Field at +280 (b2b48bfc in first record) — could be a UUID/hash. And +288=381, +292=356.
  console.log(`field +280 (uuid?): 0x${u32(recOff + 280).toString(16).padStart(8, '0')}`);
  console.log(`field +288 (small int): ${u32(recOff + 288)}`);
  console.log(`field +292 (small int): ${u32(recOff + 292)}`);

  // Look BEFORE the record start (the portrait might be in a preceding block)
  // Scan -2048..-1 for any pstr16 portrait path
  console.log("\npstr16 portrait paths in [recOff-2048, recOff):");
  let found = 0;
  for (let i = Math.max(0, recOff - 2048); i < recOff && found < 6; i++) {
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
    console.log(`  -${(recOff - i).toString().padStart(4)} (0x${i.toString(16)}): "${s}"`);
    found++;
    i += 1 + len;
  }

  // Hex dump just after record
  console.log(`\nbytes at recOff+340..recOff+400 (last 14 bytes of record + 46 after):`);
  console.log(dumpHex(recOff + 340, 60));
}
