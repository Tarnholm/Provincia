// dig-tail3.js — Probe tail substructures more finely.
//  - what's in 0x1f90c72..0x20c0c72 (no ascii strings hit)
//  - decode the unit/army block at start of tail (0x1f10c72..~0x1f50c72)
//  - decode the male/female name tables at end (0x20f0c72..EOF)

const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);
const tailStart = 0x1f10c72;

// ---- 1. Probe tail header: first 256 bytes of tail.
console.log("# First 256 bytes of tail:");
for (let i = 0; i < 16; i++) {
  const off = tailStart + i * 16;
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 16; j++) {
    const b = buf[off + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  console.log(`  0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
}

// ---- 2. Probe boundary between sections.
function dump(label, off, count = 6) {
  console.log(`\n# ${label} @0x${off.toString(16)}:`);
  for (let i = 0; i < count; i++) {
    const o = off + i * 16;
    const hex = [];
    const ascii = [];
    for (let j = 0; j < 16; j++) {
      const b = buf[o + j];
      hex.push(b.toString(16).padStart(2, "0"));
      ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
    }
    console.log(`  0x${o.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
  }
}

// Around the unit zone start
dump("Around 0x1f10c72 (tail start)", 0x1f10c72);
// Around 0x1f50c72 where models start
dump("Around 0x1f44000 (gap before models)", 0x1f44000);
// Around the W_ models start
dump("Around W_models start", 0x1f47abd - 32);
// Around the big numeric blob (0x1f90c72-0x20c0c72)
dump("0x1fa0000 (silent zone)", 0x1fa0000);
dump("0x2000000 (silent zone)", 0x2000000);
dump("0x2080000 (silent zone)", 0x2080000);
dump("0x20bf000 end of silent zone", 0x20bf000);
dump("0x20c0c72 (block 27 — first hit was 'roman')", 0x20c0c72);
dump("0x20d0c72 (block 28 — barbarian)", 0x20d0c72);
dump("0x20f0c72 (block 30 — eastern)", 0x20f0c72);
dump("0x2100c72 (block 31 — names start)", 0x2100c72);

// ---- 3. Find the "thracian royal bodyguards" 11-instance cluster.
// 11 instances strongly suggests a unit-record array.
console.log("\n# Search for 'thracian royal bodyguards' instances:");
const needle = Buffer.from("thracian royal bodyguards", "ascii");
let p = 0;
while ((p = buf.indexOf(needle, p)) !== -1) {
  // Show 32 bytes before & after
  const pre = buf.slice(Math.max(0, p - 16), p).toString("hex");
  const post = buf.slice(p + needle.length, p + needle.length + 32).toString("hex");
  console.log(`  @0x${p.toString(16)}: pre=...${pre} POST=${post}`);
  p++;
}
