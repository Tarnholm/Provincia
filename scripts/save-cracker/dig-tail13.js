// dig-tail13.js — Decode the W_models area and the "silent" alternating
// 00-ff pattern + small-int blocks 0x1f88000 .. 0x2110a24.

const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

// W_models area runs 0x1f47abd..0x1f88... — find its exact end (last W_ string)
const needle = Buffer.from("W_", "ascii");
let p = 0x1f47000;
let lastW = -1;
while ((p = buf.indexOf(needle, p)) !== -1) {
  // Check it's a real W_xxx string
  if (buf[p + 2] >= 0x61 && buf[p + 2] <= 0x7a) lastW = p;
  p++;
  if (p > 0x1fa0000) break;
}
console.log(`Last W_ string in models area: 0x${lastW.toString(16)}`);
// Where does it end?
let endPtr = lastW;
while (endPtr < buf.length && buf[endPtr] >= 0x20 && buf[endPtr] <= 0x7e) endPtr++;
console.log(`Last W_ ends at: 0x${endPtr.toString(16)}, string: ${JSON.stringify(buf.slice(lastW, endPtr).toString("ascii"))}`);

// Last non-W settlement model
const settlementModelEnd = 0x1f88000;  // approximate

// Show what comes immediately after the model area
console.log("\n=== Hex 0x1f88000..0x1f88200 (after model area) ===");
for (let i = 0; i < 32; i++) {
  const off = 0x1f88000 + i * 16;
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 16; j++) {
    const b = buf[off + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  console.log(`  0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
}

// Look at the 00-ff alternating pattern at 0x1fa0000.
// `00 ff 00 ff 00 ff` — this is 2-byte stride where byte 0 = 00 and byte 1 = ff.
// Some places have `00 cd 01 32` — 4-byte stride.
console.log("\n=== Decode 0x1fa0000 with various strides ===");
// 2-byte stride: looks like u16 = 0xff00 = 65280
// 4-byte stride: maybe u16 LE pair
{
  console.log("As u16 (2-byte stride) — first 30:");
  for (let i = 0; i < 30; i++) {
    const off = 0x1fa0000 + i * 2;
    const v = buf.readUInt16LE(off);
    process.stdout.write(`${v.toString().padStart(5)} `);
  }
  console.log();
  console.log("\nAs (u8,u8) (2-byte stride) — first 60:");
  for (let i = 0; i < 60; i++) {
    const off = 0x1fa0000 + i * 2;
    const a = buf[off], b = buf[off + 1];
    process.stdout.write(`(${a},${b}) `);
  }
  console.log();
}

// What if it's 4-byte stride? Look at 0x2000000 area.
console.log("\n=== 0x2000000 with 4-byte stride ===");
for (let i = 0; i < 30; i++) {
  const off = 0x2000000 + i * 4;
  const u32 = buf.readUInt32LE(off);
  const u16a = buf.readUInt16LE(off);
  const u16b = buf.readUInt16LE(off + 2);
  process.stdout.write(`[${u16a.toString().padStart(4)},${u16b.toString().padStart(4)}] `);
  if (i % 10 === 9) console.log();
}
console.log();

// Look for transitions between 00-ff zone (lots of zeros) and the small-int zones:
// Walk from 0x1f88000 forward in 4KB chunks counting 0x00ff word frequency.
console.log("\n=== Pattern scan 0x1f88000..0x2110a24 — count of 0x00ff 16-bit BE words per 4KB ===");
let prevType = "";
for (let bi = 0; bi < (0x2110a24 - 0x1f88000) / 0x1000; bi++) {
  const off = 0x1f88000 + bi * 0x1000;
  // Count words equal to 0x00 0xff (LE = 0xff00 = 65280)
  let n00ff = 0;
  let nSmallU16 = 0; // u16 with high byte = 0
  let nU16WithFf = 0; // u16 with high byte = ff
  for (let p = off; p < off + 0x1000 - 1; p += 2) {
    const w = buf.readUInt16LE(p);
    if (w === 0xff00) n00ff++;
    else if ((w & 0xff00) === 0) nSmallU16++;
    else if ((w & 0xff00) === 0xff00) nU16WithFf++;
  }
  let type;
  if (n00ff > 400) type = "MOSTLY-00FF";
  else if (nSmallU16 > 1000) type = "MOSTLY-LOW-U16";
  else if (nU16WithFf > 200) type = "FF-PATTERN";
  else type = "MIXED";
  if (type !== prevType || bi < 5) {
    console.log(`  block @0x${off.toString(16)}: 00ff=${n00ff} smallU16=${nSmallU16} ffU16=${nU16WithFf} → ${type}`);
    prevType = type;
  }
}
