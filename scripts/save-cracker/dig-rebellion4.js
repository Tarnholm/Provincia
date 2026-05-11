// dig-rebellion4.js — Walk the chrysaoria block using taw section grammar
// at sub-record level.
//
// Standard taw section preamble: [u32 typeHash][u32 selfPtr=hereAddr+0][u32 size=offset where this section ends].
// At chrysaoria recStart 0x18d3741: typeHash=0xcc17acbf  selfPtr=0x18d3745  (= 0x18d3741 + 4)  size=0x0f=15
// If size=15 means the section is 15 bytes after the (selfPtr+0), then end = 0x18d3745 + 15 = 0x18d3754.
// But we see another self-ptr at 0x18d375d, distance 0x18d375d - 0x18d3754 = 0x9 = 9 bytes gap.
//
// Alternative: size is in u32 stride, so 15 u32s × 4 = 60 bytes. 0x18d3745+60 = 0x18d3781. The next self at 0x18d3793 is 18 bytes after that.
//
// Yet another: maybe selfPtr is not "selfPtr+4" but a "pointer to end of section". Test: at 0x18d3741, selfPtr=0x18d3745 = 0x18d3741+4. If we interpret it as "end of header" pointer, then the next section starts at... we still need size info.
//
// Let me instead check taw format used elsewhere in body — find a known section type and see its size encoding.

const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

// First test: find the END of chrysaoria block. chrysaoria is followed by 16 zeros + `03 00 01` + cilicians strLen.
// cilicians strLenOff = 0x18d4821, so 0x18d4821 - 19 = 0x18d480e is start of preamble.
// The 16-zero block at 0x18d480e..0x18d481d, then `03 00 01` at 0x18d481e..0x18d4820, then 0x4d 0x00 strLen at 0x18d4821.
//
// So chrysaoria's last record ends at 0x18d480e. recStart=0x18d3741. Payload = 0x18d480e - 0x18d3741 = 0xcd = 205 bytes? wait let me recompute.
// 0x18d480e - 0x18d3741 = 0x10cd = 4301 bytes. Matches our earlier compute.
// 4301 bytes for 75 records = 57.34 bytes/record on average.

const chrysaoriaStart = 0x18d3741;
const chrysaoriaEnd = 0x18d480e;
const chrysaoriaCount = 75;
console.log(`chrysaoria block: 0x${chrysaoriaStart.toString(16)}..0x${chrysaoriaEnd.toString(16)} = ${chrysaoriaEnd-chrysaoriaStart} bytes / ${chrysaoriaCount} count`);

// Dump first 256 bytes
console.log("\n=== First 256 bytes of chrysaoria payload ===");
for (let i = 0; i < 16; i++) {
  const off = chrysaoriaStart + i * 16;
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 16; j++) {
    const b = buf[off + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  console.log(`  0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
}

// Show the LAST 96 bytes
console.log("\n=== Last 96 bytes of chrysaoria payload ===");
for (let i = -6; i < 0; i++) {
  const off = chrysaoriaEnd + i * 16;
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 16; j++) {
    const b = buf[off + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  console.log(`  0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
}

// Try walking the block as taw sections: [u32 hash][u32 selfPtr=here+4][u32 size]
// where size = entire-section-size including header (12 bytes).
console.log("\n=== Walk chrysaoria as taw sections ===");
let p = chrysaoriaStart;
let recIdx = 0;
const sectionTypes = {};
while (p < chrysaoriaEnd - 12) {
  const hash = buf.readUInt32LE(p);
  const selfPtr = buf.readUInt32LE(p + 4);
  const size = buf.readUInt32LE(p + 8);
  const validSelf = selfPtr === p + 4;
  if (!validSelf) {
    console.log(`  break at 0x${p.toString(16)}: selfPtr=0x${selfPtr.toString(16)} != p+4=0x${(p+4).toString(16)}`);
    break;
  }
  console.log(`  [${recIdx}] @0x${p.toString(16)} hash=0x${hash.toString(16)} size=${size}`);
  sectionTypes[hash.toString(16)] = (sectionTypes[hash.toString(16)] || 0) + 1;
  // Section end depends on interpretation. Try: section = 12-byte header + size bytes of payload
  // Or:    section ends at byte (p + size)
  // Test both, pick one that lands on the next plausible hash.
  p = p + 12 + size;
  recIdx++;
  if (recIdx > 100) break;
}
console.log(`\n  section types histogram: ${JSON.stringify(sectionTypes)}`);

// Look at unique 32-bit hashes appearing at presumed section starts (positions where readUInt32LE(p+4) === p+4)
console.log("\n=== All taw-style headers in chrysaoria block ===");
const headers = [];
for (let p = chrysaoriaStart; p < chrysaoriaEnd - 12; p++) {
  const selfPtr = buf.readUInt32LE(p + 4);
  if (selfPtr !== p + 4) continue;
  const hash = buf.readUInt32LE(p);
  const size = buf.readUInt32LE(p + 8);
  headers.push({ off: p, hash, size });
}
console.log(`  total taw-style headers: ${headers.length}`);
// Group by hash
const byHash = {};
for (const h of headers) {
  const k = h.hash.toString(16);
  if (!byHash[k]) byHash[k] = [];
  byHash[k].push(h);
}
for (const k of Object.keys(byHash)) {
  const arr = byHash[k];
  console.log(`  hash=0x${k} × ${arr.length}`);
  for (const h of arr.slice(0, 3)) {
    console.log(`    @0x${h.off.toString(16)} size=${h.size}`);
  }
}
