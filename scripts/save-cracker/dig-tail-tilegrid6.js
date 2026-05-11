// dig-tail-tilegrid6.js — There are 485 self-pointers in the alt-grid region,
// in pairs offset by 4 bytes. This is the TAW section header pattern:
//   [u32 selfPtr][u32 size][...payload...]
// Let me walk these as sections and see what's inside.

const fs = require("fs");

const ROME10 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";

const buf = fs.readFileSync(ROME10);

// We saw self-pointer pairs at 0x1f4a463+0x1f4a467, 0x1f4c57b+0x1f4c57f, etc.
// But that's just u32 == p ... two u32's at p and p+4 both = p? No, the SECOND
// selfPtr at p+4 would need to be p+4. Let's verify.

console.log("===== Verifying self-ptr pair structure =====");
const pairs = [0x1f4a463, 0x1f4c57b, 0x1f4e693, 0x1f510cd, 0x1f53a73, 0x1f57702, 0x1fa847b];
for (const p of pairs) {
  const a = buf.readUInt32LE(p);
  const b = buf.readUInt32LE(p + 4);
  console.log(`  0x${p.toString(16)}: u32@p=0x${a.toString(16)}, u32@p+4=0x${b.toString(16)}, match? ${a === p}, b=p+4? ${b === p + 4}`);
}

// Sample some self-pointers and dump 64 bytes after.
console.log("\n===== Hex dumps around self-pointer-pair positions =====");
const samples = [0x1f4a463, 0x1f4c57b, 0x1f4e693, 0x1f510cd, 0x1f53a73, 0x1f57702];
for (const p of samples) {
  console.log(`\n--- 0x${p.toString(16)} ---`);
  // Dump 48 bytes before and 96 after
  for (let row = -3; row < 6; row++) {
    const o = p + row * 16;
    if (o < 0) continue;
    const hex = [];
    const ascii = [];
    for (let j = 0; j < 16; j++) {
      const b = buf[o + j];
      hex.push(b.toString(16).padStart(2, "0"));
      ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
    }
    const marker = row === 0 ? " <-- p" : "";
    console.log(`  0x${o.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}${marker}`);
  }
}

// Now: walk all 485 self-pointer pairs in order. Are they regularly spaced?
console.log("\n===== Self-ptr pair spacing =====");
const altStart = 0x1f4847b;
const altEnd = 0x210f4e5;
const ptrs = [];
for (let p = altStart; p < altEnd - 7; p += 1) {
  const v = buf.readUInt32LE(p);
  if (v === p) {
    const v2 = buf.readUInt32LE(p + 4);
    if (v2 === p + 4) {
      ptrs.push(p);
    }
  }
}
console.log(`Total pair-self-pointers: ${ptrs.length}`);
// Spacing histogram
const spacings = [];
for (let i = 1; i < ptrs.length; i++) spacings.push(ptrs[i] - ptrs[i-1]);
const spaceHist = new Map();
for (const s of spacings) spaceHist.set(s, (spaceHist.get(s) || 0) + 1);
const sortedSpace = [...spaceHist.entries()].sort((a, b) => b[1] - a[1]);
console.log(`Distinct spacings: ${sortedSpace.length}`);
console.log(`Top 15 spacings: ${sortedSpace.slice(0, 15).map(([s, c]) => `${s}=${c}`).join(" ")}`);

// What's the median spacing?
const sortedSpacings = [...spacings].sort((a, b) => a - b);
console.log(`Min spacing: ${sortedSpacings[0]}`);
console.log(`Median: ${sortedSpacings[Math.floor(sortedSpacings.length / 2)]}`);
console.log(`Max: ${sortedSpacings[sortedSpacings.length - 1]}`);

// First 10 records: dump the leading header (after the 8 bytes selfPtr/selfPtr+4)
console.log("\n===== First 12 record headers (after the 8-byte self-ptr pair) =====");
for (let i = 0; i < 12 && i < ptrs.length; i++) {
  const p = ptrs[i];
  const nextP = i + 1 < ptrs.length ? ptrs[i + 1] : altEnd;
  const recLen = nextP - p;
  // Bytes after the 8-byte pair:
  const headOff = p + 8;
  const hexBytes = [];
  for (let j = 0; j < Math.min(48, recLen - 8); j++) hexBytes.push(buf[headOff + j].toString(16).padStart(2, "0"));
  console.log(`  [${i}] @0x${p.toString(16)} len=${recLen}: head bytes after selfPtr-pair = ${hexBytes.join(" ")}`);
}
