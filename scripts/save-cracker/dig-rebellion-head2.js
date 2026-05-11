// dig-rebellion-head2.js — Decode per-general record structure inside rebellion HEAD.
// Cilicians has 28 generals, easy to walk. Each portrait-pair pattern is:
//   data/ui/<culture>/portraits/cards/young/generals/NNN.tga
//   data/ui/<culture>/portraits/portraits/young/generals/NNN.tga
// Between consecutive pairs there's per-general data (likely settlement name, age,
// traits, ancillaries).

const fs = require("fs");

const ROME10 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(ROME10);

// Walk the cilicians head from 0x18d48cb to 0x18e7f4b
const HEAD_START = 0x18d48cb;
const HEAD_END = 0x18e7f4b;

// Find all "data/ui/" occurrences
const dataNeedle = Buffer.from("data/ui/", "ascii");
const portraits = [];
let p = HEAD_START;
while ((p = buf.indexOf(dataNeedle, p)) !== -1 && p < HEAD_END) {
  let end = p;
  while (end < HEAD_END && buf[end] >= 0x20 && buf[end] <= 0x7e) end++;
  portraits.push({ off: p, end, s: buf.slice(p, end).toString("ascii") });
  p = end;
}
console.log(`Cilicians head: ${portraits.length} portrait references`);

// Walk per-pair (cards followed by portraits)
// Pair indices: 0, 2, 4, ... — both should be same NNN.
const general = [];
for (let i = 0; i + 1 < portraits.length; i += 2) {
  const a = portraits[i];
  const b = portraits[i + 1];
  general.push({ card: a, port: b });
}
console.log(`Generals: ${general.length}`);

// For each general, look at the bytes BEFORE the card portrait (~64 bytes) for structure.
console.log(`\n===== First 4 generals: structure before card portrait =====`);
for (let i = 0; i < 4 && i < general.length; i++) {
  const g = general[i];
  console.log(`\n--- General ${i} ---`);
  console.log(`  Card: 0x${g.card.off.toString(16)}: ${g.card.s}`);
  console.log(`  Port: 0x${g.port.off.toString(16)}: ${g.port.s}`);
  // Print 80 bytes before card
  console.log(`  Bytes before card (40 bytes):`);
  const startCtx = g.card.off - 40;
  for (let row = 0; row < 3; row++) {
    const off = startCtx + row * 16;
    const hex = [];
    const ascii = [];
    for (let j = 0; j < 16; j++) {
      const b = buf[off + j];
      hex.push(b.toString(16).padStart(2, "0"));
      ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
    }
    console.log(`    0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
  }
  // Between card and port
  console.log(`  Bytes between card and port:`);
  for (let row = 0; row < 2; row++) {
    const off = g.card.end + row * 16;
    if (off > g.port.off) break;
    const hex = [];
    const ascii = [];
    for (let j = 0; j < 16; j++) {
      const b = buf[off + j];
      hex.push(b.toString(16).padStart(2, "0"));
      ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
    }
    console.log(`    0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
  }
  // Print AFTER port portrait (next 96 bytes — that's where traits/ancillaries would be)
  console.log(`  Bytes after port (96 bytes):`);
  for (let row = 0; row < 6; row++) {
    const off = g.port.end + row * 16;
    if (off >= HEAD_END) break;
    const hex = [];
    const ascii = [];
    for (let j = 0; j < 16; j++) {
      const b = buf[off + j];
      hex.push(b.toString(16).padStart(2, "0"));
      ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
    }
    console.log(`    0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
  }
}

// Compute spacing between consecutive generals
console.log(`\n===== Per-general spacing =====`);
const spacings = [];
for (let i = 0; i + 1 < general.length; i++) {
  const space = general[i + 1].card.off - general[i].card.off;
  spacings.push(space);
}
const sortedSpace = [...spacings].sort((a, b) => a - b);
console.log(`Per-general byte spacing: min=${sortedSpace[0]}, median=${sortedSpace[Math.floor(sortedSpace.length / 2)]}, max=${sortedSpace[sortedSpace.length - 1]}`);
console.log(`Spacing histogram:`);
const spaceHist = new Map();
for (const s of spacings) {
  const bucket = Math.floor(s / 100) * 100;
  spaceHist.set(bucket, (spaceHist.get(bucket) || 0) + 1);
}
const sortHist = [...spaceHist.entries()].sort((a, b) => a[0] - b[0]);
for (const [b, c] of sortHist) console.log(`  ${b}..${b + 99}: ${c}x`);

// Check: do generals in the head match the generals "spawned" by the script?
// Cross-reference with body-root general portraits — are these in the body or new?
console.log(`\n===== Portrait paths uniqueness =====`);
const portraitsCardsSet = new Set();
for (const g of general) {
  const m = g.card.s.match(/generals\/(\d+)\.tga/);
  if (m) portraitsCardsSet.add(m[1]);
}
console.log(`Distinct general portrait IDs in cilicians head: ${portraitsCardsSet.size}`);
console.log(`IDs: ${[...portraitsCardsSet].sort().join(", ")}`);
