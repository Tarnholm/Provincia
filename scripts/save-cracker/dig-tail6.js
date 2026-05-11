// dig-tail6.js — Look at the section between unit records and the model strings.
// Also: what's the ACTUAL boundary between unit array and other tail content?

const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);
const tailStart = 0x1f10c72;
const tailEnd = buf.length;

// Earlier scan found unit-name records all the way from 0x1f10eea to 0x20f310a.
// But ~0x1f44000 area was strange (random-bytes signature). Let me check that's
// not a unit record (units are ASCII), maybe it's a hashed/serialized section.

// Random-bytes signature has high entropy. Let me compute entropy per 4KB block:
const BLOCK = 0x1000;
console.log("# Entropy per 4KB block in tail (approx):");
let lastEnt = 0;
for (let bi = 0; bi < Math.ceil((tailEnd - tailStart) / BLOCK); bi++) {
  const off = tailStart + bi * BLOCK;
  const end = Math.min(off + BLOCK, tailEnd);
  const len = end - off;
  // Histogram
  const h = new Uint32Array(256);
  for (let p = off; p < end; p++) h[buf[p]]++;
  let ent = 0;
  for (let i = 0; i < 256; i++) {
    if (h[i] === 0) continue;
    const p = h[i] / len;
    ent -= p * Math.log2(p);
  }
  // Only print blocks where entropy changes significantly
  if (Math.abs(ent - lastEnt) > 0.5 || bi < 5 || bi % 32 === 0) {
    const labels = [];
    if (ent > 7) labels.push("HIGH-ENT");
    if (ent < 2) labels.push("LOW-ENT");
    if (h[0] / len > 0.8) labels.push("zeros>80%");
    if (h[0xff] / len > 0.3) labels.push("ff>30%");
    console.log(`  block ${bi.toString().padStart(3)} @0x${off.toString(16)}: ent=${ent.toFixed(2)} ${labels.join(",")}`);
    lastEnt = ent;
  }
}

// Now what's in 0x1f44000..0x1f47abd — the high-entropy block?
console.log("\n=== Find the boundaries of the high-entropy hash block (0x1f44000) ===");
// Walk back from 0x1f441e0 to find where high-entropy starts
for (let p = 0x1f43000; p < 0x1f48000; p += 256) {
  let printable = 0;
  for (let i = 0; i < 256; i++) {
    const b = buf[p + i];
    if (b >= 0x20 && b <= 0x7e) printable++;
  }
  const printPct = (printable / 256 * 100).toFixed(0);
  console.log(`  0x${p.toString(16)}: printable=${printPct}%`);
}

// What's the section right before the strange hash block?
// Last unit record before 0x1f44000:
console.log("\n=== Last unit-record before 0x1f44000 ===");
for (let p = 0x1f44000 - 2; p > 0x1f30000; p -= 1) {
  const len = buf.readUInt16LE(p);
  if (len < 4 || len > 50) continue;
  if (p + 2 + len > buf.length) continue;
  const s = buf.slice(p + 2, p + 2 + len).toString("ascii");
  if (/^[a-z][a-z ]+[a-z]\0?$/.test(s)) {
    console.log(`  Last unit: @0x${p.toString(16)} name=${JSON.stringify(s)} (end @0x${(p + 2 + len).toString(16)})`);
    break;
  }
}
// First unit-record after 0x1f47abd:
console.log("\n=== First unit-record after 0x1f47abd ===");
for (let p = 0x1f47abd; p < 0x1f60000; p++) {
  const len = buf.readUInt16LE(p);
  if (len < 4 || len > 50) continue;
  if (p + 2 + len > buf.length) continue;
  const s = buf.slice(p + 2, p + 2 + len).toString("ascii");
  if (/^[a-z][a-z ]+[a-z]\0?$/.test(s)) {
    console.log(`  Next unit: @0x${p.toString(16)} name=${JSON.stringify(s)}`);
    break;
  }
}

// What's the section right BEFORE 0x1f47abd (immediately after the hash block)?
// The hash ends around 0x1f44270 maybe; then 0x1f44280 has small-int pattern;
// then 0x1f442d0 = section grammar candidate
console.log("\n=== Decode 0x1f442d0 area (section grammar candidate) ===");
{
  const p = 0x1f442d0;
  // u32==pos?
  const u0 = buf.readUInt32LE(p);
  const sz = buf.readUInt32LE(p + 4);
  console.log(`  @0x${p.toString(16)}: u0=0x${u0.toString(16)} (==pos? ${u0 === p}), u1=${sz}, u1-as-size: ${sz}`);
  // What if it's something else - print 64 bytes
  for (let i = 0; i < 16; i++) {
    const off = p + i * 16;
    if (off + 16 > buf.length) break;
    const hex = [];
    const ascii = [];
    for (let j = 0; j < 16; j++) {
      const b = buf[off + j];
      hex.push(b.toString(16).padStart(2, "0"));
      ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
    }
    console.log(`  0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
  }
}
