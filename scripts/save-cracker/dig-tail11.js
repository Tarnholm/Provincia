// dig-tail11.js — Decode the tile-coord trail records at end of file.
//
// Pattern is [u32 self-ptr][u16 count][count × [u32 X][u32 Y]]
// Each record is then immediately followed by another self-ptr.

const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

const fileEnd = buf.length;

// Walk back from EOF: starting at the last self-ptr, decode.
// Last self-ptr in tail was 0x211538e from prev output.
// But records also have 0-count form (just self+u16 0)

// Find the start of the array: walk forward starting from somewhere reasonable
// and find first record whose self-ptr matches.

console.log("=== Walk all self-pointing records at end of file ===");
let p = 0x2115000;  // start guess
let recs = [];
let firstSelf = -1;
while (p + 6 <= fileEnd) {
  const sp = buf.readUInt32LE(p);
  if (sp === p) {
    const cnt = buf.readUInt16LE(p + 4);
    if (cnt >= 0 && cnt <= 50 && p + 6 + cnt * 8 <= fileEnd) {
      if (firstSelf === -1) firstSelf = p;
      const pairs = [];
      for (let i = 0; i < cnt; i++) {
        pairs.push([buf.readUInt32LE(p + 6 + i * 8), buf.readUInt32LE(p + 6 + i * 8 + 4)]);
      }
      recs.push({ off: p, count: cnt, pairs });
      p += 6 + cnt * 8;
      continue;
    }
  }
  p++;
}
console.log(`Records found from 0x2115000 to EOF: ${recs.length}`);
console.log(`First self-ptr: 0x${firstSelf.toString(16)}`);
// Show first 25
console.log("\nFirst 25 records:");
for (let i = 0; i < Math.min(25, recs.length); i++) {
  const r = recs[i];
  const pp = r.pairs.map(p => `(${p[0]},${p[1]})`).join(" ");
  console.log(`  [${i}] @0x${r.off.toString(16)} count=${r.count} pairs: ${pp}`);
}
console.log("\nLast 25:");
for (let i = Math.max(0, recs.length - 25); i < recs.length; i++) {
  const r = recs[i];
  const pp = r.pairs.map(p => `(${p[0]},${p[1]})`).join(" ");
  console.log(`  [${i}] @0x${r.off.toString(16)} count=${r.count} pairs: ${pp}`);
}

// Walk back further to find where this array starts.
console.log("\n=== Find start of the self-ptr array ===");
let earliest = firstSelf;
let q = firstSelf - 100;
// Scan backwards 100KB at a time
for (let dq = 100; dq < 1000000 && q > 0; dq += 100) {
  q = firstSelf - dq;
  if (q < 0) break;
  const sp = buf.readUInt32LE(q);
  if (sp === q) {
    const cnt = buf.readUInt16LE(q + 4);
    if (cnt >= 0 && cnt <= 50 && q + 6 + cnt * 8 <= fileEnd) {
      // Check if it chains forward to earliest
      let probe = q;
      let chains = 0;
      while (probe < earliest && chains < 50000) {
        const ssp = buf.readUInt32LE(probe);
        if (ssp !== probe) break;
        const ccnt = buf.readUInt16LE(probe + 4);
        if (ccnt > 50) break;
        probe += 6 + ccnt * 8;
        chains++;
      }
      if (probe >= earliest) {
        earliest = q;
        break;
      }
    }
  }
}
console.log(`Earlier self-ptr: 0x${earliest.toString(16)}`);

// Better: walk backward from firstSelf using fixed structure.
// First record at firstSelf - try to find its predecessor.
// Predecessor must end exactly at firstSelf, i.e. predecessor.off + 6 + 8*count = firstSelf
console.log("\n=== Walk backward from firstSelf to find array head ===");
let cur = firstSelf;
let backwardChain = 0;
for (let step = 0; step < 200000; step++) {
  // Try each plausible predecessor count value (0..50), looking for predecessor whose
  // self-ptr is exactly at the right position.
  let found = false;
  for (let cnt = 0; cnt <= 50; cnt++) {
    const pred = cur - (6 + cnt * 8);
    if (pred < 0) continue;
    const sp = buf.readUInt32LE(pred);
    if (sp !== pred) continue;
    const c2 = buf.readUInt16LE(pred + 4);
    if (c2 !== cnt) continue;
    cur = pred;
    backwardChain++;
    found = true;
    break;
  }
  if (!found) break;
}
console.log(`Backward chain length: ${backwardChain}, head at: 0x${cur.toString(16)}`);
// Look around the head
console.log(`Hex around head:`);
for (let i = -2; i < 3; i++) {
  const off = cur + i * 16;
  if (off < 0 || off + 16 > fileEnd) continue;
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 16; j++) {
    const b = buf[off + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  console.log(`  0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
}
