// dig-tail4.js — Decode the unit/army records at start of tail and the
// settlement model area + look at what's in 0x1f44000..0x1f47abd (the strange
// hash-looking section before models).

const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

// The tail starts at 0x1f10c72 (end of settlement zone).
// settlement zone last byte is 0x1f10c72-1 = 0x1f10c71.
// The previous 256 bytes:
console.log("Pre-tail (last 64 bytes of settlement zone):");
for (let i = -4; i < 0; i++) {
  const off = 0x1f10c72 + i * 16;
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 16; j++) {
    const b = buf[off + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  console.log(`  0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
}

// Decode the section starting at the W_models area (0x1f47abd "W_hellenistic_Large_Town"):
// At -2 from this string is `19 00` = 25 = length. So it's a [u16 nameLen][name] record.
// Walk all such records starting around 0x1f47abd.
console.log("\n\n=== Records at 0x1f47abd (W_models) — [u16 nameLen][ASCII name] ===");
let p = 0x1f47abd - 2;  // start of length field
for (let i = 0; i < 25 && p < buf.length; i++) {
  const len = buf.readUInt16LE(p);
  if (len < 2 || len > 100) {
    console.log(`  @0x${p.toString(16)} (broken — len=${len})`);
    break;
  }
  const name = buf.slice(p + 2, p + 2 + len).toString("ascii");
  // What's right after the name? Show next 16 bytes for stride pattern detection.
  const post = buf.slice(p + 2 + len, p + 2 + len + 16);
  const postHex = [...post].map(b => b.toString(16).padStart(2, "0")).join(" ");
  console.log(`  @0x${p.toString(16)} len=${len} name=${JSON.stringify(name)} post16=${postHex}`);
  // Find next length field by looking for a u16 in 2..50 range
  let q = p + 2 + len;
  let found = false;
  for (let off = 0; off < 200 && q + off + 2 < buf.length; off++) {
    const nl = buf.readUInt16LE(q + off);
    if (nl >= 4 && nl <= 50) {
      const name2 = buf.slice(q + off + 2, q + off + 2 + nl).toString("ascii");
      if (/^[a-zA-Z0-9_]+$/.test(name2)) {
        if (off > 0) console.log(`    [gap of ${off} bytes before next name]`);
        p = q + off;
        found = true;
        break;
      }
    }
  }
  if (!found) {
    console.log(`  (no more names found after 0x${q.toString(16)})`);
    break;
  }
}

// Now decode tail-start area. The "thracian royal bodyguards" instances start at 0x1f11b07.
// 2 bytes before is `19 00` = 25 chars. Then post is `00 ee ed 1a 4a 03 1e c5 78 9d 00 00 00 00 2c 01...`
// Let's just decode the first unit record at 0x1f11b07 - 2 = 0x1f11b05 - looking for the
// real start (likely earlier with metadata before the name).
console.log("\n\n=== Probe unit record at 0x1f11b07 ===");
for (let i = -5; i < 0; i++) {
  const off = 0x1f11b05 + i * 16;
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 16; j++) {
    const b = buf[off + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  console.log(`  0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
}
console.log("  ↓ start of unit record:");
for (let i = 0; i < 8; i++) {
  const off = 0x1f11b05 + i * 16;
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 16; j++) {
    const b = buf[off + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  console.log(`  0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
}

// Look at 0x1f44000 (hash-looking area)
console.log("\n\n=== 0x1f441e0..0x1f47abd area (between unit records and model strings) ===");
for (let i = 0; i < 20; i++) {
  const off = 0x1f441e0 + i * 16;
  if (off > 0x1f47abd) break;
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 16; j++) {
    const b = buf[off + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  console.log(`  0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
}

// And right before the models start
console.log("\n=== 0x1f47a40..0x1f47abd (immediately before models) ===");
for (let i = 0; i < 8; i++) {
  const off = 0x1f47a40 + i * 16;
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 16; j++) {
    const b = buf[off + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  console.log(`  0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
}
