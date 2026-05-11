// dig-prng-state1.js — Investigate the 2560B high-entropy zone in the tail.
// Session 23: 320 unique 8B records, 0/320 shared between rome10 (T5) and RoR-T1 (T1)
// — fully turn-over.
// Test: do values change by ~constant per turn (LFSR/counter) or randomize (PRNG state)?
// Strategy: XOR rome10 vs RoR-T1 records and see if XOR is structured.

const fs = require("fs");

const SAVE_ROME10 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const SAVE_ROR_T1 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav";

// Per session 23:
// rome10 high-entropy zone: 0x1f437de..0x1f441de (2560 B, 320 × 8B records)
// RoR-T1 high-entropy zone: 0x1f1ad7b..0x1f1b77b (2560 B, 320 × 8B records)

const buf10 = fs.readFileSync(SAVE_ROME10);
const bufT1 = fs.readFileSync(SAVE_ROR_T1);

const REC_SIZE = 8;
const N_REC = 320;

const recs10 = [];
const recsT1 = [];
for (let i = 0; i < N_REC; i++) {
  const off10 = 0x1f437de + i * REC_SIZE;
  const offT1 = 0x1f1ad7b + i * REC_SIZE;
  recs10.push(buf10.slice(off10, off10 + 8));
  recsT1.push(bufT1.slice(offT1, offT1 + 8));
}

// Per-record XOR
console.log(`--- First 20 records hex (T1 → T5) ---`);
for (let i = 0; i < 20; i++) {
  const a = recsT1[i].toString("hex");
  const b = recs10[i].toString("hex");
  const xor = Buffer.alloc(8);
  for (let j = 0; j < 8; j++) xor[j] = bufT1[0x1f1ad7b + i * 8 + j] ^ buf10[0x1f437de + i * 8 + j];
  console.log(`  rec[${i.toString().padStart(3)}]: T1=${a} | T5=${b} | XOR=${xor.toString("hex")}`);
}

// Interpret as u64 LE; compute delta = u64(T5) - u64(T1)
console.log(`\n--- First 20 records: interpret as u64 LE, signed delta ---`);
function readU64LE(buf, off) {
  // Read as BigInt
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(buf[off + i]);
  return v;
}
for (let i = 0; i < 20; i++) {
  const a = readU64LE(bufT1, 0x1f1ad7b + i * 8);
  const b = readU64LE(buf10, 0x1f437de + i * 8);
  const delta = b - a;
  // Show as signed if magnitude is small
  console.log(`  rec[${i.toString().padStart(3)}]: T1=${a.toString().padStart(20)} | T5=${b.toString().padStart(20)} | Δ=${delta.toString()}`);
}

// Histogram of u64 ranges in both saves
console.log(`\n--- u64 range histogram (top byte) ---`);
function topByteHist(buf, off, n) {
  const h = new Array(256).fill(0);
  for (let i = 0; i < n; i++) {
    h[buf[off + i * 8 + 7]]++;
  }
  return h;
}
const h1 = topByteHist(bufT1, 0x1f1ad7b, 320);
const h5 = topByteHist(buf10, 0x1f437de, 320);
let h1Top = h1.map((c, i) => ({i, c})).filter(x => x.c > 0).sort((a, b) => b.c - a.c);
let h5Top = h5.map((c, i) => ({i, c})).filter(x => x.c > 0).sort((a, b) => b.c - a.c);
console.log(`T1 top bytes: ${h1Top.slice(0, 10).map(x => `${x.i}=0x${x.i.toString(16)}:${x.c}`).join(", ")}`);
console.log(`T5 top bytes: ${h5Top.slice(0, 10).map(x => `${x.i}=0x${x.i.toString(16)}:${x.c}`).join(", ")}`);

// Per-byte position entropy
console.log(`\n--- Per-byte-position entropy (8 positions × 320 records each) ---`);
function entropy(arr) {
  const total = arr.reduce((s, v) => s + v, 0);
  let H = 0;
  for (const v of arr) {
    if (v > 0) {
      const p = v / total;
      H -= p * Math.log2(p);
    }
  }
  return H;
}
function perByteEntropy(buf, off, n) {
  for (let b = 0; b < 8; b++) {
    const h = new Array(256).fill(0);
    for (let i = 0; i < n; i++) h[buf[off + i * 8 + b]]++;
    const H = entropy(h);
    process.stdout.write(`  byte[${b}] H=${H.toFixed(3)}`);
  }
  console.log();
}
console.log("T1:");
perByteEntropy(bufT1, 0x1f1ad7b, 320);
console.log("T5:");
perByteEntropy(buf10, 0x1f437de, 320);

// Test: is the high-entropy zone actually 320 × 8B records (sorted)? Are values sorted?
function isSorted(buf, off, n) {
  let lastV = 0n;
  for (let i = 0; i < n; i++) {
    const v = readU64LE(buf, off + i * 8);
    if (v < lastV) return false;
    lastV = v;
  }
  return true;
}
console.log(`\nT1 sorted: ${isSorted(bufT1, 0x1f1ad7b, 320)}`);
console.log(`T5 sorted: ${isSorted(buf10, 0x1f437de, 320)}`);

// More tests: pair-wise byte correlation?
// Test: are bytes [4..7] always 0 (= u32 only, top half zero)?
let zeroTopHalfT1 = 0, zeroTopHalfT5 = 0;
for (let i = 0; i < 320; i++) {
  const t = readU64LE(bufT1, 0x1f1ad7b + i * 8);
  if (t < 0x100000000n) zeroTopHalfT1++;
  const r = readU64LE(buf10, 0x1f437de + i * 8);
  if (r < 0x100000000n) zeroTopHalfT5++;
}
console.log(`Records with high u32 = 0 in T1: ${zeroTopHalfT1}/320`);
console.log(`Records with high u32 = 0 in T5: ${zeroTopHalfT5}/320`);

// Maybe records are two u32 fields?
// Tabulate u32_low and u32_high range
console.log(`\n--- u32 field range ---`);
function u32stats(buf, off, n, fieldOff) {
  let min = Infinity, max = 0, n0 = 0;
  for (let i = 0; i < n; i++) {
    const v = buf.readUInt32LE(off + i * 8 + fieldOff);
    if (v < min) min = v;
    if (v > max) max = v;
    if (v === 0) n0++;
  }
  return { min, max, n0 };
}
const t1low = u32stats(bufT1, 0x1f1ad7b, 320, 0);
const t1hi  = u32stats(bufT1, 0x1f1ad7b, 320, 4);
const t5low = u32stats(buf10, 0x1f437de, 320, 0);
const t5hi  = u32stats(buf10, 0x1f437de, 320, 4);
console.log(`T1 u32_low:  min=${t1low.min} max=${t1low.max} zeros=${t1low.n0}`);
console.log(`T1 u32_high: min=${t1hi.min} max=${t1hi.max} zeros=${t1hi.n0}`);
console.log(`T5 u32_low:  min=${t5low.min} max=${t5low.max} zeros=${t5low.n0}`);
console.log(`T5 u32_high: min=${t5hi.min} max=${t5hi.max} zeros=${t5hi.n0}`);

// If u32_high is bounded by 320, this looks like an index. Test:
// is u32_high in [0..319]?
let t5idxFits = 0;
for (let i = 0; i < 320; i++) {
  const h = buf10.readUInt32LE(0x1f437de + i * 8 + 4);
  if (h < 320) t5idxFits++;
}
console.log(`T5 records with high<320: ${t5idxFits}/320`);

// Maybe the records are (key, value) hash table entries
// Or (hash, index) for some 320-entry hashtable
