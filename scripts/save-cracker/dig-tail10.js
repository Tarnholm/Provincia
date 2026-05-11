// dig-tail10.js — Decode the end-of-file pointer table.

const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

const fileEnd = buf.length;

// Final 256 bytes look like pointer/value records. Let's see if there's a
// header/count at some offset like 0x2110000+.
console.log("=== Walk back from EOF: look for a count or boundary ===");
// Find where the "increasing 4-byte u32-offsets" pattern begins.
let p = fileEnd - 4;
let lastValid = fileEnd;
let foundStart = -1;
while (p > fileEnd - 50000) {
  const v = buf.readUInt32LE(p);
  // Is this a valid file offset (within file bounds + < lastValid)?
  if (v >= fileEnd - 100000 && v < fileEnd && v !== 0xffffffff) {
    lastValid = v;
    p -= 4;
  } else {
    foundStart = p + 4;
    break;
  }
}
console.log(`Pointer-table scan starting at ${foundStart.toString(16)} backwards to EOF`);

// More systematic: scan whole tail for "valid file offset" u32s and count them.
console.log("\n=== Scan all u32s in tail that look like file offsets ===");
const tailStart = 0x1f10c72;
let nf = 0, nv = 0;
const fileoffs = [];
for (let p = tailStart; p + 4 <= fileEnd; p += 4) {
  const v = buf.readUInt32LE(p);
  nf++;
  if (v >= tailStart && v < fileEnd) {
    nv++;
    fileoffs.push({ at: p, target: v });
  }
}
console.log(`u32s in tail: ${nf}, ones that look like tail-range offsets: ${nv} (${(100 * nv / nf).toFixed(2)}%)`);

// Show last 20 "u32 looking like file offset"
console.log("Last 20 of those:");
for (const f of fileoffs.slice(-20)) {
  console.log(`  @0x${f.at.toString(16)} → 0x${f.target.toString(16)}`);
}

// Look at the very tail-end structure: pattern is
//   <4 bytes u32 offset> <2 bytes u16 count? or 00 00>  <some payload>
// At 0x21152b2 we see 0x021152b2 then 00 00 then 0x021152b8 then 00 00 then 0x021152be then 01 00 then ee 01 00 00...
// Actually: `b2 52 11 02 00 00 | b8 52 11 02 00 00 | be 52 11 02 01 00 | ee 01 00 00 e5 01 00 00`
// So records are 6 bytes [u32 offset][u16 ???] and payload separately.
// Let me re-decode with that.
console.log("\n=== Stride 6-byte decode at 0x21152ae ===");
{
  let p = 0x21152ae;
  for (let i = 0; i < 30 && p + 6 <= fileEnd; i++) {
    const u32 = buf.readUInt32LE(p);
    const u16 = buf.readUInt16LE(p + 4);
    console.log(`  @0x${p.toString(16)}: u32=0x${u32.toString(16)} u16=${u16}`);
    p += 6;
  }
}

// Look at the structure of the bytes 0x21152ae - 64
console.log("\n=== Hex 0x21152a0..EOF ===");
for (let off = 0x21152a0; off < fileEnd; off += 16) {
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 16; j++) {
    const b = buf[off + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  console.log(`  0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
}

// Look at the structure of the last 4 bytes — is there a magic / count?
console.log("\n=== Hex final 32 bytes ===");
{
  const off = fileEnd - 32;
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 32; j++) {
    const b = buf[off + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  console.log(`  0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
}
