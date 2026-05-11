// dig-lua-state7.js — Decode the mod-path region at 0x43fc.
// Also: count more spawn-script-like records, and inspect the
// "lycia_revolt" tier of records to see if the count fields tell us
// rebellion progress.

const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

// Dump 0x4300..0x4800 - mod path config area
console.log("=== Region around 0x43fc (mod config) ===");
for (let i = 0; i < 32; i++) {
  const off = 0x43e0 + i * 16;
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 16; j++) {
    const b = buf[off + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  console.log(`  0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
}

// Count ALL UTF-16LE paths ending in ".txt" in body
console.log("\n=== All .txt paths anywhere ===");
const pat = Buffer.from(".txt", "utf16le");
const allTxt = [];
let p = 0;
while ((p = buf.indexOf(pat, p)) !== -1) {
  // Walk back to find start
  let start = p;
  while (start > 2) {
    const c = buf.readUInt16LE(start - 2);
    if (c < 0x20 || c > 0x7e) break;
    start -= 2;
  }
  const s = buf.slice(start, p + 8).toString("utf16le");
  allTxt.push({ off: start - 2, s });
  p++;
}
console.log(`Total .txt paths: ${allTxt.length}`);
for (const t of allTxt) {
  // u16 length prefix at off-2 should = length of s
  const lenPrefix = t.off >= 0 ? buf.readUInt16LE(t.off) : -1;
  const ok = lenPrefix === t.s.length ? "*" : " ";
  console.log(`  ${ok} @0x${t.off.toString(16)} (lenPrefix=${lenPrefix} vs ${t.s.length}): ${t.s.length <= 80 ? t.s : t.s.slice(0, 80) + "..."}`);
}

// Now look for ALL "Rebellion_" lua counter equivalents to find what record they correlate to:
// Each spawn_scripts/*.txt has trailing data: u32 selfPtr, u32 0, u32 count, then payload.
// Let me verify the count field matches lua counters.
// Lua counters parsed earlier:
//   LyciaRebellion_*: 5 counters
//   ChrysaoriaRebellion_*: 5
//   ThessalyRebellion_*: 5
//   CiliciaRebellion_*: 3
//   MiletusRebellion_*: 2
//   EgyptianRebellion_*: 2
//
// Counts from script-paths (the 3rd u32):
//   chrysaoria 0x4b=75
//   cilicians  0x4c=76
//   egypt      0x5f=95
//   lycia      0x90=144
//   miletus    0x9f=159
//   thessaly   0xd5=213
//
// These don't match the lua counter group sizes. They might be:
//  - "turns passed since rebellion started"
//  - count of records following / scripted-event log entries
//  - script line number / instruction pointer

// Cross-check turn_number:
console.log("\nThe lua counter 'turn_number' has value 0 in rome10");
console.log("Counts: 75,76,95,144,159,213 — these grow steadily and could be 'turn rebellion was last evaluated' counts.");
console.log("Or they're per-script journal-entry counts (each line of script generates 1+ entry).");
