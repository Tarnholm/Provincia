// dig-model-strings1.js — Decode the 290KB Settlement model strings block.
// Per session 14: 688 references to 24 unique architectural models at 0x1f47abd..0x1f8f97b.
// Each reference: [u16 strLen][ASCII model name].
// Question: what structure surrounds each reference? Per-settlement? per-army-camp? per-event?

const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

const BLOCK_START = 0x1f47abd;
const BLOCK_END = 0x1f8f97b;

// Find every model name. Pattern: [u16 strLen][ASCII strLen bytes].
// strLen 8..40, all chars are A-Z, a-z, 0-9, _
function isModelChar(b) { return (b>=0x41&&b<=0x5a)||(b>=0x61&&b<=0x7a)||(b>=0x30&&b<=0x39)||b===0x5f; }

const refs = [];
let p = BLOCK_START;
while (p + 2 < BLOCK_END) {
  const len = buf.readUInt16LE(p);
  if (len >= 8 && len <= 40 && p + 2 + len <= BLOCK_END) {
    let ok = true;
    for (let i = 0; i < len; i++) {
      if (!isModelChar(buf[p + 2 + i])) { ok = false; break; }
    }
    if (ok) {
      const name = buf.slice(p + 2, p + 2 + len).toString("ascii");
      // Only count real model names (capital + at least one underscore or capital sequence)
      if (/^[A-Z_].*[A-Za-z]$/.test(name) && name.length >= 8) {
        refs.push({ off: p, len, name });
        p += 2 + len;
        continue;
      }
    }
  }
  p++;
}
console.log(`Total model refs: ${refs.length}`);

// Compute deltas between consecutive refs
const deltas = [];
for (let i = 1; i < refs.length; i++) {
  deltas.push(refs[i].off - refs[i - 1].off);
}
// Histogram of deltas
const hist = {};
for (const d of deltas) hist[d] = (hist[d] || 0) + 1;
const top = Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 30);
console.log("\nTop 30 delta values:");
for (const [d, c] of top) console.log(`  delta=${d}: ${c}`);

// Look at the bytes between consecutive refs to find structure
console.log("\n=== First 5 refs with surrounding context ===");
for (let i = 0; i < 5; i++) {
  const r = refs[i];
  console.log(`\n  ref[${i}] @0x${r.off.toString(16)} "${r.name}" (len=${r.len})`);
  const dumpStart = Math.max(BLOCK_START, r.off - 32);
  const dumpEnd = Math.min(BLOCK_END, r.off + r.len + 32);
  for (let off = dumpStart; off < dumpEnd; off += 16) {
    const hex = [];
    const ascii = [];
    for (let j = 0; j < 16; j++) {
      if (off + j >= dumpEnd) break;
      const b = buf[off + j];
      hex.push(b.toString(16).padStart(2, "0"));
      ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
    }
    console.log(`    0x${off.toString(16)}: ${hex.join(" ").padEnd(48)}  ${ascii.join("")}`);
  }
}

// Distribution of names
const nameFreq = {};
for (const r of refs) nameFreq[r.name] = (nameFreq[r.name] || 0) + 1;
const sortedNames = Object.entries(nameFreq).sort((a, b) => b[1] - a[1]);
console.log("\n=== Model name frequencies ===");
for (const [n, c] of sortedNames) console.log(`  ${n}: ${c}`);
