// dig-tail2.js — Cluster tail strings by region and dump unique ASCII tokens.
// We want to know: what kinds of strings appear, and are they grouped or spread?

const fs = require("fs");
const path = require("path");

const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

const tailStart = 0x1f10c72;
const tailEnd = buf.length;

// ---- Collect all ASCII strings (>= 4) again
const asciiHits = [];
let start = -1;
for (let p = tailStart; p < tailEnd; p++) {
  const b = buf[p];
  if (b >= 0x20 && b <= 0x7e) {
    if (start === -1) start = p;
  } else {
    if (start !== -1 && p - start >= 4) {
      asciiHits.push({ off: start, len: p - start, s: buf.slice(start, p).toString("ascii") });
    }
    start = -1;
  }
}

// Unique tokens, with first-offset and count
const tokFirst = new Map();
const tokCount = new Map();
for (const h of asciiHits) {
  if (!tokFirst.has(h.s)) tokFirst.set(h.s, h.off);
  tokCount.set(h.s, (tokCount.get(h.s) || 0) + 1);
}
console.log(`# Unique ASCII tokens in tail: ${tokFirst.size}\n`);

// Sort by first-offset
const sortedByOff = [...tokFirst.entries()].sort((a, b) => a[1] - b[1]);
console.log("First 80 unique tokens (in order of first appearance):");
for (let i = 0; i < Math.min(80, sortedByOff.length); i++) {
  const [s, off] = sortedByOff[i];
  console.log(`  @0x${off.toString(16)} (n=${tokCount.get(s)}) ${JSON.stringify(s)}`);
}

console.log(`\nLast 30 unique tokens (in order of first appearance):`);
for (let i = Math.max(0, sortedByOff.length - 30); i < sortedByOff.length; i++) {
  const [s, off] = sortedByOff[i];
  console.log(`  @0x${off.toString(16)} (n=${tokCount.get(s)}) ${JSON.stringify(s)}`);
}

// Categorize by content patterns
function classify(s) {
  if (/^W_/.test(s)) return "W_model";
  if (/bodyguard/.test(s)) return "unit_bg";
  if (s.toLowerCase().includes("general")) return "unit_general";
  if (/^_+/.test(s)) return "padding";
  if (/^[a-z_]+$/.test(s)) return "lowercase_token";
  if (/^[A-Z][a-z_]+$/.test(s)) return "cap_word";
  if (/^[a-zA-Z_]+\d/.test(s)) return "mixed_id";
  return "other";
}
const classes = {};
for (const s of tokFirst.keys()) {
  const c = classify(s);
  classes[c] = (classes[c] || 0) + 1;
}
console.log("\nClassification of tokens:");
for (const [c, n] of Object.entries(classes).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${c}: ${n}`);
}

// Cluster strings spatially: build a histogram per 64KB tail-block.
const BLOCK = 0x10000;
const blocks = new Map();
for (const h of asciiHits) {
  const b = Math.floor((h.off - tailStart) / BLOCK);
  if (!blocks.has(b)) blocks.set(b, []);
  blocks.get(b).push(h);
}
console.log("\nPer-64KB block: ascii-hit count and sample (first 32 blocks):");
for (let i = 0; i < 33; i++) {
  const list = blocks.get(i) || [];
  if (!list.length) continue;
  const sample = list.slice(0, 2).map(h => h.s.slice(0, 30)).join(" | ");
  const blockStart = tailStart + i * BLOCK;
  console.log(`  block ${String(i).padStart(2)} @0x${blockStart.toString(16)}: ${list.length} hits — ${sample}`);
}
