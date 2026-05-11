// dig-rebellion8.js — Dump the FIRST 256 bytes of each rebellion block's head,
// and also look at WHAT FOLLOWS the 239-row faction array.

const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

const blocks = [
  { name: "chrysaoria", recStart: 0x18d3741, count: 75,  factionArrStart: 0x18d3821, factionArrEnd: 0x18d4711 },
  { name: "cilicians",  recStart: 0x18d48cb, count: 76,  factionArrStart: 0x18e7f4b, factionArrEnd: 0x18e8e3b },
  { name: "egypt",      recStart: 0x1956838, count: 95,  factionArrStart: 0x19af6f8, factionArrEnd: 0x19b05e8 },
  { name: "lycia",      recStart: 0x1ab16e1, count: 144, factionArrStart: 0x1ace821, factionArrEnd: 0x1acf711 },
  { name: "miletus",    recStart: 0x1b0f06d, count: 159, factionArrStart: 0x1b765dd, factionArrEnd: 0x1b774cd },
  { name: "thessaly",   recStart: 0x1c93a64, count: 213, factionArrStart: 0x1c99b64, factionArrEnd: 0x1c9aa54 },
];

for (const b of blocks) {
  const headSize = b.factionArrStart - b.recStart;
  console.log(`\n=== ${b.name} count=${b.count} headSize=${headSize} headBytes/count=${(headSize/b.count).toFixed(2)} ===`);
}

// What's the average "head size per count" — does it suggest the head is count×K?
// chrysaoria: 224 bytes / 75 = 2.99
// cilicians: ?
// Most chrysaoria head bytes are zero. Hmm. Maybe count is not records in the head.

// What's AFTER the 239-row array?
// chrysaoria: factionArrEnd=0x18d4711. Next block (cilicians) strLenOff=0x18d4821. Gap = 0x18d4821 - 0x18d4711 = 0x110 = 272 bytes.
// In that gap is the 16-zero preamble + 03 00 01 + u16 strLen + ... actually that's not 272.
// The cilicians strLenOff is 0x18d4821; the 16-zero preamble starts at 0x18d480e. So we have a 0xfd=253 byte tail after factionArrEnd.

console.log("\n=== chrysaoria tail bytes (after faction array, before next block) ===");
for (let off = 0x18d4711; off < 0x18d4821; off += 16) {
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 16; j++) {
    if (off + j >= 0x18d4821) break;
    const b = buf[off + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  console.log(`  0x${off.toString(16)}: ${hex.join(" ").padEnd(48)}  ${ascii.join("")}`);
}

// Now examine the cilicians HEAD region (it's 78kb so larger)
console.log("\n=== cilicians head bytes (first 256) ===");
for (let off = 0x18d48cb; off < 0x18d48cb + 256; off += 16) {
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 16; j++) {
    const b = buf[off + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  console.log(`  0x${off.toString(16)}: ${hex.join(" ").padEnd(48)}  ${ascii.join("")}`);
}

// cilicians faction-array starts at 0x18e7f4b. Head = 0x18e7f4b - 0x18d48cb = 0xf680 = 63104 bytes.
// 63104 / 76 = 830 bytes per record. That's reasonable for a "Big" record.
// Egypt head = 0x19af6f8 - 0x1956838 = 0x58ec0 = 363200. 363200/95 = 3823 bytes per record. Hmm, varies a lot.

// What's the THIRD pattern in head — possibly a "previous-rebellion was here" array of regions
// embedded character/army records? Let me look at the start of cilicians head:
//   36 1e 53 68 cf 48 8d 01 01 00 00 00 ...
// Could be: [u32 hash][u32 selfPtr+4][u32 count] — looking like a TAW section.
// hash=0x68531e36, selfPtr=0x18d48cf (= start+4 = 0x18d48cb+4), then count=1.
//
// Then at 0x18d48d7 we have: 28 37 52 f8 c7 bf ad 03 50 cc 1a e0  — 12 bytes that look hash-like
// At 0x18d48e3: 00 00 00 00 e7 48 8d 01 ...
//   0x18d48e7 has self-ptr 0x18d48e7 (yes).
//
// So perhaps: [hash][selfPtr][u32 count][count × subrecord]
// Where the subrecord at 0x18d48d7 might be a 16-byte uuid + 4-byte spacer + nested section.

// Let me check whether the head looks like nested rebellion-event records.
// Try walk: at 0x18d48cb, this is a wrapper section with [hash 0x68531e36][selfPtr][count=1] meaning 1 wrapper subrecord.
// At 0x18d48d7 starts subrecord 0: 16 bytes of "uuid? hash?" then at 0x18d48e7 another section.
console.log("\n=== egypt head bytes (first 256) ===");
for (let off = 0x1956838; off < 0x1956838 + 256; off += 16) {
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 16; j++) {
    const b = buf[off + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  console.log(`  0x${off.toString(16)}: ${hex.join(" ").padEnd(48)}  ${ascii.join("")}`);
}
