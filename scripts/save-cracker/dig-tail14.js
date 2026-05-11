// dig-tail14.js — Decode area BEFORE lua counters (between W_models end and lua).
// W_models end ~0x1f8f97b. Lua counters start 0x210f56f. Distance: ~1.84MB.
//
// Looking at 0x210f46f (just before the path string): there's a sequence of
// 4-byte values. The path-string section starts with `00 35 00 00 00 e0 f4 10 02 01`
// which looks like a section preamble: [u32 some][u32 offset0x0210f4e0][u16 0x0101]
//
// Find structure of this area.

const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

// What's right after W_models? 0x1f8f97b onwards
console.log("=== 0x1f8f97b onwards (after last W_ model) ===");
for (let i = 0; i < 16; i++) {
  const off = 0x1f8f97b + i * 16;
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 16; j++) {
    const b = buf[off + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  console.log(`  0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
}

// And up to 0x1f8ffff
console.log("\n=== 0x1f90000 (after model section) ===");
for (let i = 0; i < 8; i++) {
  const off = 0x1f90000 + i * 16;
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 16; j++) {
    const b = buf[off + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  console.log(`  0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
}

// Where does the 0xff_00-stride zone START and END?
// Find first occurrence of `00 ff 00 ff 00 ff` after tailStart
const tailStart = 0x1f10c72;
const zonePat = Buffer.from("00ff00ff00ff", "hex");
const ff00Start = buf.indexOf(zonePat, tailStart);
console.log(`\nFirst 00-ff-00-ff zone start: 0x${ff00Start.toString(16)}`);
// Find where it ENDS (look forward for non-pattern)
let ff00End = ff00Start;
while (ff00End + 2 < buf.length) {
  // Check next 64 bytes for the pattern
  let bad = 0;
  for (let i = 0; i < 64; i += 2) {
    if (ff00End + i + 1 >= buf.length) break;
    if (!(buf[ff00End + i] === 0 && buf[ff00End + i + 1] === 0xff)) bad++;
  }
  if (bad > 30) break;  // 30/32 differ → not in zone
  ff00End += 32;
}
console.log(`Last contiguous 00-ff zone end (approx): 0x${ff00End.toString(16)}`);

// What's at 0x210f4xx — section header preamble
console.log("\n=== 0x210f400 - 0x210f56f (before lua counters) ===");
for (let i = 0; i < 16; i++) {
  const off = 0x210f470 + i * 16;
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 16; j++) {
    const b = buf[off + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  console.log(`  0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
}

// Locate ALL UTF-16LE paths in the file (anything containing "/" prefix or "\\")
console.log("\n=== UTF-16LE filepaths anywhere in file ===");
const paths = [];
for (let p = 0; p + 10 < buf.length; p += 1) {
  // Look for ".txt" pattern in UTF-16LE = `2e 00 74 00 78 00 74 00`
  if (buf[p] === 0x2e && buf[p + 1] === 0 && buf[p + 2] === 0x74 && buf[p + 3] === 0 &&
      buf[p + 4] === 0x78 && buf[p + 5] === 0 && buf[p + 6] === 0x74 && buf[p + 7] === 0) {
    // Walk back to find start
    let start = p;
    while (start - 2 >= 0 && buf[start - 1] === 0 && buf[start - 2] >= 0x20 && buf[start - 2] <= 0x7e) {
      start -= 2;
    }
    const s = buf.slice(start, p + 8).toString("utf16le");
    paths.push({ off: start, s });
    p += 8;
  }
}
console.log(`Found ${paths.length} ".txt" paths:`);
for (const p of paths.slice(0, 20)) {
  console.log(`  @0x${p.off.toString(16)}: ${p.s}`);
}

// Look for any other interesting UTF-16LE strings in the tail
console.log("\n=== Look for >32-char UTF-16LE strings throughout tail ===");
for (let p = tailStart; p + 6 < buf.length; p += 1) {
  const len = buf.readUInt16LE(p);
  if (len < 32 || len > 200) continue;
  if (p + 2 + len * 2 > buf.length) continue;
  let ok = true;
  for (let i = 0; i < len; i++) {
    const c = buf.readUInt16LE(p + 2 + i * 2);
    if (c < 0x20 || c > 0x7e) { ok = false; break; }
  }
  if (!ok) continue;
  const s = buf.slice(p + 2, p + 2 + len * 2).toString("utf16le");
  console.log(`  @0x${p.toString(16)} (chars=${len}): ${JSON.stringify(s)}`);
}
